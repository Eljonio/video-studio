/* Video Studio front-end: one page, no build step. State = current project document, autosaved. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}, ...opts, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || res.statusText), { detail: j.detail });
  return j;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};

const state = { meta: null, projects: [], project: null, shotId: null, runs: [], pollTimer: null, saveTimer: null };

/* ---------- boot ---------- */
async function boot() {
  state.meta = await api('/api/meta');
  api('/api/account').then((a) => { $('#account').textContent = a.error ? 'CLI: ' + a.error : `${a.email || a.user?.email || ''} · ${fmtCredits(a)}`; }).catch(() => {});
  fillSelect($('#pPreset'), Object.entries(state.meta.style_presets).map(([k, v]) => [k, v.label]));
  await loadCatalog();
  await loadProjects();
  const fromUrl = new URLSearchParams(location.search).get('project');
  const last = fromUrl || localStorage.getItem('vs.project');
  if (last && state.projects.some((p) => p.id === last)) await openProject(last);
  bindTop();
}
function fmtCredits(a) {
  const c = a.credits ?? a.workspace?.credits ?? a.balance;
  return c == null ? '' : `${Math.round(Number(c))} кр.`;
}
function fillSelect(sel, pairs, value) {
  sel.innerHTML = '';
  for (const [v, l] of pairs) sel.append(el('option', { value: v }, l));
  if (value != null) sel.value = value;
}
async function loadProjects() {
  state.projects = await api('/api/projects');
  fillSelect($('#projectSelect'), [['', '— проект —'], ...state.projects.map((p) => [p.id, `${p.title} (${p.shots} пл.)`])], state.project?.id || '');
}
function bindTop() {
  $('#projectSelect').onchange = (e) => e.target.value ? openProject(e.target.value) : null;
  $('#btnNewProject').onclick = async () => {
    const title = prompt('Название проекта', 'Новый ролик');
    if (title == null) return;
    const p = await api('/api/projects', { method: 'POST', body: { title, preset: 'cinema_drama' } });
    await loadProjects();
    openProject(p.id);
  };
  $('#btnClone').onclick = async () => {
    if (!state.project) return;
    const p = await api(`/api/projects/${state.project.id}/clone`, { method: 'POST', body: {} });
    await loadProjects(); openProject(p.id);
  };
  $('#btnDelete').onclick = async () => {
    if (!state.project || !confirm(`Удалить проект «${state.project.title}» со всеми прогонами?`)) return;
    await api(`/api/projects/${state.project.id}`, { method: 'DELETE' });
    state.project = null; localStorage.removeItem('vs.project');
    $('#app').hidden = true; $('#empty').hidden = false;
    await loadProjects();
  };
  $('#btnAddShot').onclick = () => { addShot(); };
  $$('[data-add]').forEach((b) => b.onclick = () => addAsset(b.dataset.add));
  $('#genModel').onchange = () => renderGenParams();
  $('#btnCompile').onclick = compile;
  $('#btnEstimate').onclick = estimate;
  $('#btnGenerate').onclick = generate;
  $('#lbClose').onclick = () => { $('#lightbox').hidden = true; $('#lbBody').innerHTML = ''; };
  $('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox') $('#lbClose').click(); };
}

/* ---------- project ---------- */
async function openProject(id) {
  state.project = await api(`/api/projects/${id}`);
  localStorage.setItem('vs.project', id);
  $('#projectSelect').value = id;
  state.shotId = state.project.shots[0]?.id || null;
  $('#app').hidden = false; $('#empty').hidden = true;
  renderProject();
  renderGenParams();
  if (window.renderLibrary) window.renderLibrary();
  if (window.galleryView) { window.galleryView.reset(); window.galleryView.load(true); }
  await loadRuns();
}
function scheduleSave() {
  $('#saveState').textContent = '…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      const p = await api(`/api/projects/${state.project.id}`, { method: 'PUT', body: state.project });
      state.project.updated_at = p.updated_at;
      $('#saveState').textContent = 'сохранено';
      if (window.flowRefresh) window.flowRefresh();
    } catch (e) { $('#saveState').textContent = 'ошибка сохранения: ' + e.message; }
  }, 600);
}
const bind = (input, obj, key, { number = false, lines = false } = {}) => {
  const v = obj[key];
  input.value = lines ? (v || []).join('\n') : v ?? '';
  input.oninput = () => { obj[key] = number ? Number(input.value) : lines ? input.value.split('\n').map((s) => s.trim()).filter(Boolean) : input.value; scheduleSave(); if (key === 'name' || key === 'title' || key === 'duration') renderShotTabs(); };
  return input;
};

function renderProject() {
  const p = state.project;
  bind($('#pTitle'), p, 'title').oninput = (e) => { p.title = e.target.value; scheduleSave(); loadProjects(); };
  bind($('#pAspect'), p.format, 'aspect');
  fillSelect($('#pDevice'), Object.entries(state.meta.devices).map(([k, v]) => [k, v.label]), p.device || 'phone');
  $('#pDevice').onchange = (e) => { p.device = e.target.value; scheduleSave(); };
  $('#pFormat').value = p.prompt_format || 'prose';
  $('#pFormat').onchange = (e) => { p.prompt_format = e.target.value; scheduleSave(); };
  $('#pPreset').value = p.style.preset || 'cinema_drama';
  $('#pPreset').onchange = async (e) => {
    if (!confirm('Заменить все поля глобального вида на пресет?')) { e.target.value = p.style.preset; return; }
    // fetch preset text through a throwaway project
    const tmp = await api('/api/projects', { method: 'POST', body: { title: '_tmp', preset: e.target.value } });
    await api(`/api/projects/${tmp.id}`, { method: 'DELETE' });
    p.style = tmp.style; scheduleSave(); renderStyle();
  };
  bind($('#sWho'), p.summary, 'who_and_where'); bind($('#sWhat'), p.summary, 'what_happens'); bind($('#sTone'), p.summary, 'tone');
  bind($('#sRead'), p.summary, 'what_we_read'); bind($('#sNot'), p.summary, 'what_we_do_not_show'); bind($('#sPurpose'), p.summary, 'purpose');
  renderStyle();
  renderAssets();
  renderShotTabs();
  renderShotEditor();
}
function renderStyle() {
  const box = $('#styleFields'); box.innerHTML = '';
  for (const k of Object.keys(state.project.style.style)) {
    box.append(el('label', {}, k, bind(el('textarea', { rows: 2 }), state.project.style.style, k)));
  }
  bind($('#negExtra'), state.project.style, 'negative_extra', { lines: true });
}

/* ---------- assets ---------- */
const GROUPS = { characters: '#charList', locations: '#locList', props: '#propList' };
function addAsset(group) {
  state.project.assets[group].push({ id: uid(), name: '', traits: '', wardrobe: '', description: '', light: '', refs: [] });
  scheduleSave(); renderAssets();
}
function renderAssets() {
  for (const [group, sel] of Object.entries(GROUPS)) {
    const box = $(sel); box.innerHTML = '';
    for (const a of state.project.assets[group]) box.append(assetCard(group, a));
  }
}
function assetCard(group, a) {
  const node = $('#tplAsset').content.firstElementChild.cloneNode(true);
  bind($('.a-name', node), a, 'name').oninput = (e) => { a.name = e.target.value.replace(/\s+/g, ''); e.target.value = a.name; scheduleSave(); renderShotEditor(); };
  const traits = $('.a-traits', node), ward = $('.a-wardrobe', node), desc = $('.a-desc', node), light = $('.a-light', node);
  if (group === 'characters') { bind(traits, a, 'traits'); bind(ward, a, 'wardrobe'); desc.remove(); light.remove(); }
  else { traits.remove(); ward.remove(); bind(desc, a, 'description'); if (group === 'locations') bind(light, a, 'light'); else light.remove(); }
  $('.a-del', node).onclick = () => { if (!confirm('Удалить?')) return; state.project.assets[group] = state.project.assets[group].filter((x) => x !== a); scheduleSave(); renderAssets(); renderShotEditor(); };
  const refs = $('.refs', node);
  for (const m of a.refs || []) refs.append(refThumb(m, () => { a.refs = a.refs.filter((x) => x !== m); scheduleSave(); renderAssets(); }));
  $('.a-file', node).onchange = async (e) => {
    for (const f of e.target.files) { const m = await uploadMedia(f); a.refs.push(m); }
    scheduleSave(); renderAssets();
  };
  return node;
}
function refThumb(m, onDel) {
  const media = m.kind === 'video' ? el('video', { src: m.url, muted: '', loop: '' }) : el('img', { src: m.url, alt: m.label || '' });
  media.onclick = () => lightbox(m.kind === 'video' ? el('video', { src: m.url, controls: '', autoplay: '' }) : el('img', { src: m.url }));
  return el('div', { class: 'ref', title: m.label || '' }, media, el('button', { class: 'x', onclick: onDel }, '×'), el('div', { class: 'hf' }, m.hf_id ? 'hf ✓' : 'локально'));
}
async function uploadMedia(file) {
  const fd = new FormData(); fd.append('file', file);
  return api(`/api/projects/${state.project.id}/media`, { method: 'POST', body: fd });
}
function lightbox(node) { $('#lbBody').innerHTML = ''; $('#lbBody').append(node); $('#lightbox').hidden = false; }

/* ---------- shots ---------- */
function blankShot() {
  return { id: uid(), title: `Shot ${state.project.shots.length + 1}`, duration: 5, type: '', scene_context: '', characters: [], location: null, props: [],
    first_frame: '', camera: '', beats: [{ from: 0, to: 2, action: '' }], acting: [], physics: '', lighting: '',
    audio: { dialogue: [], sfx: '', room_tone: '' }, what_we_read: '', purpose: '', locks: [], negative_extra: '', start_image: null, end_image: null, video_refs: [] };
}
function addShot() { const s = blankShot(); state.project.shots.push(s); state.shotId = s.id; scheduleSave(); renderShotTabs(); renderShotEditor(); }
function renderShotTabs() {
  const box = $('#shotTabs'); box.innerHTML = '';
  state.project.shots.forEach((s, i) => {
    box.append(el('div', { class: 'tab' + (s.id === state.shotId ? ' active' : ''), onclick: () => { state.shotId = s.id; renderShotTabs(); renderShotEditor(); } },
      `${i + 1}. ${s.title || ''}`, el('span', { class: 'dur' }, `${s.duration || 0}s`)));
  });
  const total = state.project.shots.reduce((n, s) => n + Number(s.duration || 0), 0);
  box.append(el('span', { class: 'muted' }, `Σ ${total}s`));
}
function renderShotEditor(target, shotId) {
  const box = target || $('#shotEditor'); box.innerHTML = '';
  const s = state.project.shots.find((x) => x.id === (shotId || state.shotId));
  if (!s) { box.append(el('div', { class: 'muted' }, 'Добавь первый план.')); return; }
  const p = state.project;
  const i = p.shots.indexOf(s);

  const card = (title, cls, ...kids) => el('div', { class: 'card ' + (cls || '') }, el('h4', {}, title), ...kids);
  const L = (text, input, hint) => el('label', {}, text, input, hint ? el('span', { class: 'hint' }, hint) : null);

  // 1. basics
  box.append(card('План', '',
    el('div', { class: 'row3' },
      L('Название', bind(el('input'), s, 'title')),
      L('Секунд', bind(el('input', { type: 'number', min: 2, max: 30 }), s, 'duration', { number: true })),
      L('Порядок', el('div', { class: 'actions' },
        el('button', { class: 'mini', onclick: () => moveShot(i, -1) }, '←'), el('button', { class: 'mini', onclick: () => moveShot(i, 1) }, '→'),
        el('button', { class: 'mini', onclick: () => duplicateShot(i) }, 'дубль'), el('button', { class: 'mini danger', onclick: () => deleteShot(i) }, '×')))),
    L('Крупность + носитель + движение', bind(el('input'), s, 'type'), 'напр. WAIST-UP, handheld, slight ~5% push-in'),
    L('Контекст сцены', bind(el('textarea', { rows: 2 }), s, 'scene_context')),
    L('Что зритель читает по лицам', bind(el('textarea', { rows: 2 }), s, 'what_we_read')),
    L('Зачем этот план', bind(el('input'), s, 'purpose')),
  ));

  // 2. who/where
  const chips = (list, isOn, toggle) => el('div', { class: 'chips' }, list.length ? list.map((a) => el('span', { class: 'chip' + (isOn(a) ? ' on' : ''), onclick: () => { toggle(a); scheduleSave(); renderShotEditor(); } }, a.name || '(без имени)')) : el('span', { class: 'hint' }, 'нет — добавь слева'));
  box.append(card('Кто и где в кадре', '',
    L('Персонажи', chips(p.assets.characters, (a) => s.characters.includes(a.id), (a) => { s.characters = s.characters.includes(a.id) ? s.characters.filter((x) => x !== a.id) : [...s.characters, a.id]; })),
    L('Локация', chips(p.assets.locations, (a) => s.location === a.id, (a) => { s.location = s.location === a.id ? null : a.id; })),
    L('Реквизит', chips(p.assets.props, (a) => s.props.includes(a.id), (a) => { s.props = s.props.includes(a.id) ? s.props.filter((x) => x !== a.id) : [...s.props, a.id]; })),
    L('Первый кадр и блокинг (координаты в %)', bind(el('textarea', { rows: 3 }), s, 'first_frame'), 'напр. Rosa at 35%x/55%y, phone in left hand already lit; window right edge'),
    L('Камера (движение с величиной)', bind(el('textarea', { rows: 2 }), s, 'camera'), 'напр. locked off, only ~5% push-in over the shot, breathing jitter'),
  ));

  // 3. beats
  const beatsBox = el('div', { class: 'beats' });
  const renderBeats = () => {
    beatsBox.innerHTML = '';
    s.beats.forEach((b, bi) => beatsBox.append(el('div', { class: 'beat' },
      bind(el('input', { type: 'number', step: '0.5', placeholder: 'от' }), b, 'from', { number: true }),
      bind(el('input', { type: 'number', step: '0.5', placeholder: 'до' }), b, 'to', { number: true }),
      bind(el('input', { placeholder: 'что происходит (действие, не эмоция)' }), b, 'action'),
      el('button', { class: 'mini danger', onclick: () => { s.beats.splice(bi, 1); scheduleSave(); renderBeats(); } }, '×'))));
    beatsBox.append(el('button', { class: 'mini', onclick: () => { const last = s.beats.at(-1); s.beats.push({ from: last ? last.to : 0, to: Math.min(s.duration, (last ? last.to : 0) + 2), action: '' }); scheduleSave(); renderBeats(); } }, '+ бит'));
  };
  renderBeats();
  const actingBox = el('div', { class: 'acting' });
  const renderActing = () => {
    actingBox.innerHTML = '';
    for (const cid of s.characters) {
      const c = p.assets.characters.find((x) => x.id === cid); if (!c) continue;
      let a = s.acting.find((x) => x.character === cid); if (!a) { a = { character: cid, behaviour: '' }; s.acting.push(a); }
      actingBox.append(el('div', { class: 'act' }, el('span', { class: 'muted' }, '@' + c.name), bind(el('textarea', { rows: 2, placeholder: 'микроповедение: jaw tightens, one slow blink, lean back 3 cm; NOT "worried"' }), a, 'behaviour')));
    }
    if (!s.characters.length) actingBox.append(el('span', { class: 'hint' }, 'выбери персонажей'));
  };
  renderActing();
  box.append(card('Тайминг по секундам и игра', 'wide', L('Биты (0–1s: …, 1–4s: …)', beatsBox), L('Актёрская игра по персонажам', actingBox),
    L('Физика в этом плане', bind(el('input'), s, 'physics'), 'что проминается, колышется, падает'),
    L('Свет в этом плане', bind(el('input'), s, 'lighting'), 'сверено с планом 1; источники в кадре')));

  // 4. audio
  s.audio ||= { dialogue: [], sfx: '', room_tone: '' };
  const dlgBox = el('div', { class: 'dialog' });
  const renderDlg = () => {
    dlgBox.innerHTML = '';
    s.audio.dialogue.forEach((d, di) => {
      const sel = el('select'); fillSelect(sel, [['', 'off-screen'], ...p.assets.characters.map((c) => [c.id, '@' + c.name])], d.character || '');
      sel.onchange = () => { d.character = sel.value; scheduleSave(); };
      dlgBox.append(el('div', { class: 'dl' }, sel, bind(el('input', { placeholder: 'реплика дословно' }), d, 'line'), bind(el('input', { placeholder: 'подача: from the chest, cracked' }), d, 'delivery'),
        el('button', { class: 'mini danger', onclick: () => { s.audio.dialogue.splice(di, 1); scheduleSave(); renderDlg(); } }, '×')));
    });
    dlgBox.append(el('button', { class: 'mini', onclick: () => { s.audio.dialogue.push({ character: '', line: '', delivery: '' }); scheduleSave(); renderDlg(); } }, '+ реплика'));
  };
  renderDlg();
  box.append(card('Звук (без музыки — она в сборке)', '', L('Реплики', dlgBox),
    L('Шумы и события', bind(el('input'), s.audio, 'sfx'), 'только фон и тело: шаги, ткань, дыхание; событийные SFX отдельно'),
    L('Room tone', bind(el('input'), s.audio, 'room_tone'), 'fridge hum, distant traffic, then silence')));

  // 5. frames + locks
  const framePick = (key, label) => {
    const m = s[key];
    const row = el('div', { class: 'frame-pick' });
    if (m) row.append(el('img', { src: m.url, onclick: () => lightbox(el('img', { src: m.url })) }), el('button', { class: 'mini danger', onclick: () => { s[key] = null; scheduleSave(); renderShotEditor(); } }, '×'));
    const file = el('input', { type: 'file', accept: 'image/*', hidden: '' });
    file.onchange = async (e) => { if (e.target.files[0]) { s[key] = await uploadMedia(e.target.files[0]); scheduleSave(); renderShotEditor(); } };
    row.append(el('label', { class: 'upl' }, 'загрузить', file));
    if (key === 'start_image') row.append(el('button', { class: 'mini', onclick: () => generateStill(s) }, 'сгенерить кадр (Nano Banana Pro, ~2 кр.)'));
    if (key === 'start_image' && i > 0) row.append(el('span', { class: 'hint' }, 'или «→ старт-кадр след. плана» из прогона предыдущего'));
    return L(label, row);
  };
  box.append(card('Опорные кадры', '', framePick('start_image', 'Старт-кадр (фиксирует свет, композицию, лицо; бесплатно для видео)'), framePick('end_image', 'Конечный кадр (для сцепки со следующим планом)')));
  box.append(card('Замки и запреты', '', L('Locks (по строке — чеклист проверки результата)', bind(el('textarea', { rows: 3 }), s, 'locks', { lines: true })),
    L('Доп. NEGATIVE для этого плана', bind(el('input'), s, 'negative_extra'), 'предвидь провал: no cap on head, no sign on the door')));
}
function moveShot(i, d) { const a = state.project.shots; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; scheduleSave(); renderShotTabs(); renderShotEditor(); }
function duplicateShot(i) { const c = structuredClone(state.project.shots[i]); c.id = uid(); c.title += ' copy'; state.project.shots.splice(i + 1, 0, c); state.shotId = c.id; scheduleSave(); renderShotTabs(); renderShotEditor(); }
function deleteShot(i) { if (!confirm('Удалить план?')) return; state.project.shots.splice(i, 1); state.shotId = state.project.shots[Math.max(0, i - 1)]?.id || null; scheduleSave(); renderShotTabs(); renderShotEditor(); }

async function generateStill(s) {
  const r = await api(`/api/projects/${state.project.id}/compile`, { method: 'POST', body: { shotIds: [s.id] } }).catch((e) => ({ error: e.message }));
  if (r.error) return alert(r.error);
  const prompt = window.prompt('Промпт для старт-кадра (первый кадр плана, статика):', `First frame of the shot, still photograph. ${r.prompt.slice(0, 1500)}`);
  if (!prompt) return;
  const refs = [];
  for (const cid of s.characters) for (const m of (state.project.assets.characters.find((c) => c.id === cid)?.refs || [])) refs.push(m.id);
  const loc = state.project.assets.locations.find((l) => l.id === s.location); for (const m of loc?.refs || []) refs.push(m.id);
  $('#saveState').textContent = 'генерю кадр…';
  try {
    const m = await api(`/api/projects/${state.project.id}/still`, { method: 'POST', body: { model: 'nano_banana_pro', prompt, refs } });
    s.start_image = m; scheduleSave(); renderShotEditor();
  } catch (e) { alert('Ошибка кадра: ' + e.message + '\n' + (e.detail || '')); }
}

/* ---------- model catalog ---------- */
async function loadCatalog() {
  const known = state.meta.video_models;
  let cat = { video: [] };
  try { cat = await api('/api/catalog'); } catch (e) { /* CLI offline: fall back to known models */ }
  const live = cat.video.map((m) => [m.job_type, `${m.display_name} (${m.job_type})${m.kind === 'workflow' ? ' · workflow' : ''}`]);
  const knownFirst = Object.entries(known).map(([k, v]) => [k, '★ ' + v.label]);
  const rest = live.filter(([k]) => !known[k]).sort((a, b) => a[1].localeCompare(b[1]));
  fillSelect($('#genModel'), [...knownFirst, ...rest], localStorage.getItem('vs.model') || 'cinematic_studio_video_4_0');
}
const schemaCache = new Map();
async function modelSchema(jobType) {
  if (!schemaCache.has(jobType)) schemaCache.set(jobType, api(`/api/models/${jobType}`).catch(() => null));
  return schemaCache.get(jobType);
}

/* ---------- generation ---------- */
function currentScope() {
  return $('#genScope').value === 'current' && state.shotId ? { shotIds: [state.shotId] } : {};
}
const HIDDEN_PARAMS = new Set(['prompt', 'aspect_ratio', 'image_references', 'video_references', 'audio_references', 'start_image', 'end_image', 'width', 'height', 'folder_id', 'medias', 'model']);
async function renderGenParams() {
  const model = $('#genModel').value;
  localStorage.setItem('vs.model', model);
  const known = state.meta.video_models[model];
  const box = $('#genParams'); box.innerHTML = '';
  box.append(el('span', { class: 'hint' }, 'загружаю схему модели…'));
  const schema = await modelSchema(model);
  if ($('#genModel').value !== model) return;
  box.innerHTML = '';
  const defaults = known?.defaults || {};
  const params = schema?.params || [];
  if (!params.length && known) {
    for (const [k, f] of Object.entries(known.fields)) params.push(Array.isArray(f) ? { name: k, type: 'string', enum: f } : f === 'bool' ? { name: k, type: 'boolean' } : { name: k, type: 'integer', min: f.min, max: f.max });
  }
  const advanced = el('div', { class: 'params' });
  for (const prm of params) {
    if (HIDDEN_PARAMS.has(prm.name)) continue;
    const def = defaults[prm.name] ?? prm.default;
    const type = String(prm.type || 'string');
    let input;
    if (prm.enum) { input = el('select'); fillSelect(input, [...(def == null ? [['', '—']] : []), ...prm.enum.map((x) => [x, x])], def == null ? '' : String(def)); }
    else if (type.startsWith('boolean')) { input = el('select'); fillSelect(input, [['', '—'], ['true', 'да'], ['false', 'нет']], def == null ? '' : String(def)); }
    else if (type.startsWith('integer') || type.startsWith('number')) { input = el('input', { type: 'number', step: type.startsWith('integer') ? '1' : 'any', min: prm.min, max: prm.max, value: def ?? '' }); }
    else if (type.startsWith('string')) { input = el('input', { value: def ?? '', placeholder: type.includes('null') ? 'необязательно' : '' }); }
    else continue; // objects/arrays are not editable here
    input.dataset.param = prm.name;
    input.dataset.type = type;
    const lab = el('label', {}, prm.name + (prm.required ? ' *' : ''), input);
    (known?.fields?.[prm.name] || prm.name === 'duration' || prm.name === 'resolution' || prm.name === 'mode' ? box : advanced).append(lab);
  }
  if (advanced.childElementCount) {
    const det = el('details', {}, el('summary', {}, `ещё ${advanced.childElementCount} параметров модели`), advanced);
    det.style.gridColumn = '1 / -1';
    box.append(det);
  }
  if (!params.length) box.append(el('span', { class: 'hint' }, 'схема недоступна, параметры по умолчанию модели'));
}
function readParams() {
  const out = {};
  for (const inp of $$('#genParams [data-param]')) {
    const v = inp.value; if (v === '') continue;
    const t = inp.dataset.type || '';
    out[inp.dataset.param] = t.startsWith('boolean') ? v === 'true' : (t.startsWith('integer') || t.startsWith('number')) ? Number(v) : v;
  }
  return out;
}
function genBody() {
  const body = { ...currentScope(), model: $('#genModel').value, params: readParams(), n: Number($('#genN').value) || 1, label: $('#genLabel').value };
  if ($('#promptOverride').checked && $('#promptPreview').value.trim()) body.promptOverride = $('#promptPreview').value;
  return body;
}
async function compile() {
  try {
    const r = await api(`/api/projects/${state.project.id}/compile`, { method: 'POST', body: currentScope() });
    $('#promptPreview').value = r.prompt; $('#promptOverride').checked = false;
    $('#warnings').textContent = r.warnings.join('\n');
    $('#estimate').textContent = `${r.chars} символов, ${r.total_seconds}s, референсов: ${r.references.length}`;
  } catch (e) { $('#warnings').textContent = e.message; }
}
async function estimate() {
  $('#estimate').textContent = 'считаю…';
  try {
    const r = await api(`/api/projects/${state.project.id}/estimate`, { method: 'POST', body: genBody() });
    $('#promptPreview').value = r.prompt;
    $('#estimate').innerHTML = `за вариант <b>${r.per_variant ?? '?'}</b> кр. × ${r.n} = <b>${r.total ?? '?'}</b> кр. (≈ $${r.total ? (r.total * 0.0625).toFixed(2) : '?'}) · медиа: ${Object.entries(r.medias).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : 1}`).join(', ') || 'нет'}`;
    $('#warnings').textContent = r.warnings.join('\n');
  } catch (e) { $('#estimate').innerHTML = `<span class="err">${e.message}\n${e.detail || ''}</span>`; }
}
async function generate() {
  const body = genBody();
  if (!confirm(`Запустить ${body.n} вариант(ов) на ${body.model}? Кредиты списываются.`)) return;
  try {
    await api(`/api/projects/${state.project.id}/runs`, { method: 'POST', body });
    await loadRuns();
  } catch (e) { $('#estimate').innerHTML = `<span class="err">${e.message}\n${e.detail || ''}</span>`; }
}

/* ---------- runs ---------- */
async function loadRuns() {
  state.runs = await api(`/api/projects/${state.project.id}/runs`);
  renderRuns();
  clearTimeout(state.pollTimer);
  if (state.runs.some((r) => ['starting', 'running'].includes(r.status) || r.variants.some((v) => v.post?.status === 'running'))) state.pollTimer = setTimeout(loadRuns, 5000);
}
function compareView() {
  const done = state.runs.flatMap((r) => r.variants.filter((v) => v.file).map((v) => ({ r, v })));
  if (!done.length) return alert('Нет готовых вариантов.');
  const grid = el('div', { class: 'compare' }, ...done.map(({ r, v }) => el('div', { class: 'cmp' + (r.pick?.variant === v.index ? ' picked' : '') },
    el('video', { src: (v.post?.file) || v.file, controls: '', muted: '', loop: '', preload: 'metadata' }),
    el('div', { class: 'hint' }, `${r.label || r.id.slice(0, 8)} · v${v.index} · ${r.model}${r.pick?.variant === v.index ? ` · ${r.pick.score ?? ''}/10` : ''}`))));
  const playAll = el('button', { class: 'btn', onclick: () => $$('.compare video').forEach((x) => { x.currentTime = 0; x.play(); }) }, '▶ все сразу');
  lightbox(el('div', {}, playAll, grid));
}
function renderRuns() {
  if (window.flowRefresh) window.flowRefresh();
  if (window.galleryView) window.galleryView.load(true);
  const box = $('#runs'); box.innerHTML = '';
  if (!state.runs.length) box.append(el('div', { class: 'hint' }, 'Прогонов ещё нет.'));
  else box.append(el('div', { class: 'actions' }, el('button', { class: 'btn ghost', onclick: compareView }, 'Сравнить все варианты')));
  for (const r of state.runs) box.append(runCard(r));
}
function runCard(r) {
  const shotsLabel = r.shot_ids.map((id) => state.project.shots.findIndex((s) => s.id === id) + 1).filter((n) => n > 0).join(',');
  const head = el('div', { class: 'run-head' },
    el('span', {}, el('b', {}, r.label || r.id.slice(0, 8)), ` · ${r.model} · планы ${shotsLabel || '?'} · ${r.params.duration}s ${r.params.resolution || r.params.mode || ''} · N=${r.n}`),
    el('span', { class: 'st ' + r.status }, r.status),
    el('button', { class: 'mini danger', title: 'удалить прогон', onclick: async () => { if (confirm('Удалить прогон и файлы?')) { await api(`/api/projects/${state.project.id}/runs/${r.id}`, { method: 'DELETE' }); loadRuns(); } } }, '×'));
  const card = el('div', { class: 'run' }, head, el('div', { class: 'hint' }, new Date(r.created_at).toLocaleString('ru-RU')), r.error ? el('div', { class: 'err' }, r.error) : null);
  const vs = el('div', { class: 'variants' });
  for (const v of r.variants) vs.append(variantCard(r, v));
  card.append(vs);
  card.append(el('details', {}, el('summary', {}, 'промпт прогона'), el('textarea', { rows: 8, readonly: '' }, r.prompt)));
  return card;
}
function variantCard(r, v) {
  const picked = r.pick?.variant === v.index;
  const c = el('div', { class: 'variant' + (picked ? ' picked' : '') });
  c.append(el('div', { class: 'run-head' }, el('span', {}, `v${v.index}`, picked ? ` · выбран ${r.pick.score != null ? r.pick.score + '/10' : ''}` : ''), el('span', { class: 'st ' + v.status }, v.status)));
  if (v.error) c.append(el('div', { class: 'err' }, v.error, v.job_id ? el('button', { class: 'mini', onclick: async () => { await api(`/api/projects/${state.project.id}/runs/${r.id}/recover`, { method: 'POST' }); loadRuns(); } }, ' повторить скачивание') : null));
  if (v.file) {
    c.append(el('video', { src: v.file, controls: '', preload: 'metadata' }));
    if (v.post?.status === 'completed' && v.post.file && v.post.action === 'film') c.append(el('div', { class: 'hint' }, `после поста (${v.post.engine || 'ffmpeg'} ${v.post.preset}):`), el('video', { src: v.post.file, controls: '', preload: 'metadata' }));
    if (v.sheet) c.append(el('img', { class: 'sheet', src: v.sheet, onclick: () => lightbox(el('img', { src: v.sheet })) }));
    const m = v.metrics || {};
    c.append(el('div', { class: 'metrics' }, `${m.width}×${m.height}`, `${m.fps} fps`, `${m.bitrate_kbps} kbps`, `${(m.duration || 0).toFixed(1)}s`, m.audio ? `${m.audio.channels}ch ${m.audio.sample_rate}Hz` : 'без звука', `склеек ${m.cuts ?? '?'}`, `фризов ${m.freezes ?? '?'}`,
      ...(m.flags || []).map((f) => el('span', { class: 'flag' }, f))));
    const score = el('input', { type: 'number', min: 1, max: 10, placeholder: '/10', value: picked ? r.pick.score ?? '' : '' });
    const note = el('input', { class: 'note', placeholder: 'почему / что не так', value: picked ? r.pick.note : '' });
    c.append(el('div', { class: 'v-actions' },
      el('button', { class: 'btn ' + (picked ? 'primary' : ''), onclick: async () => { await api(`/api/projects/${state.project.id}/runs/${r.id}/pick`, { method: 'POST', body: { variant: v.index, score: score.value || null, note: note.value } }); loadRuns(); } }, picked ? 'выбран' : 'выбрать'),
      score, note,
      el('button', { class: 'mini', title: 'последний кадр этого варианта -> старт-кадр следующего плана', onclick: () => lastFrameToNext(r, v) }, '→ старт-кадр след. плана'),
      postControls(r, v),
      el('a', { class: 'mini', href: v.file, download: '' }, 'скачать')));
  }
  return c;
}
const POST_PRESETS = [['camera', 'camera — физика камеры, резкость не трогает'], ['tiktok', 'tiktok — темно, зерно ×3, чёрное в ноль'], ['phone', 'phone — снято на телефон (рилсы/UGC)'], ['medium', 'medium — убрать пластик (реклама)'], ['light', 'light — только тени'], ['film', 'film — кино: ореол + дрожание'], ['camcorder', 'camcorder — общие планы']];
const FFMPEG_ONLY_PRESETS = new Set(['camera', 'tiktok']); // в scripts/post-blender.sh этих пресетов нет
function postControls(r, v) {
  if (v.post?.status === 'running') return el('span', { class: 'hint' }, `пост ${v.post.preset || v.post.action}: считаю…`);
  const sel = el('select', { title: 'пресет пост-обработки (без кредитов)' }); fillSelect(sel, POST_PRESETS, v.post?.preset || 'phone');
  const eng = el('select', { title: 'движок: ffmpeg быстрый, Blender чище (32-бит float, нодовый композ)' }); fillSelect(eng, [['ffmpeg', 'ffmpeg (быстро, ~1 мин)'], ['blender', 'Blender (маски, трекинг, ~4 мин)']], v.post?.engine || 'ffmpeg');
  const syncPresets = () => {
    const list = eng.value === 'blender' ? POST_PRESETS.filter(([k]) => !FFMPEG_ONLY_PRESETS.has(k)) : POST_PRESETS;
    fillSelect(sel, list, list.some(([k]) => k === sel.value) ? sel.value : 'phone');
  };
  eng.onchange = syncPresets; syncPresets();
  const run = el('button', { class: 'mini', onclick: async () => { await api(`/api/projects/${state.project.id}/runs/${r.id}/post`, { method: 'POST', body: { variant: v.index, action: 'film', params: { preset: sel.value, engine: eng.value } } }); loadRuns(); } }, 'Пост');
  const wrap = el('span', { class: 'post-ctl' }, sel, eng, run);
  if (v.post?.status === 'completed' && v.post.file) wrap.append(el('a', { class: 'mini', href: v.post.file, target: '_blank' }, `▶ пост ${v.post.engine || ''} ${v.post.preset || v.post.action}`), el('a', { class: 'mini', href: v.post.file, download: '' }, 'скачать'));
  if (v.post?.status === 'failed') wrap.append(el('span', { class: 'err' }, ` пост: ${v.post.error}`));
  return wrap;
}
async function lastFrameToNext(r, v) {
  const lastShotId = r.shot_ids.at(-1);
  const idx = state.project.shots.findIndex((s) => s.id === lastShotId);
  const next = state.project.shots[idx + 1];
  if (!next) return alert('После этого плана нет следующего.');
  const m = await api(`/api/projects/${state.project.id}/runs/${r.id}/last-frame`, { method: 'POST', body: { variant: v.index } });
  next.start_image = m; scheduleSave(); state.shotId = next.id; renderShotTabs(); renderShotEditor();
}

boot().catch((e) => { document.body.prepend(el('div', { class: 'err' }, 'Ошибка запуска: ' + e.message)); });
