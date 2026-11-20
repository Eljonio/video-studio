import path from 'node:path';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import * as store from '../store.js';
import * as runner from '../services/runner.js';
import * as hf from '../adapters/higgsfield-cli.js';
import { compilePrompt } from '../domain/prompt-compiler.js';
import { STYLE_PRESETS, NEGATIVE_BASE } from '../domain/style-presets.js';
import { stillPromptForShot } from '../domain/still-prompt.js';
import { VIDEO_MODELS, IMAGE_MODELS } from '../domain/models.js';
import { DEVICES } from '../domain/devices.js';
import { probe } from '../services/media.js';
import { config } from '../config.js';
import * as lib from '../library.js';

export function newProject({ title, preset = 'cinema_drama', aspect = '16:9', device, prompt_format = 'prose' }) {
  const p = STYLE_PRESETS[preset] || STYLE_PRESETS.cinema_drama;
  const now = new Date().toISOString();
  return {
    id: store.newId(),
    title: title || 'Без названия',
    created_at: now,
    updated_at: now,
    format: { aspect, resolution: '1080p' },
    device: device || (preset === 'phone_realism' ? 'phone' : preset === 'cinema_drama' ? 'cinema' : 'mirrorless_kit'),
    prompt_format,
    summary: { who_and_where: '', what_happens: '', tone: '', what_we_read: '', what_we_do_not_show: '', purpose: '' },
    style: { preset, style: structuredClone(p.style), negative_extra: [...(p.negative_extra || [])] },
    assets: { characters: [], locations: [], props: [] },
    shots: [],
  };
}

export default async function apiRoutes(app) {
  app.get('/api/meta', async () => ({
    style_presets: Object.fromEntries(Object.entries(STYLE_PRESETS).map(([k, v]) => [k, { label: v.label }])),
    negative_base: NEGATIVE_BASE,
    devices: Object.fromEntries(Object.entries(DEVICES).map(([k, v]) => [k, { label: v.label, fps: v.fps }])),
    video_models: VIDEO_MODELS,
    image_models: IMAGE_MODELS,
    max_parallel: config.maxParallel,
  }));

  // Live catalog of every video job type the CLI knows (models + workflows), cached for 10 minutes.
  let catalogCache = { at: 0, data: null };
  app.get('/api/catalog', async () => {
    if (Date.now() - catalogCache.at < 10 * 60 * 1000 && catalogCache.data) return catalogCache.data;
    const [models, workflows] = await Promise.all([hf.modelList(), hf.workflowList()]);
    const norm = (list, kind) => (Array.isArray(list) ? list : list?.items || list?.models || list?.workflows || [])
      .map((m) => ({ job_type: m.job_type || m.name, display_name: m.display_name || m.name || m.job_type, type: m.type || m.output_type, kind }))
      .filter((m) => m.job_type);
    const all = [...norm(models, 'model'), ...norm(workflows, 'workflow')];
    const video = all.filter((m) => m.type === 'video');
    const image = all.filter((m) => m.type === 'image');
    catalogCache = { at: Date.now(), data: { video, image, known: Object.keys(VIDEO_MODELS) } };
    return catalogCache.data;
  });

  app.get('/api/account', async () => {
    try { return await hf.accountStatus(); } catch (err) { return { error: err.message }; }
  });

  app.get('/api/projects', async () => store.listProjects());

  // Плоская лента всех готовых видео: новые сверху. scope=project|all
  app.get('/api/gallery', async (req) => {
    const scope = req.query.scope === 'all' ? 'all' : 'project';
    const ids = scope === 'all'
      ? (await store.listProjects()).map((x) => x.id)
      : [req.query.project].filter(Boolean);
    const items = [];
    for (const pid of ids) {
      let proj;
      try { proj = await store.getProject(pid); } catch { continue; }
      const shotNo = new Map(proj.shots.map((s, i) => [s.id, i + 1]));
      for (const run of await store.listRuns(pid)) {
        for (const v of run.variants) {
          if (!v.file && v.status !== 'running' && v.status !== 'queued' && v.status !== 'submitting' && v.status !== 'analysing') continue;
          items.push({
            project_id: pid,
            project_title: proj.title,
            run_id: run.id,
            label: run.label || run.model,
            model: run.model,
            device: proj.device,
            aspect: proj.format?.aspect,
            shots: run.shot_ids.map((id) => shotNo.get(id)).filter(Boolean),
            shot_titles: run.shot_ids.map((id) => proj.shots.find((s) => s.id === id)?.title).filter(Boolean),
            created_at: v.finished_at || v.submitted_at || run.created_at,
            index: v.index,
            status: v.status,
            file: v.file || null,
            sheet: v.sheet || null,
            poster: v.frames?.[0] || null,
            metrics: v.metrics || null,
            post: v.post || null,
            picked: run.pick?.variant === v.index,
            score: run.pick?.variant === v.index ? run.pick.score : null,
            note: run.pick?.variant === v.index ? run.pick.note : '',
            error: v.error || null,
          });
        }
      }
    }
    items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return { items, count: items.length };
  });

  app.post('/api/projects', async (req) => {
    const p = newProject(req.body || {});
    await store.saveProject(p);
    return p;
  });

  app.get('/api/projects/:id', async (req, reply) => {
    try { return await store.getProject(req.params.id); } catch { return reply.code(404).send({ error: 'not found' }); }
  });

  app.put('/api/projects/:id', async (req) => {
    const p = req.body;
    p.id = req.params.id;
    return store.saveProject(p);
  });

  app.delete('/api/projects/:id', async (req) => {
    await store.deleteProject(req.params.id);
    return { ok: true };
  });

  // Duplicate a project as a new draft (style + assets, shots optional).
  app.post('/api/projects/:id/clone', async (req) => {
    const src = await store.getProject(req.params.id);
    const copy = structuredClone(src);
    copy.id = store.newId();
    copy.title = `${src.title} (копия)`;
    if (req.body?.withoutShots) copy.shots = [];
    await fs.mkdir(store.mediaDir(copy.id), { recursive: true });
    await fs.cp(store.mediaDir(src.id), store.mediaDir(copy.id), { recursive: true, force: true }).catch(() => {});
    return store.saveProject(copy);
  });

  app.post('/api/projects/:id/compile', async (req) => {
    const p = await store.getProject(req.params.id);
    const { shotIds, format } = req.body || {};
    const r = compilePrompt(p, shotIds, format);
    return { prompt: r.prompt, warnings: r.warnings, references: r.references.map((x) => ({ label: x.label, asset: x.asset, media: x.mediaRef.id })), total_seconds: r.total_seconds, chars: r.prompt.length };
  });

  app.post('/api/projects/:id/estimate', async (req, reply) => {
    try { return await runner.estimate(req.params.id, req.body || {}); } catch (err) { return reply.code(400).send({ error: err.message, detail: err.stderr || err.stdout }); }
  });

  app.post('/api/projects/:id/runs', async (req, reply) => {
    try { return await runner.start(req.params.id, req.body || {}); } catch (err) { return reply.code(400).send({ error: err.message, detail: err.stderr || err.stdout }); }
  });

  app.get('/api/projects/:id/runs', async (req) => store.listRuns(req.params.id));
  app.get('/api/projects/:id/runs/:runId', async (req) => store.getRun(req.params.id, req.params.runId));
  app.post('/api/projects/:id/runs/:runId/pick', async (req) => runner.pick(req.params.id, req.params.runId, req.body || {}));
  app.post('/api/projects/:id/runs/:runId/post', async (req, reply) => {
    try { return await runner.postProcess(req.params.id, req.params.runId, req.body || {}); } catch (err) { return reply.code(400).send({ error: err.message, detail: err.stderr }); }
  });
  app.post('/api/projects/:id/runs/:runId/recover', async (req) => runner.recover(req.params.id, req.params.runId));
  app.post('/api/projects/:id/runs/:runId/last-frame', async (req) => runner.lastFrameAsMedia(req.params.id, req.params.runId, req.body?.variant));
  app.delete('/api/projects/:id/runs/:runId', async (req) => {
    await fs.rm(store.runDir(req.params.id, req.params.runId), { recursive: true, force: true });
    await fs.rm(`${store.runDir(req.params.id, req.params.runId)}.json`, { force: true });
    return { ok: true };
  });

  // Media upload: multipart file -> data/projects/<id>/media/<uuid>.<ext>; returns mediaRef (hf upload is lazy).
  app.post('/api/projects/:id/media', async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'no file' });
    const id = store.newId();
    const ext = path.extname(part.filename || '').toLowerCase() || '.bin';
    const dir = store.mediaDir(req.params.id);
    await fs.mkdir(dir, { recursive: true });
    const abs = path.join(dir, `${id}${ext}`);
    await pipeline(part.file, createWriteStream(abs));
    const kind = /\.(mp4|mov|webm|mkv)$/.test(ext) ? 'video' : /\.(mp3|wav|m4a|aac|ogg)$/.test(ext) ? 'audio' : 'image';
    const ref = { id, file: `${id}${ext}`, kind, label: part.filename, url: store.toUrl(abs) };
    if (kind === 'video') { try { ref.info = await probe(abs); } catch { /* ignore */ } }
    return ref;
  });

  // Upload a media ref to Higgsfield now (so its id is visible / reusable).
  app.post('/api/projects/:id/media/:mediaId/hf-upload', async (req, reply) => {
    const p = await store.getProject(req.params.id);
    const refs = allMediaRefs(p).filter((m) => m.id === req.params.mediaId);
    if (!refs.length) return reply.code(404).send({ error: 'media not in project' });
    await runner.ensureUploaded(p, refs);
    return refs[0];
  });

  // Generate a still (start frame) for a shot with an image model; returns mediaRef once done.
  app.post('/api/projects/:id/still', async (req, reply) => {
    const { model = 'nano_banana_pro', prompt, refs = [], params = {} } = req.body || {};
    if (!prompt) return reply.code(400).send({ error: 'prompt required' });
    const p = await store.getProject(req.params.id);
    const mediaRefs = allMediaRefs(p).filter((m) => refs.includes(m.id));
    await runner.ensureUploaded(p, mediaRefs);
    const medias = mediaRefs.length ? { image_references: mediaRefs.map((m) => m.hf_id) } : {};
    const merged = { aspect_ratio: p.format?.aspect || '16:9', ...params, prompt };
    try {
      const { id } = await hf.createJob(model, merged, medias);
      // poll inline (images take ~30 s)
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const job = await hf.getJob(id);
        if (job.status === 'completed' && job.result_url) {
          const mid = store.newId();
          const ext = path.extname(new URL(job.result_url).pathname) || '.png';
          const abs = path.join(store.mediaDir(p.id), `${mid}${ext}`);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          const res = await fetch(job.result_url);
          await fs.writeFile(abs, Buffer.from(await res.arrayBuffer()));
          return { id: mid, file: `${mid}${ext}`, kind: 'image', label: `${model} still`, url: store.toUrl(abs), hf_id: id, job_id: id, prompt };
        }
        if (job.status !== 'running') return reply.code(400).send({ error: job.error || job.status });
        if (Date.now() - started > 5 * 60 * 1000) return reply.code(504).send({ error: 'still timeout', job_id: id });
      }
    } catch (err) {
      return reply.code(400).send({ error: err.message, detail: err.stderr });
    }
  });

  // ---- Global library ----
  app.get('/api/library', async () => lib.getLibrary());
  app.put('/api/library/:group', async (req) => lib.upsertItem(req.params.group, req.body || {}));
  app.delete('/api/library/:group/:itemId', async (req) => { await lib.removeItem(req.params.group, req.params.itemId); return { ok: true }; });
  app.post('/api/library/media', async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'no file' });
    const id = store.newId();
    const ext = path.extname(part.filename || '').toLowerCase() || '.bin';
    const dir = lib.libraryMediaDir();
    await fs.mkdir(dir, { recursive: true });
    const abs = path.join(dir, `${id}${ext}`);
    await pipeline(part.file, createWriteStream(abs));
    const kind = /\.(mp4|mov|webm|mkv)$/.test(ext) ? 'video' : /\.(mp3|wav|m4a|aac|ogg)$/.test(ext) ? 'audio' : 'image';
    return { id, file: `${id}${ext}`, kind, label: part.filename, url: store.toUrl(abs), scope: 'library' };
  });
  // Copy a library item into a project (assets keep media refs pointing at library files, so no duplication).
  app.post('/api/projects/:id/assets/from-library', async (req, reply) => {
    const { group, itemId } = req.body || {};
    const library = await lib.getLibrary();
    const item = (library[group] || []).find((x) => x.id === itemId);
    if (!item) return reply.code(404).send({ error: 'library item not found' });
    const p = await store.getProject(req.params.id);
    const copy = structuredClone(item);
    copy.library_id = item.id; copy.id = store.newId();
    p.assets[group] ||= [];
    p.assets[group].push(copy);
    await store.saveProject(p);
    return copy;
  });
  // Save a project asset into the library (media files are copied into the library folder).
  app.post('/api/projects/:id/assets/to-library', async (req, reply) => {
    const { group, assetId } = req.body || {};
    const p = await store.getProject(req.params.id);
    const a = (p.assets[group] || []).find((x) => x.id === assetId);
    if (!a) return reply.code(404).send({ error: 'asset not found' });
    const item = structuredClone(a);
    item.id = a.library_id || store.newId();
    delete item.library_id;
    await fs.mkdir(lib.libraryMediaDir(), { recursive: true });
    for (const m of item.refs || []) {
      if (m.scope === 'library') continue;
      const src = path.join(store.mediaDir(p.id), m.file);
      await fs.copyFile(src, path.join(lib.libraryMediaDir(), m.file)).catch(() => {});
      m.scope = 'library'; m.url = store.toUrl(path.join(lib.libraryMediaDir(), m.file));
    }
    const saved = await lib.upsertItem(group, item);
    a.library_id = saved.id;
    await store.saveProject(p);
    return saved;
  });

  // Старт-кадр для конкретного плана: промпт строится из полей плана, результат сразу становится start_image.
  app.post('/api/projects/:id/still-for-shot', async (req, reply) => {
    const { shotId, model = 'nano_banana_pro' } = req.body || {};
    const p = await store.getProject(req.params.id);
    const shot = p.shots.find((s) => s.id === shotId);
    if (!shot) return reply.code(404).send({ error: 'план не найден' });
    const { prompt, aspect } = stillPromptForShot(p, shot);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/still`, payload: { model, prompt, refs: [], params: { aspect_ratio: aspect } } });
    if (r.statusCode !== 200) return reply.code(r.statusCode).send(r.json());
    const media = r.json();
    const fresh = await store.getProject(req.params.id);
    const target = fresh.shots.find((s) => s.id === shotId);
    if (target) target.start_image = media;
    await store.saveProject(fresh);
    return media;
  });

  app.get('/api/models/:jobType', async (req, reply) => {
    try { return await hf.modelGet(req.params.jobType); } catch (err) { return reply.code(400).send({ error: err.message }); }
  });
}

function allMediaRefs(p) {
  const out = [];
  for (const group of ['characters', 'locations', 'props']) for (const a of p.assets?.[group] || []) out.push(...(a.refs || []));
  for (const s of p.shots || []) { if (s.start_image) out.push(s.start_image); if (s.end_image) out.push(s.end_image); out.push(...(s.video_refs || [])); }
  out.push(...(p.media_library || []));
  return out;
}
