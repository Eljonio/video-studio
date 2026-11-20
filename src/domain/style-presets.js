// Global-look presets (style_prefix). Text is distilled from prompting notes and side-by-side
// realism tests. A project copies one and edits freely.
export const NEGATIVE_BASE = [
  'no camera movement beyond what each shot allows, no handheld drift unless specified, no floating, no following, no pan/tilt/zoom/reframing beyond the spec, no wide-angle/fisheye distortion on low angles',
  'no red/flushed face, no blushing, no colour change in skin, no beauty filter, no smoothing, no plastic skin, no extra fingers, no warped hands, no morphing face, no missing props, no exaggerated theatrical acting, no smiling at the end unless specified',
  'no cuts beyond the shot list, no change of location, no empty rooms where people are specified, no other people in reflections, no falling down',
  'no music, no narration, no colour presets/grading, no slow motion, no logos/lettering/readable signs, no captions/subtitles, no watermark, no glitch, no black frames',
  'NOT 3D render, NOT game engine, NOT game-cutscene aesthetic, NOT cartoon, NOT stock footage',
];

export const LEGAL_BLOCK =
  'All characters are fictional and resemble no real person, model or film character. Original designs, no brand tags, blank signs and screens with NO readable writing, no mascots, no copyrighted characters, fictional location, no real people. This is an original film; there is no video to imitate; do not reproduce any existing commercial.';

export const STYLE_PRESETS = {
  cinema_drama: {
    label: 'Кино: large-format drama (Hoyte van Hoytema)',
    style: {
      style: '8K IMAX, photorealistic. Real organic film grain and halation. Shot on large-format film. High dynamic range. NOT 3D render, NOT game engine, NOT game-cutscene aesthetic, NOT cartoon, NOT stock footage.',
      operating_style: 'Hoyte van Hoytema large-format spherical: intimate handheld closeness, tactile textures, soft volumetric light, shallow depth of field on faces, documentary-grounded framing. Quiet drama timing; nothing performed.',
      lighting: 'Source-motivated only: windows and practical lamps present in the frame. One soft key, honest skin, gentle roll-off in the highlights. No heavy grade, no beauty light.',
      color_accent_doctrine: '70% neutral base (concrete, wood, worn fabric), 20% one accent colour from the location, 10% counterpoint from wardrobe. Nothing saturated beyond real life.',
      texture: 'Matte, lived-in surfaces, dust in the light, organic 65mm grain. No digital sheen, no plastic gloss.',
      camera_lens: '65mm spherical prime, 180-degree shutter (natural motion blur), creamy falloff, mild halation, slight lens breathing on focus. NO artificial flares, NO anamorphic streaks.',
      skin: 'Pore-level realism: pores, vellus hair, asymmetry, capillaries, translucency under the eyes. No smoothing, no retouching.',
      acting: 'Restrained naturalism, micro-behaviour over performed emotion. The camera catches the room; actors do not project toward the lens.',
      physics: 'Gravity, inertia, mass. Weighted settling of objects, contact shadows, hair and fabric respond to movement. Nothing floats or slides.',
      composition: 'Spontaneous documentary framing; subjects off-centre; foreground occasionally cuts the frame edge.',
      continuity: 'Characters, wardrobe, props and environment identical across cuts; consistent light direction and colour temperature; positions follow the blocking scheme.',
      technical: 'Smooth stable motion, no flicker, no warping, no morphing, real-time 24 fps, no slow motion.',
      audio: 'Diegetic only, recorded on a stereo pair, 48 kHz broadcast quality, crisp high-frequency detail (fabric, breath, keys, room), NO low-frequency rumble, natural dynamic range. No music. No subtitles. No on-screen text.',
    },
  },
  phone_realism: {
    label: 'Телефон: документальный реализм (UGC)',
    style: {
      style: 'Ordinary smartphone video, vertical or horizontal as specified. Looks like real footage a friend shot, not an ad. NOT cinematic, NOT 3D render, NOT stock footage.',
      operating_style: 'Handheld by an untrained friend: micro-jitter, one brief autofocus hunt, mild exposure pumping, slight rolling-shutter wobble, headroom not quite right, off-centre framing.',
      lighting: 'Whatever light the place has: uneven, unflattering, mixed colour temperature (window daylight + warm ceiling LED). No beauty light, no studio light.',
      color_accent_doctrine: 'Phone colour science: slightly oversharpened, compressed highlights, crushed blacks, fine sensor noise in shadows.',
      texture: 'Real worn objects, fingerprints on glass, scuffed surfaces, cables, clutter allowed.',
      camera_lens: 'Phone main lens ~26mm equivalent, deep depth of field, no shallow cinematic bokeh.',
      skin: 'Ordinary working person, NOT a model, NOT a beauty influencer: pores, vellus hair, under-eye shadows, uneven tone, a small blemish, forehead shine, asymmetric face. No makeup-ad look.',
      acting: 'Nothing performed. One or two micro-actions per shot (glance up, blink, exhale, shift weight). No acting toward the lens.',
      physics: 'Real weight and inertia; hands actually grip objects; fabric responds.',
      composition: 'Casual, slightly wrong: subject off-centre, background clutter visible.',
      continuity: 'Same person, same clothes, same room across all shots.',
      technical: 'Real-time 30 fps look, no slow motion, no morphing, no warping.',
      audio: 'Phone microphone: room reverb, distant traffic, handling noise, gain rises when the room goes quiet. No music, no narration, no subtitles.',
    },
    negative_extra: ['no cinematic look, no shallow cinematic bokeh, no glamour lighting, no makeup ad look, no model face'],
  },
  product_ad: {
    label: 'Продуктовая реклама (ARRI Alexa 35, стабилизация)',
    style: {
      style: 'High-end advertising film, ARRI Alexa 35 texture, HDR, clean advertising finish. Photoreal. NOT 3D render, NOT cartoon.',
      operating_style: 'Precise motion-control moves: tabletop push-in, 180-degree orbit, top-down with counter-rotation, crane up. Every move motivated by the product.',
      lighting: 'The product receives its own precise soft key and is the brightest, cleanest object whenever visible. People are lit one stop under the product.',
      color_accent_doctrine: 'Brand colour world locked: 60% neutral set, 30% brand accent, 10% skin tones.',
      texture: 'Macro sensory inserts: condensation, fingertips, fabric weave, screen glass.',
      camera_lens: 'Rectilinear wides 24mm (no fisheye bubble), 50mm for waist shots, 100mm macro for details with rack focus.',
      skin: 'Natural skin with pores, no retouching, faces stay near frame centre on wide angles and remain anatomically stable.',
      acting: 'Understated; hands and product carry the action.',
      physics: 'Product keeps its exact shape, weight, scale and material; never becomes a different object. Finger pressure, condensation follows gravity.',
      composition: 'Product in frame from the first frame; no empty establishing shot; no delayed reveal.',
      continuity: 'Same product, identities, wardrobe and colour world across every cut.',
      technical: 'Stable, no flicker, no morphing, 24 fps, named cuts only (HARD / MATCH / WHIP).',
      audio: 'Synchronous SFX only (contact, cloth, glass). No music in generation, no voice, no subtitles.',
    },
  },
};
