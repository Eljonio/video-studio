// Camera DEVICE packs. Realism comes from the device's flaws, not from resolution — this block goes FIRST in every prompt.
export const DEVICES = {
  phone: {
    label: 'Телефон (iPhone-класс, авто всё)',
    medium: 'Handheld smartphone video, filmed like a real phone recording by a person who is not a camera operator. NOT a commercial, NOT cinematic.',
    flaws: 'Neutral phone colour science, realistic phone sharpness and compression, fine sensor noise in the shadows, clipped highlights in windows and sky, auto exposure that shifts live as the light changes, autofocus that briefly hunts and resettles when something enters the frame, mild rolling-shutter wobble, deep depth of field so the background stays sharp, imperfect framing with the horizon never quite level, small hand shake even with stabilisation.',
    forbid: 'No cinematic camera moves, no gimbal, no shallow cinematic bokeh, no film grain, no colour grade, no beauty filter, no CGI look, no dramatic posing.',
    fps: 30,
  },
  mirrorless_kit: {
    label: 'Беззеркалка с китовым объективом (влог)',
    medium: 'Casual footage from an entry-level mirrorless camera with the 18-55 kit lens on auto, held by a friend. A personal vlog camera, not a commercial production.',
    flaws: 'In-camera standard picture profile: slightly oversharpened edges with plasticky noise reduction in the shadows, clipped white sky, kit-lens softness in the corners, autofocus that hunts once and resettles, exposure stepping between sun and shade, auto white balance drifting warm to cool, rolling-shutter wobble on footsteps, motion blur on fast movement, 1080p look, framing drifts off-centre.',
    forbid: 'No gimbal, no shallow cinematic bokeh, no film grain, no colour grade, no cinematic commercial look, no dramatic posing, no artificial transitions.',
    fps: 30,
  },
  dv_camcorder: {
    label: 'MiniDV-камкордер 2000-х (домашнее видео)',
    medium: 'Home video shot on an early-2000s consumer MiniDV camcorder by a close friend who is simply there, not directing.',
    flaws: 'Soft, slightly smeared 480i detail with mild interlace-like motion trails, small consumer sensor: clipped white sky, muddy shadows with visible video noise, cheap zoom lens with soft corners and slight barrel distortion, autofocus hunting, exposure pumping between sun and shade, auto white balance drifting, lens flare smear from bright light, handheld with footsteps in the frame, horizon never level, accidental tilts and reframes.',
    forbid: 'No stabilisation, no gimbal, no shallow cinematic bokeh, no film grain, no colour grade, no sharpening, no 4K detail, no cinematic look.',
    fps: 30,
  },
  dslr_2012: {
    label: 'Зеркалка 2012 (Canon 5D Mk II на кузове, chase rig)',
    medium: 'Footage shot in 2012 on a full-frame DSLR rigged to a car: suction-cup chase mounts and a handheld shoulder rig. The look of car-chase b-roll of that era, not modern cinema.',
    flaws: '1080p from a 2012 DSLR sensor: soft detail that falls apart in the shadows, visible rolling-shutter skew on vertical poles when the camera whips, moire shimmer on grilles and grates, aliasing on lane markings, clipped highlights around lamps, heavy compression mush in the dark, mild chromatic fringing at the frame edges, a faint vignette from a cheap wide adapter. Autofocus is not used; focus is pulled by hand and sometimes lands late.',
    forbid: 'No modern 4K crispness, no HDR, no clean shadows, no smooth gimbal float, no drone shots, no lens flares added in post.',
    fps: 24,
  },
  film_8mm: {
    label: '8 мм плёнка (домашняя кинокамера)',
    medium: 'Home movie shot on a wind-up 8mm film camera, hand-held, no sound recorded on the camera.',
    flaws: 'Soft gate, heavy organic grain, gate weave and slight frame jitter, halation around highlights, faded warm colours, uneven exposure, dust and hair specks, vignetting, 16-18 fps cadence with motion judder, missing frames at reel changes.',
    forbid: 'No digital sharpness, no clean gradients, no stabilisation, no modern colour grade.',
    fps: 18,
  },
  cinema: {
    label: 'Кино (large-format, прайм-оптика)',
    medium: 'Narrative film footage shot on a large-format digital cinema camera with spherical prime lenses, 180-degree shutter, 24 fps.',
    flaws: 'Organic film-like grain, mild halation, lens breathing on focus pulls, shallow but not extreme depth of field, deep shadows that go black, source-motivated light with real contrast, honest skin with pores and shine, uneven exposure between shots is acceptable.',
    forbid: 'No HDR glow, no advertising gloss, no beauty light, no plastic skin, no perfectly symmetrical framing, no gimbal-smooth floating camera unless specified.',
    fps: 24,
  },
};

// Words that order a render instead of footage. Found in style text -> warning, and stripped in prose mode.
export const GLOSS_WORDS = ['8K', 'IMAX', 'HDR', 'ARRI', 'Alexa', 'clean advertising finish', 'advertising finish', 'high-end', 'premium', 'beautiful', 'glossy', 'pristine', 'brightest, cleanest', 'motion-control', 'stabilised', 'stabilized', 'smooth stable motion', 'photorealistic', 'ultra-realistic', 'cinema-grade', 'flawless'];

export const ANTI_AI_NEGATIVE = 'digital sharpness, plastic skin, evenly lit from all angles, gimbal-smooth floating motion, unbroken sharpness front to back, perfect symmetry, floaty motion, frozen lips, jittery eyes, oversaturated colour, beauty filter, CGI look, cinematic commercial look, dramatic posing, artificial transitions, readable text, logos, subtitles, watermark, music, narration';
