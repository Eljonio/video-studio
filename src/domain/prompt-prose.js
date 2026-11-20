// Prose compiler: DEVICE first, then scene, people, shots by seconds, sound, one NEGATIVE. Target 2.5-3.5k characters.
import { DEVICES, GLOSS_WORDS, ANTI_AI_NEGATIVE } from './devices.js';
import { LEGAL_BLOCK } from './style-presets.js';

const find = (list, id) => (list || []).find((a) => a.id === id) || null;

export function lintGloss(text) {
  const hits = [];
  for (const w of GLOSS_WORDS) {
    // whole-word match: 'ARRI' must not fire inside 'earrings' or 'arrival'
    const re = new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i');
    if (re.test(text)) hits.push(w);
  }
  return hits;
}

export function compileProse(project, shotIds) {
  const shots = (project.shots || []).filter((s) => !shotIds || shotIds.includes(s.id));
  const warnings = [];
  const deviceKey = project.device || (project.style?.preset === 'cinema_drama' || project.style?.preset === 'product_ad' ? 'cinema' : 'phone');
  const dev = DEVICES[deviceKey] || DEVICES.phone;
  const total = shots.reduce((n, s) => n + Number(s.duration || 0), 0);
  const aspect = project.format?.aspect || '16:9';

  // References: one role per image, numbered location -> characters -> props.
  const references = [];
  const refLabel = new Map();
  const used = { locations: new Set(), characters: new Set(), props: new Set() };
  for (const s of shots) { if (s.location) used.locations.add(s.location); (s.characters || []).forEach((c) => used.characters.add(c)); (s.props || []).forEach((p) => used.props.add(p)); }
  const addRefs = (asset, role) => {
    for (const m of asset.refs || []) {
      const label = `@Image${references.length + 1}`;
      references.push({ role: 'image_references', mediaRef: m, label, asset: asset.name, controls: role });
      if (!refLabel.has(asset.id)) refLabel.set(asset.id, []);
      refLabel.get(asset.id).push(label);
    }
  };
  for (const id of used.locations) { const a = find(project.assets?.locations, id); if (a) addRefs(a, 'the place'); }
  for (const id of used.characters) { const a = find(project.assets?.characters, id); if (a) addRefs(a, 'identity'); }
  for (const id of used.props) { const a = find(project.assets?.props, id); if (a) addRefs(a, 'exact product design'); }

  const lines = [];
  const cuts = Math.max(0, shots.length - 1);
  lines.push(`${shots.length === 1 ? 'ONE UNBROKEN' : `${shots.length}-SHOT`} ${total}-SECOND ${shots.length === 1 ? 'TAKE' : 'SEQUENCE'}, ${aspect}${cuts ? `, ${cuts} hard cut${cuts > 1 ? 's' : ''}` : ', no cuts'}. ${dev.medium}`);
  lines.push('');
  lines.push(`CAMERA = THE DEVICE AND THE PERSON HOLDING IT: ${dev.flaws} ${dev.forbid}`);
  lines.push('');

  // Scene
  const sm = project.summary || {};
  const sceneBits = [sm.who_and_where, sm.what_happens, sm.tone && `Tone: ${sm.tone}`, sm.what_we_read && `What we read: ${sm.what_we_read}`].filter(Boolean);
  if (sceneBits.length) { lines.push(`SCENE: ${sceneBits.join(' ')}`); lines.push(''); }

  // Location
  for (const id of used.locations) {
    const l = find(project.assets?.locations, id); if (!l) continue;
    const refs = refLabel.get(l.id);
    lines.push(`LOCATION${refs ? ` (${refs.join(', ')} controls only the place; do not copy people, camera angle or text from it)` : ''}: ${[l.description, l.light && `Light: ${l.light}`, l.clutter && `Clutter in frame: ${l.clutter}`].filter(Boolean).join(' ')}`);
    lines.push('');
  }
  // People
  for (const id of used.characters) {
    const c = find(project.assets?.characters, id); if (!c) continue;
    const refs = refLabel.get(c.id);
    const identity = refs
      ? `${refs.join(', ')} controls only ${c.name}'s identity: exactly this face, hair and body. Do not copy pose, background, lighting, camera angle or text from ${refs.join(', ')}.`
      : `${c.traits || 'ordinary person, not a model'}.`;
    lines.push(`@${c.name}: ${identity}${c.wardrobe ? ` Wardrobe, identical in every shot: ${c.wardrobe}.` : ''} Keep real fine pores and skin texture, forehead shine, under-eye shadows, uneven tone, an ordinary person, not a model. Same identity, proportions, clothing and hairstyle throughout.`);
    lines.push('');
  }
  for (const id of used.props) {
    const p = find(project.assets?.props, id); if (!p) continue;
    const refs = refLabel.get(p.id);
    lines.push(`@${p.name}: ${refs ? `${refs.join(', ')} controls only the exact product design; do not copy background, lighting, camera angle or any text from it. ` : `${p.description || ''} `}It stays the same object in every shot and never becomes a different item.`);
    lines.push('');
  }

  // Shots
  shots.forEach((s, i) => {
    const chars = (s.characters || []).map((id) => find(project.assets?.characters, id)).filter(Boolean);
    const head = shots.length === 1 ? 'THE TAKE' : `SHOT ${i + 1} (${s.duration || 5}s${s.type ? `, ${s.type}` : ''})`;
    const parts = [];
    if (s.first_frame) parts.push(`First frame: ${s.first_frame}.`);
    if (s.camera) parts.push(`Camera: ${s.camera}.`);
    const beats = (s.beats || []).filter((b) => b.action).map((b) => `${b.from ?? ''}-${b.to ?? ''}s: ${b.action}`);
    if (beats.length) parts.push(beats.join('; ') + '.'); else warnings.push(`Shot ${i + 1}: нет тайминга по секундам`);
    for (const a of s.acting || []) { const c = find(project.assets?.characters, a.character); if (c && a.behaviour) parts.push(`@${c.name}: ${a.behaviour}.`); }
    if (!(s.acting || []).some((a) => a.behaviour) && chars.length) warnings.push(`Shot ${i + 1}: нет микроповедения`);
    if (s.physics) parts.push(`Physics: ${s.physics}.`);
    if (s.lighting) parts.push(`Light here: ${s.lighting}.`);
    if (s.clutter) parts.push(`In frame, unstaged: ${s.clutter}.`);
    const dialogue = (s.audio?.dialogue || []).filter((d) => d.line).map((d) => { const c = find(project.assets?.characters, d.character); return `${c ? '@' + c.name : 'off-screen voice'} says "${d.line}"${d.delivery ? ` (${d.delivery})` : ''}`; });
    if (dialogue.length) parts.push(dialogue.join('; ') + '. Nobody else speaks.');
    lines.push(`${head}: ${parts.join(' ')}`);
    lines.push('');
  });

  // Sound (merged)
  const sfx = [...new Set(shots.flatMap((s) => [s.audio?.sfx, s.audio?.room_tone].filter(Boolean)))];
  lines.push(`SOUND through the ${deviceKey === 'film_8mm' ? 'silent camera (no sound recorded)' : deviceKey === 'cinema' ? 'location sound recordist' : "device's built-in mic"}: ${sfx.length ? sfx.join('; ') + '.' : 'natural ambience only.'} No music, no narration, no subtitles, no on-screen text.`);
  lines.push('');
  const extraNeg = [...(project.style?.negative_extra || []), ...shots.map((s) => s.negative_extra).filter(Boolean)];
  lines.push(`NEGATIVE: ${ANTI_AI_NEGATIVE}${extraNeg.length ? '; ' + extraNeg.join('; ') : ''}.`);
  lines.push('');
  lines.push(LEGAL_BLOCK);

  const prompt = lines.join('\n').trim();
  // линтуем только то, что ПРОСИМ: запреты (NEGATIVE, forbid устройства) сами содержат эти слова
  const positive = prompt.split(/\nNEGATIVE:/)[0].replace(/(?:^|\. )(No|no|NOT|not) [^.]*\./g, ' ');
  const gloss = lintGloss(positive);
  if (gloss.length) warnings.push(`Глянец в промпте: ${gloss.join(', ')}`);
  if (prompt.length > 4500) warnings.push(`Промпт длинный: ${prompt.length} символов, цель 2500–3500`);
  return { prompt, references, shots, total_seconds: total, warnings, device: deviceKey, fps: dev.fps };
}
