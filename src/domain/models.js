// Model presets: sensible defaults per job type, learned from test runs.
// Everything here can be overridden per run from the UI.
export const VIDEO_MODELS = {
  seedance_2_0: {
    label: 'Seedance 2.0 (кино, мультишот, genre)',
    defaults: { mode: 'std', resolution: '1080p', duration: 10, bitrate_mode: 'high', genre: 'drama', generate_audio: true },
    fields: {
      duration: { type: 'int', min: 4, max: 15 },
      resolution: ['480p', '720p', '1080p', '4k'],
      mode: ['std', 'fast'],
      genre: ['auto', 'action', 'horror', 'comedy', 'noir', 'drama', 'epic'],
      bitrate_mode: ['standard', 'high'],
      generate_audio: 'bool',
    },
    medias: ['start_image', 'end_image', 'image_references', 'video_references', 'audio_references'],
    limits: { image_references: 9 },
  },
  seedance_2_5: {
    label: 'Seedance 2.5 (omni_reference, extend, edit)',
    defaults: { mode: 'omni_reference', resolution: '1080p', duration: 10, bitrate_mode: 'high', generate_audio: true },
    fields: {
      duration: { type: 'int', min: 4, max: 30 },
      resolution: ['480p', '720p', '1080p'],
      mode: ['t2v', 'omni_reference', 'video_edit', 'video_extension'],
      bitrate_mode: ['standard', 'high'],
      generate_audio: 'bool',
    },
    medias: ['start_image', 'end_image', 'image_references', 'video_references', 'audio_references'],
    limits: { image_references: 30 },
  },
  kling3_0: {
    label: 'Kling 3.0 (дёшево, телефонный реализм)',
    defaults: { mode: 'pro', duration: 10, sound: 'on' },
    fields: { duration: { type: 'int', min: 3, max: 15 }, mode: ['std', 'pro', '4k'], sound: ['on', 'off'] },
    medias: ['start_image', 'end_image'],
    limits: {},
  },
  veo3_1: {
    label: 'Veo 3.1 (чистый звук, глянец)',
    defaults: { duration: 8, quality: 'high', variant: 'veo-3-1-preview' },
    fields: { duration: [4, 6, 8], quality: ['basic', 'high', 'ultra'], variant: ['veo-3-1-preview', 'veo-3-1-fast'] },
    medias: ['start_image'],
    limits: {},
  },
  wan3_0: {
    label: 'Wan 3.0 (до 30 с, thinking)',
    defaults: { resolution: '1080p', duration: 10, generate_audio: true, enable_thinking: true },
    fields: {
      duration: { type: 'int', min: 2, max: 30 },
      resolution: ['480p', '720p', '1080p'],
      generate_audio: 'bool', enable_thinking: 'bool',
    },
    medias: ['start_image', 'end_image', 'image_references', 'video_references', 'audio_references'],
    limits: {},
  },
  cinematic_studio_video_4_0: {
    label: 'Cinema Studio 4.0 — флагман Higgsfield (до 30 с, 50 референсов)',
    defaults: { mode: 'omni_reference', resolution: '1080p', duration: 10, bitrate_mode: 'high', generate_audio: true },
    fields: {
      duration: { type: 'int', min: 4, max: 30 },
      resolution: ['480p', '720p', '1080p'],
      mode: ['t2v', 'omni_reference', 'video_edit', 'video_extension'],
      bitrate_mode: ['standard', 'high'],
      generate_audio: 'bool',
    },
    medias: ['start_image', 'end_image', 'image_references', 'video_references', 'audio_references'],
    limits: { image_references: 50 },
  },
};

export const IMAGE_MODELS = {
  nano_banana_pro: { label: 'Nano Banana Pro (реалистичный старт-кадр)', defaults: {}, medias: ['image_references'] },
  soul_cinematic: { label: 'Soul Cinematic (кино-кадр, Soul ID)', defaults: {}, medias: ['image_references'] },
  seedream_v5_pro: { label: 'Seedream 5 Pro', defaults: { resolution: '2k' }, medias: ['image_references'] },
};

export function modelInfo(jobType) {
  return VIDEO_MODELS[jobType] || IMAGE_MODELS[jobType] || null;
}
