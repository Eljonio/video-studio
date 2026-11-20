// File-backed store: one folder per project, JSON documents, media next to them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { normalizeProject } from './domain/normalize.js';

const projectsRoot = () => path.join(config.dataDir, 'projects');
const projectDir = (id) => path.join(projectsRoot(), id);
const runsDir = (id) => path.join(projectDir(id), 'runs');
export const mediaDir = (id) => path.join(projectDir(id), 'media');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
// Writes to the same file are serialised (runs are saved from several workers at once).
const writeQueues = new Map();
function writeJson(file, data) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const job = prev.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
  });
  writeQueues.set(file, job);
  job.finally(() => { if (writeQueues.get(file) === job) writeQueues.delete(file); });
  return job;
}

export function newId() {
  return randomUUID();
}

export async function listProjects() {
  await fs.mkdir(projectsRoot(), { recursive: true });
  const ids = await fs.readdir(projectsRoot());
  const out = [];
  for (const id of ids) {
    try {
      const p = await readJson(path.join(projectDir(id), 'project.json'));
      out.push({ id: p.id, title: p.title, updated_at: p.updated_at, shots: p.shots.length });
    } catch { /* skip broken folders */ }
  }
  return out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function getProject(id) {
  return normalizeProject(await readJson(path.join(projectDir(id), 'project.json')));
}

export async function saveProject(raw) {
  const p = normalizeProject(raw);
  p.updated_at = new Date().toISOString();
  await writeJson(path.join(projectDir(p.id), 'project.json'), p);
  return p;
}

export async function deleteProject(id) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export async function listRuns(projectId) {
  const dir = runsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  const runs = [];
  for (const f of files) runs.push(await readJson(path.join(dir, f)));
  return runs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function getRun(projectId, runId) {
  return readJson(path.join(runsDir(projectId), `${runId}.json`));
}

export async function saveRun(run) {
  await writeJson(path.join(runsDir(run.project_id), `${run.id}.json`), run);
  return run;
}

export function runDir(projectId, runId) {
  return path.join(runsDir(projectId), runId);
}

// Relative path (from dataDir) -> URL served by the static plugin.
export function toUrl(absPath) {
  const rel = path.relative(config.dataDir, absPath).split(path.sep).join('/');
  return `/data/${rel}`;
}
