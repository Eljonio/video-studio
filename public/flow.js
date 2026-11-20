/* Flow view: the same project as a graph. Nodes = assets, shots, runs. Edges = membership, order, generation. */
(() => {
  const NODE_W = 200;
  let mode = 'forms';
  let drag = null; // {node, dx, dy}
  let link = null; // {fromId, group, x, y}
  let selected = null; // {kind:'shot'|'asset', id, group}

  function layout() {
    const p = state.project;
    p.layout ||= {};
    return p.layout;
  }
  function pos(id, fallback) {
    const l = layout();
    if (!l[id]) l[id] = fallback;
    return l[id];
  }

  function setMode(m) {
    mode = m;
    for (const [id, name] of [['viewForms', 'forms'], ['viewFlow', 'flow'], ['viewGallery', 'gallery']]) $('#' + id).classList.toggle('on', m === name);
    $('#shotEditor').hidden = m !== 'forms';
    $('.shots-bar').hidden = m !== 'forms';
    $('#flow').hidden = m !== 'flow';
    $('#gallery').hidden = m !== 'gallery';
    if (m === 'flow') renderFlow();
    if (window.galleryView) window.galleryView.setActive(m === 'gallery');
    localStorage.setItem('vs.view', m);
  }
  window.setViewMode = setMode;

  function autoLayout() {
    const p = state.project;
    const l = layout();
    let y = 20;
    for (const [group, list] of [['characters', p.assets.characters], ['locations', p.assets.locations], ['props', p.assets.props]]) {
      for (const a of list) { l[a.id] = { x: 20, y }; y += a.refs?.length ? 190 : 110; }
    }
    p.shots.forEach((s, i) => { l[s.id] = { x: 320 + i * (NODE_W + 60), y: 40 }; });
    state.runs.forEach((r, i) => { l['run:' + r.id] = { x: 320 + i * (NODE_W + 60), y: 360 }; });
    scheduleSave();
    renderFlow();
  }

  function inspect(sel) {
    selected = sel;
    const box = $('#flowInspector'); box.innerHTML = '';
    $$('.node.selected').forEach((n) => n.classList.remove('selected'));
    const node = sel && $(`.node[data-id="${CSS.escape(sel.id)}"]`); if (node) node.classList.add('selected');
    if (!sel) { box.append(el('div', { class: 'hint' }, 'Кликни по узлу — здесь откроется его карточка для правки.')); return; }
    const p = state.project;
    if (sel.kind === 'shot') {
      const s = p.shots.find((x) => x.id === sel.id); if (!s) return inspect(null);
      state.shotId = s.id;
      box.append(el('h4', { class: 'insp' }, `План: ${s.title}`, el('button', { class: 'mini', onclick: () => { setMode('forms'); renderShotTabs(); renderShotEditor(); } }, 'открыть в формах')));
      const editor = el('div', { class: 'shot-editor' });
      box.append(editor);
      renderShotEditor(editor, s.id);
    } else if (sel.kind === 'asset') {
      const a = p.assets[sel.group].find((x) => x.id === sel.id); if (!a) return inspect(null);
      box.append(el('h4', { class: 'insp' }, `${{ characters: 'Персонаж', locations: 'Локация', props: 'Предмет' }[sel.group]}: ${a.name || ''}`));
      box.append(assetCard(sel.group, a));
    } else if (sel.kind === 'run') {
      const r = state.runs.find((x) => x.id === sel.id); if (!r) return inspect(null);
      box.append(el('h4', { class: 'insp' }, `Прогон: ${r.label || r.model}`));
      box.append(runCard(r));
    }
  }
  window.flowInspect = inspect;

  function nodeEl(cls, id, title, body, at) {
    const n = el('div', { class: 'node ' + cls + (selected?.id === id ? ' selected' : ''), 'data-id': id });
    n.style.left = at.x + 'px'; n.style.top = at.y + 'px';
    const head = el('div', { class: 'nh' }, el('span', {}, title));
    head.addEventListener('mousedown', (e) => { drag = { id, node: n, dx: e.clientX - at.x, dy: e.clientY - at.y }; e.preventDefault(); });
    n.append(head, el('div', { class: 'nb' }, ...(Array.isArray(body) ? body : [body])));
    return n;
  }

  function renderFlow() {
    const p = state.project; if (!p) return;
    const nodes = $('#flowNodes'); nodes.innerHTML = '';
    const edges = [];
    // assets
    const groups = [['characters', 'character'], ['locations', 'location'], ['props', 'prop']];
    let y = 20;
    for (const [group, cls] of groups) {
      for (const a of p.assets[group]) {
        const at = pos(a.id, { x: 20, y });
        y += a.refs?.length ? 190 : 110;
        const thumb = a.refs?.[0] ? el('img', { class: 'thumb', src: a.refs[0].url }) : null;
        const n = nodeEl(cls, a.id, a.name || '(без имени)', [group === 'characters' ? (a.traits || '').slice(0, 80) : (a.description || '').slice(0, 80), thumb], at);
        const port = el('div', { class: 'port out', title: 'тяни на план' });
        port.addEventListener('mousedown', (e) => { e.stopPropagation(); link = { fromId: a.id, group, x: e.clientX, y: e.clientY }; });
        n.append(port);
        n.addEventListener('mouseup', () => finishLink(null));
        n.addEventListener('click', () => { if (drag?.moved) return; inspect({ kind: 'asset', id: a.id, group }); });
        nodes.append(n);
      }
    }
    // shots
    p.shots.forEach((s, i) => {
      const at = pos(s.id, { x: 320 + i * (NODE_W + 60), y: 40 });
      const who = [
        ...s.characters.map((id) => p.assets.characters.find((c) => c.id === id)?.name).filter(Boolean).map((x) => '@' + x),
        s.location ? '@' + (p.assets.locations.find((l) => l.id === s.location)?.name || '') : null,
        ...s.props.map((id) => p.assets.props.find((c) => c.id === id)?.name).filter(Boolean).map((x) => '@' + x),
      ].filter(Boolean).join(' ');
      const body = [el('div', {}, `${s.duration}s · ${(s.type || '').slice(0, 40)}`), el('div', {}, who || 'никого в кадре'), s.start_image ? el('img', { class: 'thumb', src: s.start_image.url }) : null];
      const n = nodeEl('shot', s.id, `${i + 1}. ${s.title}`, body, at);
      n.append(el('div', { class: 'port in' }));
      n.addEventListener('mouseup', () => finishLink(s));
      n.addEventListener('mouseenter', () => { if (link) n.classList.add('drop-ok'); });
      n.addEventListener('mouseleave', () => n.classList.remove('drop-ok'));
      n.addEventListener('click', () => { if (drag?.moved) return; inspect({ kind: 'shot', id: s.id }); });
      nodes.append(n);
      for (const id of [...s.characters, s.location, ...s.props].filter(Boolean)) edges.push({ from: id, to: s.id, cls: 'member' });
      if (i > 0) edges.push({ from: p.shots[i - 1].id, to: s.id, cls: 'order' });
    });
    // runs
    state.runs.forEach((r, i) => {
      const id = 'run:' + r.id;
      const at = pos(id, { x: 320 + i * (NODE_W + 60), y: 360 });
      const vrow = el('div', { class: 'vrow' }, ...r.variants.filter((v) => v.frames?.length).map((v) => el('img', { class: r.pick?.variant === v.index ? 'picked' : '', src: v.frames[Math.floor(v.frames.length / 2)], title: `v${v.index}`, onclick: () => lightbox(el('video', { src: v.file, controls: '', autoplay: '' })) })));
      const n = nodeEl('run', id, `▶ ${r.label || r.model}`, [el('div', {}, `${r.model} · N=${r.n} · ${r.status}${r.pick ? ` · выбран v${r.pick.variant} ${r.pick.score ?? ''}/10` : ''}`), vrow], at);
      n.append(el('div', { class: 'port in' }));
      n.addEventListener('click', () => { if (drag?.moved) return; inspect({ kind: 'run', id }); });
      nodes.append(n);
      for (const sid of r.shot_ids) if (p.shots.some((s) => s.id === sid)) edges.push({ from: sid, to: id, cls: 'run' });
    });
    drawEdges(edges);
    if (selected) { const n = $(`.node[data-id="${CSS.escape(selected.id)}"]`); if (n) n.classList.add('selected'); }
  }

  function center(id, side) {
    const n = $(`.node[data-id="${CSS.escape(id)}"]`); if (!n) return null;
    const x = n.offsetLeft, y = n.offsetTop, w = n.offsetWidth, h = n.offsetHeight;
    return side === 'out' ? { x: x + w, y: y + 20 } : { x, y: y + 20 };
  }
  function drawEdges(list) {
    const svg = $('#flowEdges'); svg.innerHTML = '';
    for (const e of list) {
      const a = center(e.from, 'out'), b = center(e.to, 'in'); if (!a || !b) continue;
      const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`);
      path.setAttribute('class', e.cls);
      svg.append(path);
    }
  }
  function finishLink(shot) {
    if (!link) return;
    if (shot) {
      const s = shot, g = link.group, id = link.fromId;
      if (g === 'characters' && !s.characters.includes(id)) s.characters.push(id);
      if (g === 'props' && !s.props.includes(id)) s.props.push(id);
      if (g === 'locations') s.location = id;
      scheduleSave();
    }
    link = null;
    $$('.node.drop-ok').forEach((n) => n.classList.remove('drop-ok'));
    renderFlow();
  }

  document.addEventListener('mousemove', (e) => {
    if (drag) {
      const l = layout();
      const canvas = $('#flowCanvas');
      const x = Math.max(0, e.clientX - drag.dx), y = Math.max(0, e.clientY - drag.dy);
      l[drag.id] = { x, y };
      drag.node.style.left = x + 'px'; drag.node.style.top = y + 'px';
      drag.moved = true;
      renderEdgesOnly();
    }
  });
  document.addEventListener('mouseup', () => {
    if (drag) { scheduleSave(); setTimeout(() => { drag = null; }, 0); }
    if (link) { link = null; renderFlow(); }
  });
  function renderEdgesOnly() {
    // cheap: re-run full render of edges by recomputing from DOM
    const p = state.project; const edges = [];
    p.shots.forEach((s, i) => { for (const id of [...s.characters, s.location, ...s.props].filter(Boolean)) edges.push({ from: id, to: s.id, cls: 'member' }); if (i > 0) edges.push({ from: p.shots[i - 1].id, to: s.id, cls: 'order' }); });
    state.runs.forEach((r) => { for (const sid of r.shot_ids) edges.push({ from: sid, to: 'run:' + r.id, cls: 'run' }); });
    drawEdges(edges);
  }

  // ---- library panel ----
  async function renderLibrary() {
    const box = $('#library'); if (!box) return;
    let lib;
    try { lib = await api('/api/library'); } catch (e) { box.textContent = e.message; return; }
    state.library = lib;
    box.innerHTML = '';
    const names = { characters: 'персонажи', locations: 'локации', props: 'предметы' };
    let any = false;
    for (const [group, label] of Object.entries(names)) {
      const items = lib[group] || []; if (!items.length) continue;
      any = true;
      box.append(el('div', { class: 'lib-group' }, label));
      for (const it of items) {
        box.append(el('div', { class: 'lib-item' },
          it.refs?.[0] ? el('img', { src: it.refs[0].url }) : el('span', { class: 'hint' }, '·'),
          el('span', { class: 'nm', title: it.traits || it.description || '' }, it.name),
          el('button', { class: 'mini', title: 'добавить в проект', onclick: async () => { await api(`/api/projects/${state.project.id}/assets/from-library`, { method: 'POST', body: { group, itemId: it.id } }); state.project = await api(`/api/projects/${state.project.id}`); renderAssets(); renderShotEditor(); if (mode === 'flow') renderFlow(); } }, '→ в проект'),
          el('button', { class: 'mini danger', title: 'удалить из базы', onclick: async () => { if (confirm(`Удалить «${it.name}» из базы?`)) { await api(`/api/library/${group}/${it.id}`, { method: 'DELETE' }); renderLibrary(); } } }, '×')));
      }
    }
    if (!any) box.append(el('span', { class: 'hint' }, 'База пуста. У любого персонажа/локации/предмета проекта нажми «в базу».'));
  }
  window.renderLibrary = renderLibrary;

  // hook "в базу" buttons into asset cards (delegated)
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.a-lib'); if (!btn) return;
    const card = btn.closest('.asset');
    const name = $('.a-name', card).value;
    for (const group of ['characters', 'locations', 'props']) {
      const a = state.project.assets[group].find((x) => x.name === name && name);
      if (a) { await api(`/api/projects/${state.project.id}/assets/to-library`, { method: 'POST', body: { group, assetId: a.id } }); btn.textContent = 'в базе ✓'; renderLibrary(); return; }
    }
    alert('Сначала дай имя.');
  });

  window.addEventListener('DOMContentLoaded', () => {
    $('#viewForms').onclick = () => setMode('forms');
    $('#viewFlow').onclick = () => setMode('flow');
    $('#viewGallery').onclick = () => setMode('gallery');
    $('#flowAddShot').onclick = () => { addShot(); renderFlow(); inspect({ kind: 'shot', id: state.shotId }); };
    $('#flowAuto').onclick = autoLayout;
    $('#btnLibReload').onclick = renderLibrary;
  });
  // re-render flow when runs reload
  const origRenderRuns = window.renderRuns;
  window.flowRefresh = () => { if (mode === 'flow') renderFlow(); };
})();
