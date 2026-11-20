// Промпт стартового кадра плана. Чистая функция от проекта и плана — как и видео-промпт,
// чтобы один и тот же проект всегда давал один и тот же текст.

export const DEFAULT_ASPECT = '16:9';

// '9:16' → Vertical, '16:9' → Horizontal, '1:1' → Square. Непонятное значение — как у проекта по умолчанию.
export function orientation(aspect) {
  const [w, h] = String(aspect || '').split(':').map(Number);
  if (!(w > 0) || !(h > 0)) return orientation(DEFAULT_ASPECT);
  if (w === h) return 'Square';
  return w > h ? 'Horizontal' : 'Vertical';
}

export function stillPromptForShot(project, shot) {
  const aspect = project.format?.aspect || DEFAULT_ASPECT;
  const st = project.style?.style || {};
  const loc = (project.assets?.locations || []).find((l) => l.id === shot.location);
  const props = (project.assets?.props || []).filter((x) => (shot.props || []).includes(x.id));
  const prompt = [
    `${orientation(aspect)} single film frame, aspect ${aspect}. ${st.style || ''}`,
    st.lighting && `LIGHT: ${st.lighting}`,
    loc && `LOCATION: ${loc.description}. ${loc.light || ''}`,
    ...props.map((x) => `${x.name}: ${x.description}.`),
    shot.first_frame && `FRAME: ${shot.first_frame}`,
    shot.type && `LENS: ${shot.type}. ${st.camera_lens || ''}`,
    'Rectilinear optics: no fisheye, no barrel distortion, undistorted proportions.',
    'No text, letters, numbers, logos, badges or labels anywhere.',
    'Photoreal, real camera, not a 3D render.',
  ].filter(Boolean).join(' ');
  return { prompt, aspect };
}
