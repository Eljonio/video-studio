# Video Studio

[![tests](https://github.com/Eljonio/video-studio/actions/workflows/test.yml/badge.svg)](https://github.com/Eljonio/video-studio/actions/workflows/test.yml)

**Version 0.2.0** · local web app · Node.js ≥ 20 · MIT

A scene-first pipeline for AI video generation on top of the [Higgsfield](https://higgsfield.ai) CLI:

```
project schema  →  compiled prompt  →  N variants  →  frames + metrics  →  pick  →  post
```

You describe a clip as structured data (who, where, which device films it, what happens in each
second). A compiler turns that into a prompt the same way every time. Each run sends the prompt to a
video model N times, downloads the results, extracts frames, computes cheap quality flags, and lets
you score and pick a take. A take's last frame can become the next shot's start frame.

## Where to look first

| to check | open |
|---|---|
| the compiler: project JSON → prompt text, same input gives the same text | [`src/domain/prompt-compiler.js`](src/domain/prompt-compiler.js), [`src/domain/prompt-prose.js`](src/domain/prompt-prose.js) |
| the "capture device first" idea and the gloss linter | [`src/domain/devices.js`](src/domain/devices.js), `lintGloss` in `prompt-prose.js` |
| how a run survives a restart or a failed download | [`src/services/runner.js`](src/services/runner.js) |
| the only code that talks to the Higgsfield CLI | [`src/adapters/higgsfield-cli.js`](src/adapters/higgsfield-cli.js) |
| what is tested | [`test/`](test) — 12 tests, `npm test`, no network and no credits |

To see it work without spending anything: `npm install && npm run seed:demo && npm start`, open the demo
project and press "Собрать промпт" (compile prompt).

**Provenance.** Exported on 2026-11-20 from a private working copy. Real projects, generated clips, reference photos and run data were removed, so the public history starts with the export.

## Why

Hand-written prompts drift. After a few iterations nobody knows which wording, references and model
parameters produced the good take, and a fix to one shot silently breaks another. Video Studio keeps
the scene as data and the prompt as a pure function of that data:

- the same project always compiles to the same text;
- every run stores the exact prompt, parameters and media ids it was sent with;
- variants are compared side by side and the pick is recorded with a score and a reason.

## The core idea: realism is the capture device, not resolution

Asking for "8K, IMAX, HDR, photorealistic" tends to produce a clean render, not footage. Real
footage looks real because of how a specific device fails: auto exposure that drifts, autofocus that
hunts, clipped highlights, rolling-shutter wobble, compression, a person's hands.

So every prose prompt starts with a **CAMERA = THE DEVICE** block, before the scene is even
described. Six device packs live in [`src/domain/devices.js`](src/domain/devices.js):

| key | device |
|---|---|
| `phone` | handheld smartphone, everything on auto |
| `mirrorless_kit` | entry-level mirrorless with a kit lens, vlog style |
| `dv_camcorder` | early-2000s MiniDV home video |
| `dslr_2012` | 2012 full-frame DSLR on car/shoulder rigs |
| `film_8mm` | wind-up 8mm home movie, no sound |
| `cinema` | large-format digital cinema camera (when a film look is actually wanted) |

Each pack has a `medium` line, a list of `flaws`, a `forbid` list and an fps. Two more pieces follow
from the same idea:

- **Gloss linter** (`lintGloss` in [`src/domain/prompt-prose.js`](src/domain/prompt-prose.js)) warns
  when the requested part of a prose prompt contains words that order a render (`8K`, `IMAX`, `HDR`,
  `ARRI`, `photorealistic`, `flawless`, ...). Matching is whole-word, and the NEGATIVE block and
  "No ..." sentences are skipped so that prohibitions don't flag themselves.
- **Local post step** degrades instead of enhancing: an ffmpeg filter graph
  ([`scripts/post-film.sh`](scripts/post-film.sh)) adds chromatic aberration, gate weave, sensor
  resolution loss, halation, shutter blur, tone roll-off, shadow-weighted temporal noise and an
  optional "uploaded and re-downloaded" compression pass. A Blender 5 headless compositor version
  ([`scripts/post-blender.sh`](scripts/post-blender.sh) + `.py`) does the optical part in linear
  float. No credits are spent on post.

## How it works

### 1. Project schema

A project is one JSON document (`data/projects/<id>/project.json`):

- `format` (aspect, resolution), `device`, `prompt_format` (`prose` or `json`);
- `summary`: who and where, what happens, tone, what the viewer reads, what we don't show, purpose;
- `style`: a global-look preset (`cinema_drama`, `phone_realism`, `product_ad`) plus extra negatives;
- `assets`: characters (constant traits, wardrobe), locations (description, light), props, each with
  optional reference images;
- `shots`: duration, framing/camera type, first frame with positions in % of the frame, camera move
  with magnitude, **beats by seconds** (`0–2s: ...`), per-character micro-behaviour, physics,
  lighting, unstaged clutter, dialogue lines, SFX and room tone, locks (a checklist for reviewing
  the result) and a per-shot negative.

[`src/domain/normalize.js`](src/domain/normalize.js) brings any input (API, older files,
hand-written JSON) to one canonical shape on every save.

### 2. Compiler

[`src/domain/prompt-compiler.js`](src/domain/prompt-compiler.js) has two output formats.

**Prose** (default, [`prompt-prose.js`](src/domain/prompt-prose.js)), in this order:

1. header: number of shots, total seconds, aspect, hard cuts, the device's `medium` line;
2. `CAMERA = THE DEVICE AND THE PERSON HOLDING IT`: flaws + forbids;
3. `SCENE`, `LOCATION`, then each character and prop as `@Name`;
4. one block per shot with timed beats, acting, physics, light, clutter and dialogue;
5. `SOUND` routed through the device (built-in mic, a location recordist for `cinema`, nothing for 8mm);
6. a single `NEGATIVE` (anti-AI list + project and shot extras) and a legal block.

Reference images are numbered location → characters → props, and each image gets exactly one role:
`@Image2 controls only Rosa's identity ... Do not copy pose, background, lighting, camera angle or
text from @Image2.` When a character has a reference, its text traits are not restated.

The compiler also returns warnings: a shot without timed beats, characters without micro-behaviour,
gloss words, and prompts longer than 4,500 characters (the target is 2.5–3.5k).

**JSON** is an older "director spec" format: the style preset, scene summary, assets, per-shot
specs, format, legal block and NEGATIVE as one JSON object, with empty fields pruned so the model
never reads `""` as an instruction.

### 3. Runs

[`src/services/runner.js`](src/services/runner.js):

- uploads reference media to Higgsfield lazily and stores the upload ids in the project;
- `estimate` asks the CLI for the cost (`higgsfield generate cost`) without spending anything;
- `start` submits N variants with bounded parallelism (`HF_MAX_PARALLEL`), polls each job, downloads
  the result and analyses it with ffmpeg/ffprobe: resolution, fps, bitrate, audio, 6 frames, a 3×2
  contact sheet, and flags `freeze`, `blown_out`, `black_frames`, `low_bitrate_static`, `empty_file`,
  plus a scene-cut count;
- run state is a JSON file per run, so the UI can reload at any time; on restart, submitted jobs are
  polled again, and a failed download can be retried from the stored job id;
- for models with a `t2v` / `omni_reference` mode, the mode is chosen from whether references exist.

The CLI is wrapped in one file, [`src/adapters/higgsfield-cli.js`](src/adapters/higgsfield-cli.js)
(`higgsfield <args> --json` via `execFile`, stdin closed). The model list in the UI comes live from
`higgsfield model list` / `workflow list`, and the parameter form is built from `model get` /
`workflow get`. [`src/domain/models.js`](src/domain/models.js) holds defaults for a few models I
tested (marked ★ in the UI).

### 4. Review and pick

- variants of all runs side by side, "play all";
- score /10 + note per pick;
- "last frame → next shot's start frame" for chaining shots;
- start-frame generation for a shot from its own fields (image model, `nano_banana_pro` by default).

### 5. Views

- **Forms**: per-field editor for the project and the current shot.
- **Schema**: the project as a graph (assets → shots → runs). Drag from an asset's port onto a shot
  to put it in frame; an inspector edits the selected node in place; layout is saved in the project.
- **Videos**: a gallery of every generated clip (one project or all), newest first, with metrics,
  flags, pick, post and download; a storyboard mode shows each shot's start frame.

A **library** (`data/library/library.json`) holds characters, locations and props shared by all
projects. Adding one to a project copies it and keeps a `library_id` link.

## Install and run

Requirements:

- Node.js 20 or newer;
- `ffmpeg` and `ffprobe` on `PATH`;
- the [Higgsfield CLI](https://higgsfield.ai) logged in with **your own account**
  (`higgsfield auth login`, then pick a workspace) — needed for model lists, uploads, cost
  estimates and generation;
- optional: Blender 5.x on `PATH` for the Blender post engine, Python 3 for `scripts/make-stills.py`.

```bash
npm install
npm run seed:demo   # optional: copies a fictional demo project + library into ./data
npm start           # http://127.0.0.1:4600
npm test
```

The demo project ("Night laundromat") has two shots, one character, one location and one prop,
no media and no runs. It is enough to see the forms, the schema view and the compiled prompt
("Собрать промпт") without generating anything. On load the UI asks the CLI for the account
balance and the model list (read-only); without the CLI those parts show an error and the built-in
model list is used. Running variants spends credits on your account and asks for confirmation; the
storyboard's start-frame button (~2 credits) does not ask.

Configuration is read from environment variables (all optional, see [`.env.example`](.env.example)
and [`src/config.js`](src/config.js)):

| variable | default | meaning |
|---|---|---|
| `PORT` | `4600` | HTTP port (the server binds to 127.0.0.1) |
| `DATA_DIR` | `./data` | projects, runs, media, library |
| `HF_BIN` | `higgsfield` | path to the CLI |
| `HF_POLL_MS` | `6000` | job polling interval |
| `HF_MAX_PARALLEL` | `4` | variants submitted at once |
| `HF_WAIT_TIMEOUT_MS` | `1500000` | give up on a job after this long |
| `LOG_LEVEL` | `info` | Fastify logger level |

## Layout

```
src/
  domain/      pure logic: normalize, prompt-compiler, prompt-prose, still-prompt, devices, style-presets, models
  adapters/    higgsfield-cli.js — the only place that knows about the CLI
  services/    runner.js (runs), media.js (ffmpeg/ffprobe)
  routes/      api.js (Fastify routes)
  store.js     file-backed project/run store, serialised writes
  library.js   shared library
public/        UI: plain JS, no build step
scripts/       post-film.sh, post-blender.sh/.py, make-stills.py, seed-demo.js
examples/      demo-data: fictional project + library
test/          node:test — compiler, prose, linter, normalizer, start-frame prompt, CLI args, demo data
data/          runtime data (git-ignored)
```

## API

`GET /api/meta`, `GET /api/catalog`, `GET /api/account`,
`GET|POST /api/projects`, `GET|PUT|DELETE /api/projects/:id`, `POST …/clone`,
`POST …/compile {shotIds?, format?}`, `POST …/estimate {model, params, n, shotIds?}`,
`POST …/runs` (spends credits), `GET …/runs`, `GET|DELETE …/runs/:runId`,
`POST …/runs/:runId/pick {variant, score, note}`, `POST …/runs/:runId/last-frame {variant}`,
`POST …/runs/:runId/post {variant, action: "film"|"upscale", params}`, `POST …/runs/:runId/recover`,
`POST …/media` (multipart), `POST …/media/:mediaId/hf-upload`, `POST …/still {model, prompt, refs}`,
`POST …/still-for-shot {shotId}`, `POST …/assets/from-library {group, itemId}`,
`POST …/assets/to-library {group, assetId}`,
`GET /api/library`, `PUT /api/library/:group`, `DELETE /api/library/:group/:itemId`,
`POST /api/library/media` (multipart), `GET /api/models/:jobType`.

## Limitations

- A local single-user tool: no authentication, binds to 127.0.0.1. Do not expose it to a network.
- The UI and some code comments are in Russian.
- It depends on the Higgsfield CLI's JSON output (developed against CLI 1.1.24); the adapter
  tolerates some variation, but a format change can break it.
- Model defaults in `models.js` reflect tests at the time of writing and may be out of date; the
  live catalog is the source of truth for which models exist.
- Quality flags are cheap ffmpeg heuristics, not a quality model; a person still picks the take.
- The gloss linter runs only on prose output. The JSON format embeds the style preset text as is,
  and the `cinema_drama` / `product_ad` presets deliberately contain words the linter would flag.
- The Blender post engine supports the `light`, `medium`, `film`, `camcorder` and `phone` presets;
  `camera` and `tiktok` exist only in the ffmpeg engine, and the UI offers them only for ffmpeg.
- 4K upscale (`bytedance_video_upscale`, spends credits) is available through the API only, not
  in the UI.
- The dollar estimate in the UI uses a fixed credit price.
- Automated tests cover the pure parts (compiler, linter, normalizer, CLI argument builder, demo
  data). The runner and the HTTP API have no automated tests.

## License

MIT, see [LICENSE](LICENSE).
