// Adapter over the `higgsfield` CLI. Every call is `higgsfield <args> --json`.
// Kept thin on purpose: the public API adapter can replace it later with the same surface.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const run = promisify(execFile);

export class HiggsfieldError extends Error {
  constructor(message, { args, stdout, stderr } = {}) {
    super(message);
    this.name = 'HiggsfieldError';
    this.args = args;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

async function hf(args, { timeoutMs = 120000 } = {}) {
  try {
    // stdin must be closed: with an open pipe the CLI blocks reading it (seen on generate create with video references).
    const { stdout } = await run(config.hfBin, [...args, '--json'], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const text = stdout.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // CLI sometimes prints a human line before/after the JSON. Take the outermost JSON block.
      const start = Math.min(...['{', '['].map((c) => text.indexOf(c)).filter((i) => i >= 0));
      const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim();
    const stdout = (err.stdout || '').toString().trim();
    throw new HiggsfieldError(stderr || stdout || err.message, { args, stdout, stderr });
  }
}

// Media flags of `generate create` / `generate cost`.
const MEDIA_FLAGS = {
  image_references: '--image-references',
  video_references: '--video-references',
  audio_references: '--audio-references',
  start_image: '--start-image',
  end_image: '--end-image',
};

/** Build CLI argv from a params object + medias object of {role: [uuid|path]|uuid|path}. */
export function buildArgs(jobType, params = {}, medias = {}) {
  const args = [jobType];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    args.push(`--${k}`, String(v));
  }
  for (const [role, flag] of Object.entries(MEDIA_FLAGS)) {
    const v = medias[role];
    if (!v) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item) args.push(flag, String(item));
    }
  }
  return args;
}

export async function modelList() {
  return hf(['model', 'list']);
}

export async function modelGet(jobType) {
  try { return await hf(['model', 'get', jobType]); }
  catch (err) { return hf(['workflow', 'get', jobType]); }
}

export async function workflowList() {
  return hf(['workflow', 'list']);
}

export async function accountStatus() {
  return hf(['account', 'status']);
}

/** Returns credits as number (or null if the CLI answer has no recognisable field). */
export async function estimateCost(jobType, params, medias) {
  const res = await hf(['generate', 'cost', ...buildArgs(jobType, params, medias)]);
  const credits = pickNumber(res, ['credits', 'cost', 'estimated_credits', 'price']);
  return { credits, raw: res };
}

/** Creates a job without waiting. Returns {id, raw}. */
export async function createJob(jobType, params, medias) {
  const res = await hf(['generate', 'create', ...buildArgs(jobType, params, medias)]);
  // Without --wait the CLI prints a bare array of job ids: ["<uuid>"]. With --wait it prints job objects.
  const first = Array.isArray(res) ? res[0] : res;
  const id = typeof first === 'string' ? first : first?.id || first?.job_id;
  if (!id) throw new HiggsfieldError('generate create returned no job id', { stdout: JSON.stringify(res) });
  return { id, raw: first };
}

export async function getJob(id) {
  const res = await hf(['generate', 'get', id]);
  const job = Array.isArray(res) ? res[0] : res;
  return normalizeJob(job);
}

export async function upload(filePath) {
  const res = await hf(['upload', 'create', filePath]);
  if (!res?.id) throw new HiggsfieldError('upload returned no id', { stdout: JSON.stringify(res) });
  return { id: res.id, url: res.url, type: res.type };
}

export function normalizeJob(job) {
  if (!job) return { status: 'unknown' };
  const status = String(job.status || job.state || 'unknown').toLowerCase();
  const done = ['completed', 'succeeded', 'success', 'done'].includes(status);
  const failed = ['failed', 'error', 'nsfw', 'cancelled', 'canceled'].includes(status);
  return {
    id: job.id || job.job_id,
    status: done ? 'completed' : failed ? status : 'running',
    result_url: job.result_url || job.results?.[0]?.url || job.result?.url || null,
    error: job.error || job.failure_reason || null,
    raw: job,
  };
}

function pickNumber(obj, keys) {
  if (obj == null) return null;
  if (typeof obj === 'number') return obj;
  for (const k of keys) {
    if (typeof obj[k] === 'number') return obj[k];
    if (obj[k] && typeof obj[k] === 'object') {
      const n = pickNumber(obj[k], keys);
      if (n != null) return n;
    }
  }
  return null;
}
