// Turns the structured project schema into a director-level prompt (JSON text) that video models read well.
// Template: multishot JSON director spec. Works for one shot or several.
import { NEGATIVE_BASE, LEGAL_BLOCK } from './style-presets.js';
import { compileProse } from './prompt-prose.js';

function findAsset(list, id) {
  return (list || []).find((a) => a.id === id) || null;
}

function secondsLabel(shot) {
  return `${shot.duration || 5}s`;
}

/**
 * @param project full project document
 * @param shotIds ordered list of shot ids to compile (default: all)
 * @returns { prompt, references: [{role, mediaRef, label}], shots, total_seconds, warnings }
 */
export function compilePrompt(project, shotIds, format) {
  const fmt = format || project.prompt_format || 'prose';
  if (fmt === 'prose') return compileProse(project, shotIds);
  const shots = (project.shots || []).filter((s) => !shotIds || shotIds.includes(s.id));
  const warnings = [];
  if (shots.length === 0) warnings.push('Нет планов для компиляции');

  // Reference numbering: location -> characters -> props (order Higgsfield recommends). Max is enforced by the adapter.
  const references = [];
  const refLabel = new Map(); // assetId -> "@Image N"
  const usedChars = new Set(), usedLocs = new Set(), usedProps = new Set();
  for (const s of shots) {
    if (s.location) usedLocs.add(s.location);
    for (const c of s.characters || []) usedChars.add(c);
    for (const p of s.props || []) usedProps.add(p);
  }
  const addRefs = (asset) => {
    for (const m of asset.refs || []) {
      references.push({ role: 'image_references', mediaRef: m, label: `@Image ${references.length + 1}`, asset: asset.name });
      if (!refLabel.has(asset.id)) refLabel.set(asset.id, []);
      refLabel.get(asset.id).push(`@Image ${references.length}`);
    }
  };
  for (const id of usedLocs) { const a = findAsset(project.assets?.locations, id); if (a) addRefs(a); }
  for (const id of usedChars) { const a = findAsset(project.assets?.characters, id); if (a) addRefs(a); }
  for (const id of usedProps) { const a = findAsset(project.assets?.props, id); if (a) addRefs(a); }

  const assets = {};
  for (const id of usedChars) {
    const c = findAsset(project.assets?.characters, id);
    if (!c) { warnings.push(`Персонаж ${id} не найден`); continue; }
    const refs = refLabel.get(c.id);
    assets[`@${c.name}`] = [
      c.traits && `CONSTANT: ${c.traits}`,
      c.wardrobe && `WARDROBE (identical in every shot): ${c.wardrobe}`,
      refs?.length ? `Ref: ${refs.join(', ')} — exactly this face and look, keep in every frame` : 'No photo reference: keep the described features identical across all shots',
    ].filter(Boolean).join('. ');
    if (!c.traits) warnings.push(`У персонажа ${c.name} нет постоянных признаков`);
  }
  for (const id of usedLocs) {
    const l = findAsset(project.assets?.locations, id);
    if (!l) { warnings.push(`Локация ${id} не найдена`); continue; }
    const refs = refLabel.get(l.id);
    assets[`@${l.name}`] = [l.description, l.light && `Light: ${l.light}`, refs?.length ? `Ref: ${refs.join(', ')} — this exact place` : null]
      .filter(Boolean).join('. ');
  }
  for (const id of usedProps) {
    const p = findAsset(project.assets?.props, id);
    if (!p) continue;
    const refs = refLabel.get(p.id);
    assets[`@${p.name}`] = [p.description, 'stays the same object in every shot, never becomes a different item', refs?.length ? `Ref: ${refs.join(', ')}` : null]
      .filter(Boolean).join('. ');
  }

  const total = shots.reduce((n, s) => n + Number(s.duration || 0), 0);
  const runtime = `~${total}s — ` + shots.map((s, i) => `Shot ${i + 1} ~${secondsLabel(s)} (${s.title || s.type || ''})`).join(', ');

  const shotSpecs = shots.map((s, i) => {
    const chars = (s.characters || []).map((id) => findAsset(project.assets?.characters, id)).filter(Boolean);
    const loc = findAsset(project.assets?.locations, s.location);
    const beats = (s.beats || []).filter((b) => b.action).map((b) => `${b.from ?? ''}–${b.to ?? ''}s: ${b.action}`);
    const acting = {};
    for (const a of s.acting || []) {
      const c = findAsset(project.assets?.characters, a.character);
      if (c && a.behaviour) acting[`@${c.name}`] = a.behaviour;
    }
    const dialogue = (s.audio?.dialogue || []).filter((d) => d.line).map((d) => {
      const c = findAsset(project.assets?.characters, d.character);
      return `${c ? '@' + c.name : 'off-screen'}: "${d.line}"${d.delivery ? ` (${d.delivery})` : ''}`;
    });
    const locks = [
      `${s.type || 'shot'}, ${secondsLabel(s)}, ${project.format?.aspect || '16:9'}`,
      chars.length ? `${chars.map((c) => '@' + c.name).join(', ')} identical to their references and wardrobe` : null,
      loc ? `location = @${loc.name}` : null,
      dialogue.length ? 'only the listed lines are spoken' : 'no dialogue',
      '180-degree rule, no music, blocking markers never rendered',
      ...(s.locks || []),
    ].filter(Boolean);
    if (!beats.length) warnings.push(`Shot ${i + 1}: нет тайминга по секундам`);
    if (!Object.keys(acting).length && chars.length) warnings.push(`Shot ${i + 1}: нет микроповедения персонажей`);
    return {
      id: `shot_${i + 1}`,
      type: s.type || '',
      duration_seconds: Number(s.duration || 5),
      scene_context: s.scene_context || '',
      active_references: [
        loc ? `@${loc.name}` : null,
        ...chars.map((c) => `@${c.name} (100% face/wardrobe match)`),
      ].filter(Boolean),
      first_frame_and_blocking: s.first_frame || '',
      camera: s.camera || '',
      action_timing: beats,
      physics: s.physics || '',
      lighting: s.lighting || '',
      audio: {
        dialogue,
        sfx: s.audio?.sfx || '',
        room_tone: s.audio?.room_tone || '',
        music: 'none',
      },
      character_acting: acting,
      what_we_read: s.what_we_read || '',
      purpose: s.purpose || '',
      locks,
    };
  });

  const negative = [
    ...NEGATIVE_BASE,
    ...(project.style?.negative_extra || []),
    ...shots.flatMap((s) => s.negative_extra ? [s.negative_extra] : []),
  ];

  const spec = {
    style_prefix: project.style?.style || {},
    scene_summary: {
      who_and_where: project.summary?.who_and_where || '',
      what_happens: project.summary?.what_happens || '',
      tone: project.summary?.tone || '',
      what_we_read: project.summary?.what_we_read || '',
      what_we_do_not_show: project.summary?.what_we_do_not_show || '',
      purpose: project.summary?.purpose || '',
    },
    assets,
    total_runtime: runtime,
    shots: shotSpecs,
    format: { aspect_ratio: project.format?.aspect || '16:9', shots_count: shots.length, cuts: Math.max(0, shots.length - 1), cut_type: 'HARD' },
    legal: LEGAL_BLOCK,
    NEGATIVE: negative,
  };

  pruneEmpty(spec);
  const prompt = `DIRECTOR SPEC (follow every field; ${shots.length} shot${shots.length === 1 ? '' : 's'}, ${Math.max(0, shots.length - 1)} hard cut${shots.length === 2 ? '' : 's'}):\n` +
    JSON.stringify(spec, null, 1);

  return { prompt, references, shots, total_seconds: total, warnings, spec };
}

/** Remove empty strings/arrays/objects so the model never reads "" as an instruction. */
export function pruneEmpty(node) {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      pruneEmpty(node[i]);
      if (isEmpty(node[i])) node.splice(i, 1);
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      pruneEmpty(node[k]);
      if (isEmpty(node[k])) delete node[k];
    }
  }
  return node;
}
function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
