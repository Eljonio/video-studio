import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compilePrompt } from '../src/domain/prompt-compiler.js';
import { normalizeProject } from '../src/domain/normalize.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../examples/demo-data/${p}`, import.meta.url), 'utf8'));

test('demo project compiles in both formats without warnings', () => {
  const p = normalizeProject(read('projects/demo-night-laundromat/project.json'));
  const prose = compilePrompt(p);
  assert.deepEqual(prose.warnings, []);
  assert.match(prose.prompt.split('\n')[0], /^2-SHOT 9-SECOND SEQUENCE, 9:16, 1 hard cut\. Handheld smartphone video/);
  assert.deepEqual(compilePrompt(p, null, 'json').warnings, []);
});

test('demo project assets point at existing library entries', () => {
  const p = read('projects/demo-night-laundromat/project.json');
  const lib = read('library/library.json');
  for (const group of ['characters', 'locations', 'props']) {
    for (const a of p.assets[group]) {
      if (a.library_id) assert.ok(lib[group].some((x) => x.id === a.library_id), `${group}/${a.name}`);
    }
  }
});
