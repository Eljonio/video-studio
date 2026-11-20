/* Галерея: все сгенерированные видео проекта (или всех проектов), новые сверху. */
(() => {
  let timer = null, seen = new Set(), pending = 0, active = false, mode = 'video';

  const opts = () => ({
    all: $('#galAll')?.checked,
    picked: $('#galPicked')?.checked,
    auto: $('#galAuto')?.checked,
  });

  async function load(silent) {
    if (!state.project) return;
    const o = opts();
    const url = o.all ? '/api/gallery?scope=all' : `/api/gallery?scope=project&project=${state.project.id}`;
    let data;
    try { data = await api(url); } catch (e) { $('#galCount').textContent = e.message; return; }
    state.gallery = data.items;
    // новые готовые ролики: считаем как непрочитанные, пока вкладка закрыта
    let fresh = 0;
    for (const it of data.items) {
      const key = `${it.run_id}:${it.index}`;
      if (it.file && !seen.has(key)) { seen.add(key); if (!silent && !active) fresh++; }
    }
    if (fresh) { pending += fresh; }
    renderBadge();
    if (active) render();
    const busy = data.items.some((i) => ['running', 'queued', 'submitting', 'analysing'].includes(i.status));
    clearTimeout(timer);
    if (o.auto && (busy || active)) timer = setTimeout(() => load(true), busy ? 6000 : 15000);
  }

  function renderBadge() {
    const b = $('#galBadge');
    if (!b) return;
    b.hidden = pending === 0;
    b.textContent = pending > 99 ? '99+' : String(pending);
  }

  function renderFrames() {
    const grid = $('#galGrid'); grid.innerHTML = '';
    const p = state.project; if (!p) return;
    $('#galCount').textContent = `${p.shots.length} планов · ${p.shots.reduce((n, s) => n + (+s.duration || 0), 0)} с`;
    p.shots.forEach((s, i) => {
      const c = el('div', { class: 'frame-card' + (s.start_image ? '' : ' empty') });
      if (s.start_image) {
        c.append(el('div', { class: 'fh' }, el('b', {}, `${i + 1}. ${s.title}`), el('span', { class: 'hint' }, `${s.duration}с`)));
        c.append(el('img', { src: s.start_image.url, onclick: () => lightbox(el('img', { src: s.start_image.url })) }));
        c.append(el('div', { class: 'fb' }, (s.first_frame || '').slice(0, 150)));
      } else {
        c.append(el('div', {}, `${i + 1}. ${s.title} — кадра нет`));
      }
      c.append(el('div', { class: 'fa' },
        el('button', { class: 'mini', onclick: () => { state.shotId = s.id; if (window.setViewMode) window.setViewMode('forms'); renderShotTabs(); renderShotEditor(); } }, 'править план'),
        el('button', { class: 'mini', title: 'сгенерить кадр заново (~2 кр.)', onclick: async (e) => {
          e.target.textContent = '…';
          try { await api(`/api/projects/${p.id}/still-for-shot`, { method: 'POST', body: { shotId: s.id } }); state.project = await api(`/api/projects/${p.id}`); renderFrames(); }
          catch (err) { e.target.textContent = 'ошибка'; alert(err.message); }
        } }, s.start_image ? 'переснять' : 'сгенерить кадр')));
      grid.append(c);
    });
  }

  function render() {
    if (mode === 'frames') return renderFrames();
    const grid = $('#galGrid'); if (!grid) return;
    const o = opts();
    let items = state.gallery || [];
    if (o.picked) items = items.filter((i) => i.picked);
    $('#galCount').textContent = `${items.length} видео${o.all ? ' (все проекты)' : ''}`;
    grid.innerHTML = '';
    if (!items.length) { grid.append(el('div', { class: 'hint' }, 'Пока ничего не сгенерировано. Запусти прогон в панели справа.')); return; }
    for (const it of items) grid.append(card(it));
  }

  function fmtTime(s) {
    if (!s) return '';
    const d = new Date(s), now = new Date();
    const mins = Math.round((now - d) / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function card(it) {
    const c = el('div', { class: 'gcard' + (it.picked ? ' picked' : '') });
    const title = `${it.shots.length ? 'план ' + it.shots.join(',') + ' · ' : ''}${it.label} · v${it.index}`;
    c.append(el('div', { class: 'ghead' }, el('b', {}, title), el('span', { class: 'hint' }, fmtTime(it.created_at))));
    if (opts().all) c.append(el('div', { class: 'gproj' }, it.project_title));
    if (!it.file) {
      c.append(el('div', { class: 'gcard pending' }, it.error ? '⛔ ' + it.error.slice(0, 80) : `${it.status}…`));
      return c;
    }
    const src = it.post?.status === 'completed' && it.post.file ? it.post.file : it.file;
    const vid = el('video', { src, controls: '', preload: 'metadata', playsinline: '', poster: it.poster || '' });
    vid.addEventListener('dblclick', () => lightbox(el('video', { src, controls: '', autoplay: '', loop: '' })));
    c.append(vid);
    const m = it.metrics || {};
    c.append(el('div', { class: 'gmeta' },
      `${m.width || '?'}×${m.height || '?'}`, `${(m.duration || 0).toFixed(1)}с`, `${m.bitrate_kbps || '?'} kbps`,
      it.model, it.device ? `устройство: ${it.device}` : null,
      ...(m.flags || []).map((f) => el('span', { class: 'flag' }, f)),
      it.post?.status === 'completed' ? el('span', { class: 'hint' }, `пост: ${it.post.preset}`) : null));
    const score = el('input', { type: 'number', min: 1, max: 10, placeholder: '/10', value: it.score ?? '' });
    const pickBtn = el('button', { class: 'mini' + (it.picked ? ' danger' : ''), onclick: async () => {
      await api(`/api/projects/${it.project_id}/runs/${it.run_id}/pick`, { method: 'POST', body: { variant: it.index, score: score.value || null, note: it.note || '' } });
      load(true); if (typeof loadRuns === 'function') loadRuns();
    } }, it.picked ? `выбран ${it.score ?? ''}` : 'выбрать');
    const postSel = el('select', { title: 'пост-обработка' });
    fillSelect(postSel, POST_PRESETS, it.post?.preset || 'camera');
    const postBtn = el('button', { class: 'mini', title: 'обработать локально, без кредитов', onclick: async () => {
      postBtn.textContent = '…';
      await api(`/api/projects/${it.project_id}/runs/${it.run_id}/post`, { method: 'POST', body: { variant: it.index, action: 'film', params: { preset: postSel.value } } });
      load(true);
    } }, it.post?.status === 'running' ? '…' : 'пост');
    c.append(el('div', { class: 'gact' }, pickBtn, score, postSel, postBtn,
      el('a', { class: 'mini', href: it.file, download: '' }, '⭳'),
      it.sheet ? el('button', { class: 'mini', title: 'кадры', onclick: () => lightbox(el('img', { src: it.sheet })) }, 'кадры') : null));
    return c;
  }

  function setActive(on) {
    active = on;
    if (on) { pending = 0; renderBadge(); if (mode === 'frames') render(); else load(true); }
  }

  window.galleryView = { load, render, setActive, reset: () => { seen = new Set(); pending = 0; renderBadge(); } };

  window.addEventListener('DOMContentLoaded', () => {
    for (const id of ['galAll', 'galPicked']) $('#' + id).onchange = () => load(true);
    $('#galAuto').onchange = () => load(true);
    $('#galReload').onclick = () => load(true);
    $('#galModeVideo').onclick = () => { mode = 'video'; $('#galModeVideo').classList.add('on'); $('#galModeFrames').classList.remove('on'); render(); };
    $('#galModeFrames').onclick = () => { mode = 'frames'; $('#galModeFrames').classList.add('on'); $('#galModeVideo').classList.remove('on'); render(); };
    $('#galPlayAll').onclick = () => $$('#galGrid video').forEach((v) => { v.muted = true; v.loop = true; v.play().catch(() => {}); });
  });
})();
