// Generation runner: N variants of one compiled prompt -> poll -> download -> frames/metrics.
// State lives in run JSON files so the UI can reload at any time.
import path from 'node:path';
import fs from 'node:fs/promises';
import * as hf from '../adapters/higgsfield-cli.js';
import { compilePrompt } from '../domain/prompt-compiler.js';
import { modelInfo } from '../domain/models.js';
import { config } from '../config.js';
import { getProject, saveProject, saveRun, getRun, runDir, mediaDir, newId, toUrl } from '../store.js';
import { download, probe, extractFrames, contactSheet, qualityMetrics } from './media.js';
import { mediaPath } from '../library.js';

const active = new Map(); // runId -> Promise

/** Make sure every mediaRef used has a Higgsfield upload id; uploads lazily and persists to the project. */
export async function ensureUploaded(project, mediaRefs) {
  let changed = false;
  for (const m of mediaRefs) {
    if (m.hf_id) continue;
    const abs = mediaPath(mediaDir(project.id), m);
    const up = await hf.upload(abs);
    m.hf_id = up.id;
    m.hf_url = up.url;
    changed = true;
  }
  if (changed) await saveProject(project);
}

function collectMedias(project, shots, references, opts) {
  const medias = {};
  const info = modelInfo(opts.model);
  const allowed = new Set(info?.medias || ['start_image', 'end_image', 'image_references', 'video_references', 'audio_references']);
  const refIds = references.map((r) => r.mediaRef.hf_id).filter(Boolean);
  const limit = info?.limits?.image_references;
  if (refIds.length && (!info || allowed.has('image_references'))) {
    medias.image_references = limit ? refIds.slice(0, limit) : refIds;
  }
  const first = shots[0], last = shots[shots.length - 1];
  if (first?.start_image?.hf_id && (!info || allowed.has('start_image'))) medias.start_image = first.start_image.hf_id;
  if (last?.end_image?.hf_id && (!info || allowed.has('end_image'))) medias.end_image = last.end_image.hf_id;
  for (const m of shots.flatMap((s) => s.video_refs || [])) {
    if (m.hf_id && (!info || allowed.has('video_references'))) (medias.video_references ||= []).push(m.hf_id);
  }
  return medias;
}

/** Everything the CLI will receive, without sending anything. */
export async function prepare(projectId, { shotIds, model, params = {}, n = 1, promptOverride, format }) {
  const opts = { format };
  const project = await getProject(projectId);
  const compiled = compilePrompt(project, shotIds, opts.format);
  const info = modelInfo(model);
  const shots = compiled.shots;
  const mediaRefs = [
    ...compiled.references.map((r) => r.mediaRef),
    ...shots.map((s) => s.start_image).filter(Boolean),
    ...shots.map((s) => s.end_image).filter(Boolean),
    ...shots.flatMap((s) => s.video_refs || []),
  ];
  await ensureUploaded(project, mediaRefs);
  const merged = { ...(info?.defaults || {}), ...params };
  if (!merged.duration) merged.duration = compiled.total_seconds || 5;
  if (!merged.aspect_ratio) merged.aspect_ratio = project.format?.aspect || '16:9';
  merged.prompt = promptOverride || compiled.prompt;
  const medias = collectMedias(project, shots, compiled.references, { model });
  // Models with a t2v/omni_reference switch: references need omni_reference, no references need t2v.
  if ('mode' in merged && ['t2v', 'omni_reference'].includes(merged.mode)) {
    merged.mode = Object.keys(medias).length ? 'omni_reference' : 't2v';
  }
  return { project, compiled, model, params: merged, medias, n: Number(n) || 1 };
}

export async function estimate(projectId, opts) {
  const prep = await prepare(projectId, opts);
  const { credits, raw } = await hf.estimateCost(prep.model, prep.params, prep.medias);
  return {
    per_variant: credits,
    total: credits == null ? null : credits * prep.n,
    n: prep.n,
    params: prep.params,
    medias: prep.medias,
    prompt: prep.params.prompt,
    warnings: prep.compiled.warnings,
    raw,
  };
}

export async function start(projectId, opts) {
  const prep = await prepare(projectId, opts);
  const run = {
    id: newId(),
    project_id: projectId,
    created_at: new Date().toISOString(),
    label: opts.label || '',
    shot_ids: prep.compiled.shots.map((s) => s.id),
    model: prep.model,
    params: prep.params,
    medias: prep.medias,
    prompt: prep.params.prompt,
    n: prep.n,
    status: 'starting',
    variants: Array.from({ length: prep.n }, (_, i) => ({ index: i + 1, status: 'queued' })),
    pick: null,
  };
  await saveRun(run);
  const p = execute(run).catch(async (err) => {
    run.status = 'failed';
    run.error = String(err.message || err);
    await saveRun(run);
  }).finally(() => active.delete(run.id));
  active.set(run.id, p);
  return run;
}

async function execute(run) {
  const dir = runDir(run.project_id, run.id);
  await fs.mkdir(dir, { recursive: true });
  const { prompt, ...params } = run.params;
  // Submit with bounded parallelism.
  const queue = [...run.variants];
  const workers = Array.from({ length: Math.min(config.maxParallel, queue.length) }, () => worker());
  run.status = 'running';
  await saveRun(run);
  async function worker() {
    while (queue.length) {
      const v = queue.shift();
      try {
        v.status = 'submitting';
        await saveRun(run);
        const { id } = await hf.createJob(run.model, { ...params, prompt }, run.medias);
        v.job_id = id;
        v.status = 'running';
        v.submitted_at = new Date().toISOString();
        await saveRun(run);
        await pollAndFinish(run, v, dir);
      } catch (err) {
        v.status = 'failed';
        v.error = String(err.message || err);
        await saveRun(run);
      }
    }
  }
  await Promise.all(workers);
  const ok = run.variants.filter((v) => v.status === 'completed').length;
  run.status = ok ? 'completed' : 'failed';
  run.finished_at = new Date().toISOString();
  await saveRun(run);
}

async function pollAndFinish(run, v, dir) {
  const started = Date.now();
  let job;
  for (;;) {
    await sleep(config.pollMs);
    try {
      job = await hf.getJob(v.job_id);
    } catch (err) {
      v.last_error = String(err.message || err);
      if (Date.now() - started > config.waitTimeoutMs) throw new Error(`poll timeout: ${v.last_error}`);
      continue;
    }
    if (job.status === 'completed' && job.result_url) break;
    if (job.status !== 'running') throw new Error(job.error || `job ${job.status}`);
    if (Date.now() - started > config.waitTimeoutMs) throw new Error('generation timeout');
  }
  const ext = path.extname(new URL(job.result_url).pathname) || '.mp4';
  const file = path.join(dir, `v${v.index}${ext}`);
  v.result_url = job.result_url;
  v.bytes = await download(job.result_url, file);
  v.file = toUrl(file);
  v.status = 'analysing';
  await saveRun(run);
  try {
    const info = await probe(file);
    v.metrics = await qualityMetrics(file, info);
    const frames = await extractFrames(file, path.join(dir, `v${v.index}-frames`), 6, info.duration);
    v.frames = frames.map(toUrl);
    v.sheet = toUrl(await contactSheet(file, path.join(dir, `v${v.index}-sheet.jpg`), 3, 2, info.duration));
  } catch (err) {
    v.analysis_error = String(err.message || err);
  }
  v.status = 'completed';
  v.finished_at = new Date().toISOString();
  await saveRun(run);
}

/** Called on server start: continue polling jobs that were already submitted; mark the rest as lost. */
export async function resumeAll(log = console) {
  const { listProjects, listRuns } = await import('../store.js');
  for (const p of await listProjects()) {
    for (const run of await listRuns(p.id)) {
      const dir = runDir(run.project_id, run.id);
      for (const v of run.variants) if (v.post?.status === 'running' && v.post.job_id) { pollPost(run, v, dir); log.info?.(`resumed post ${v.post.job_id}`); }
      if (!['starting', 'running'].includes(run.status)) continue;
      let touched = false;
      for (const v of run.variants) {
        if (v.status === 'completed' || v.status === 'failed') continue;
        if (v.job_id) {
          touched = true;
          v.status = 'running';
          pollAndFinish(run, v, dir).catch(async (err) => { v.status = 'failed'; v.error = String(err.message || err); await saveRun(run); }).then(() => finalize(run));
        } else {
          v.status = 'failed';
          v.error = 'потерян при рестарте сервера до отправки (кредиты не списаны)';
        }
      }
      run.error = null;
      if (touched) { run.status = 'running'; log.info?.(`resumed run ${run.id}`); } else { run.status = run.variants.some((v) => v.status === 'completed') ? 'completed' : 'failed'; }
      await saveRun(run);
    }
  }
}

async function finalize(run) {
  if (run.variants.some((v) => !['completed', 'failed'].includes(v.status))) return;
  run.status = run.variants.some((v) => v.status === 'completed') ? 'completed' : 'failed';
  run.finished_at = new Date().toISOString();
  await saveRun(run);
}

/** Post step: upscale a completed variant (bytedance 4k pro by default, ~0.2-1 credit). Stores result next to the variant. */
export async function postProcess(projectId, runId, { variant, action = 'upscale', params = {} }) {
  const run = await getRun(projectId, runId);
  const v = run.variants.find((x) => x.index === Number(variant));
  if (!v?.job_id || v.status !== 'completed') throw new Error('variant is not completed');
  const dir = runDir(projectId, runId);
  if (action === 'film') {
    // Local ffmpeg de-AI pass (scripts/post-film.sh), no credits.
    const preset = params.preset || 'medium';
    const engine = params.engine === 'blender' ? 'blender' : 'ffmpeg';
    const src = path.join(config.dataDir, v.file.replace(/^\/data\//, ''));
    const out = path.join(dir, `v${v.index}-post-${engine}-${preset}.mp4`);
    v.post = { action, preset, engine, status: 'running', started_at: new Date().toISOString() };
    await saveRun(run);
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'scripts', engine === 'blender' ? 'post-blender.sh' : 'post-film.sh');
    promisify(execFile)('bash', [script, '-i', src, '-o', out, '-p', preset], { timeout: 30 * 60 * 1000 })
      .then(async () => { v.post.file = toUrl(out); try { v.post.metrics = await probe(out); } catch { /* ignore */ } v.post.status = 'completed'; v.post.finished_at = new Date().toISOString(); await saveRun(run); })
      .catch(async (err) => { v.post.status = 'failed'; v.post.error = String(err.stderr || err.message || err).slice(0, 500); await saveRun(run); });
    return run;
  }
  let jobType, jobParams;
  if (action === 'upscale') {
    jobType = 'bytedance_video_upscale';
    jobParams = { resolution: '4k', preset: 'aigc', model_version: 'pro', fps: 24, ...params };
  } else {
    throw new Error(`unknown post action ${action}`);
  }
  const { id } = await hf.createJob(jobType, jobParams, { video_references: v.job_id });
  v.post = { action, job_id: id, status: 'running', params: jobParams, started_at: new Date().toISOString() };
  await saveRun(run);
  pollPost(run, v, dir);
  return run;
}

function pollPost(run, v, dir) {
  const started = Date.now();
  (async () => {
    for (;;) {
      await sleep(config.pollMs);
      let job;
      try { job = await hf.getJob(v.post.job_id); }
      catch (err) { v.post.last_error = err.message; if (Date.now() - started > config.waitTimeoutMs) { v.post.status = 'failed'; v.post.error = err.message; await saveRun(run); return; } continue; }
      if (job.status === 'completed' && job.result_url) {
        const file = path.join(dir, `v${v.index}-${v.post.action}.mp4`);
        await download(job.result_url, file);
        v.post.file = toUrl(file);
        try { v.post.metrics = await probe(file); } catch { /* ignore */ }
        v.post.status = 'completed';
        await saveRun(run);
        return;
      }
      if (job.status !== 'running' || Date.now() - started > config.waitTimeoutMs) { v.post.status = 'failed'; v.post.error = job.error || job.status; await saveRun(run); return; }
    }
  })();
}

/** Re-poll failed variants that have a job id (paid jobs are never lost because of a download hiccup). */
export async function recover(projectId, runId) {
  const run = await getRun(projectId, runId);
  const dir = runDir(projectId, runId);
  let n = 0;
  for (const v of run.variants) {
    if (v.status === 'failed' && v.job_id) {
      n++; v.status = 'running'; v.error = null;
      pollAndFinish(run, v, dir).catch(async (err) => { v.status = 'failed'; v.error = String(err.message || err); await saveRun(run); }).then(() => finalize(run));
    }
  }
  if (n) { run.status = 'running'; run.error = null; await saveRun(run); }
  return run;
}

export async function pick(projectId, runId, { variant, score, note }) {
  const run = await getRun(projectId, runId);
  run.pick = { variant: Number(variant), score: score == null ? null : Number(score), note: note || '', at: new Date().toISOString() };
  await saveRun(run);
  return run;
}

/** Store a variant's final frame as an asset image (for last-frame -> next shot chaining) — returns mediaRef. */
export async function lastFrameAsMedia(projectId, runId, variantIndex) {
  const run = await getRun(projectId, runId);
  const v = run.variants.find((x) => x.index === Number(variantIndex));
  if (!v?.file) throw new Error('variant has no file');
  const abs = path.join(config.dataDir, v.file.replace(/^\/data\//, ''));
  const info = await probe(abs);
  const id = newId();
  const out = path.join(mediaDir(projectId), `${id}.jpg`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.1', '-i', abs, '-frames:v', '1', '-q:v', '2', out]);
  return { id, file: `${id}.jpg`, kind: 'image', label: `last frame of run ${run.label || run.id.slice(0, 8)} v${v.index}`, url: toUrl(out) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
