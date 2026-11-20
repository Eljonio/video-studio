import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePrompt } from '../src/domain/prompt-compiler.js';
import { lintGloss } from '../src/domain/prompt-prose.js';

const project = {
  format: { aspect: '9:16' }, device: 'dv_camcorder', prompt_format: 'prose',
  style: { negative_extra: ['no cap on head'] },
  summary: { who_and_where: 'Yui walks in Nakano' },
  assets: { characters: [{ id: 'c1', name: 'Yui', traits: '24', wardrobe: 'grey hoodie', refs: [{ id: 'm1', hf_id: 'u1' }] }], locations: [{ id: 'l1', name: 'Street', description: 'back street', light: 'overcast', refs: [] }], props: [] },
  shots: [{ id: 's1', title: 'Walk', duration: 10, type: '', characters: ['c1'], location: 'l1', beats: [{ from: 0, to: 3, action: 'walks' }], acting: [{ character: 'c1', behaviour: 'glance back' }], audio: { sfx: 'sneakers', room_tone: 'quiet' } }],
};

test('prose: device block comes first, one role per reference, single NEGATIVE', () => {
  const r = compilePrompt(project);
  assert.match(r.prompt.split('\n')[0], /ONE UNBROKEN 10-SECOND TAKE, 9:16, no cuts\. Home video shot on an early-2000s consumer MiniDV camcorder/);
  assert.match(r.prompt, /CAMERA = THE DEVICE AND THE PERSON HOLDING IT/);
  assert.match(r.prompt, /@Image1 controls only Yui's identity/);
  assert.doesNotMatch(r.prompt, /@Yui: 24\./, 'traits are not restated when a reference exists');
  assert.equal((r.prompt.match(/NEGATIVE:/g) || []).length, 1);
  assert.match(r.prompt, /no cap on head/);
  assert.ok(r.prompt.length < 4500);
  assert.equal(r.fps, 30);
  assert.deepEqual(r.warnings, []);
});

test('json format still available', () => {
  const r = compilePrompt(project, null, 'json');
  assert.match(r.prompt, /DIRECTOR SPEC/);
});

test('gloss linter finds render words', () => {
  assert.deepEqual(lintGloss('8K IMAX clean advertising finish, handheld'), ['8K', 'IMAX', 'clean advertising finish', 'advertising finish']);
  assert.deepEqual(lintGloss('handheld phone video'), []);
  assert.deepEqual(lintGloss('tiny gold earrings, her arrival at the door, 8K-style'), ['8K'], 'no hit inside earrings/arrival');
});

test('normalize: audio as a plain string becomes sfx and reaches the prompt', async () => {
  const { normalizeProject } = await import('../src/domain/normalize.js');
  const p = normalizeProject({ ...project, shots: [{ ...project.shots[0], audio: 'keys, wind on the mic' }] });
  assert.deepEqual(p.shots[0].audio, { dialogue: [], sfx: 'keys, wind on the mic', room_tone: '' });
  assert.match(compilePrompt(p).prompt, /keys, wind on the mic/);
});

test('normalize: missing arrays never crash the compiler', async () => {
  const { normalizeProject } = await import('../src/domain/normalize.js');
  const p = normalizeProject({ shots: [{ title: 'x', duration: 4 }] });
  assert.deepEqual(p.shots[0].beats, []);
  assert.deepEqual(p.shots[0].locks, []);
  assert.ok(compilePrompt(p).prompt.length > 0);
});
