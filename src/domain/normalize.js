// Приводит проект к каноническому виду: проект может прийти из API, из старого формата или собранным руками.
// Вызывается при каждом сохранении, поэтому компилятор и интерфейс всегда видят одни и те же типы.
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function normalizeShot(s = {}) {
  const shot = { ...s };
  shot.title = str(shot.title);
  shot.duration = Number(shot.duration) || 5;
  shot.type = str(shot.type);
  shot.characters = arr(shot.characters);
  shot.props = arr(shot.props);
  shot.location = shot.location || null;
  shot.beats = arr(shot.beats).filter((b) => b && typeof b === 'object');
  shot.acting = arr(shot.acting).filter((a) => a && typeof a === 'object');
  shot.locks = arr(shot.locks).map(str).filter(Boolean);
  shot.video_refs = arr(shot.video_refs);
  // звук: строка или список строк -> {dialogue, sfx, room_tone}
  const a = shot.audio;
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    shot.audio = { dialogue: [], sfx: Array.isArray(a) ? a.map(str).join('; ') : str(a), room_tone: '' };
  } else {
    shot.audio = {
      dialogue: arr(a.dialogue).filter((d) => d && typeof d === 'object'),
      sfx: str(a.sfx),
      room_tone: str(a.room_tone),
    };
  }
  for (const k of ['scene_context', 'first_frame', 'camera', 'physics', 'lighting', 'what_we_read', 'purpose', 'negative_extra', 'clutter']) shot[k] = str(shot[k]);
  return shot;
}

export function normalizeProject(p = {}) {
  const proj = { ...p };
  proj.format = { aspect: '16:9', resolution: '1080p', ...(proj.format || {}) };
  proj.summary = { who_and_where: '', what_happens: '', tone: '', what_we_read: '', what_we_do_not_show: '', purpose: '', ...(proj.summary || {}) };
  proj.style = { preset: 'cinema_drama', style: {}, negative_extra: [], ...(proj.style || {}) };
  proj.style.negative_extra = arr(proj.style.negative_extra).map(str).filter(Boolean);
  proj.assets = { characters: [], locations: [], props: [], ...(proj.assets || {}) };
  for (const g of ['characters', 'locations', 'props']) {
    proj.assets[g] = arr(proj.assets[g]).map((a) => ({ ...a, refs: arr(a?.refs) }));
  }
  proj.shots = arr(proj.shots).map(normalizeShot);
  proj.media_library = arr(proj.media_library);
  return proj;
}
