import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePrompt, pruneEmpty } from '../src/domain/prompt-compiler.js';
import { buildArgs } from '../src/adapters/higgsfield-cli.js';

const project = {
  format: { aspect: '16:9' },
  style: { style: { style: 'film' }, negative_extra: ['no cap on head'] },
  summary: { who_and_where: 'Rosa in a laundromat', what_happens: '', tone: '' },
  assets: {
    characters: [{ id: 'c1', name: 'Rosa', traits: '38, short curly hair', wardrobe: 'green apron', refs: [{ id: 'm1', hf_id: 'u-face' }] }],
    locations: [{ id: 'l1', name: 'Laundromat', description: 'tiled floor, fluorescent tubes', refs: [{ id: 'm2', hf_id: 'u-loc' }] }],
    props: [],
  },
  shots: [
    { id: 's1', title: 'Hook', duration: 6, type: 'WAIST-UP handheld', characters: ['c1'], location: 'l1', beats: [{ from: 0, to: 2, action: 'checks a dryer timer' }], acting: [{ character: 'c1', behaviour: 'one slow blink' }], audio: { dialogue: [{ character: 'c1', line: 'Back in five.' }] } },
    { id: 's2', title: 'Turn', duration: 4, type: 'CLOSE-UP', characters: ['c1'], location: 'l1', beats: [], acting: [] },
  ],
};

test('compiles all shots with numbered references, location first', () => {
  const r = compilePrompt(project, null, 'json');
  assert.equal(r.references.length, 2);
  assert.equal(r.references[0].asset, 'Laundromat');
  assert.equal(r.references[1].label, '@Image 2');
  assert.match(r.prompt, /2 shots, 1 hard cut/);
  assert.match(r.prompt, /"@Rosa": "CONSTANT: 38, short curly hair/);
  assert.match(r.prompt, /Ref: @Image 2/);
  assert.match(r.prompt, /no cap on head/);
  assert.equal(r.total_seconds, 10);
  assert.ok(r.warnings.some((w) => w.includes('Shot 2')), 'warns about missing timing on shot 2');
});

test('compiles a single shot and drops empty fields', () => {
  const r = compilePrompt(project, ['s1'], 'json');
  assert.match(r.prompt, /1 shot, 0 hard cuts/);
  assert.doesNotMatch(r.prompt, /: ""/);
  assert.doesNotMatch(r.prompt, /"tone"/);
});

test('pruneEmpty removes empty strings, arrays and objects recursively', () => {
  const o = pruneEmpty({ a: '', b: [], c: {}, d: { e: '', f: 'x' }, g: [1, '', { h: '' }] });
  assert.deepEqual(o, { d: { f: 'x' }, g: [1] });
});

test('buildArgs turns params and medias into CLI flags', () => {
  const args = buildArgs('seedance_2_0', { prompt: 'p', duration: 10, generate_audio: true, empty: '' }, { image_references: ['a', 'b'], start_image: 's' });
  assert.deepEqual(args, ['seedance_2_0', '--prompt', 'p', '--duration', '10', '--generate_audio', 'true', '--image-references', 'a', '--image-references', 'b', '--start-image', 's']);
});

test('start-frame prompt follows the project aspect instead of assuming vertical', async () => {
  const { stillPromptForShot, orientation } = await import('../src/domain/still-prompt.js');
  assert.equal(orientation('16:9'), 'Horizontal');
  assert.equal(orientation('9:16'), 'Vertical');
  assert.equal(orientation('1:1'), 'Square');
  assert.equal(orientation(undefined), 'Horizontal');
  const project = {
    format: { aspect: '16:9' },
    style: { style: { style: 'handheld', lighting: 'sodium street light' } },
    assets: { locations: [{ id: 'l1', description: 'laundromat', light: 'fluorescent' }], props: [{ id: 'p1', name: 'Basket', description: 'blue plastic' }] },
  };
  const shot = { location: 'l1', props: ['p1'], first_frame: 'woman at the dryer', type: 'medium' };
  const wide = stillPromptForShot(project, shot);
  assert.match(wide.prompt, /^Horizontal single film frame, aspect 16:9\./);
  assert.match(wide.prompt, /LOCATION: laundromat\. fluorescent/);
  assert.match(wide.prompt, /Basket: blue plastic\./);
  assert.equal(wide.aspect, '16:9');
  const tall = stillPromptForShot({ ...project, format: { aspect: '9:16' } }, shot);
  assert.match(tall.prompt, /^Vertical single film frame, aspect 9:16\./);
  assert.equal(stillPromptForShot({ ...project, format: {} }, shot).aspect, '16:9', 'same default as video runs');
});
