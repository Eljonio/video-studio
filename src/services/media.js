// ffmpeg/ffprobe helpers: download, probe, frames, contact sheet, cheap quality metrics.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function download(url, dest, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('downloaded 0 bytes');
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      return buf.length;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
  const [num, den] = String(v.r_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration || 0),
    bitrate_kbps: Math.round(Number(j.format?.bit_rate || 0) / 1000),
    width: v.width, height: v.height, codec: v.codec_name,
    fps: den ? Math.round((num / den) * 100) / 100 : null,
    audio: a ? { codec: a.codec_name, channels: a.channels, sample_rate: Number(a.sample_rate) } : null,
    size_bytes: Number(j.format?.size || 0),
  };
}

/** Extract N evenly spaced frames as JPEG. Returns list of file paths. */
export async function extractFrames(file, outDir, n = 6, duration) {
  await fs.mkdir(outDir, { recursive: true });
  const d = duration || (await probe(file)).duration || 5;
  const files = [];
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(d - 0.05, (d * (i + 0.5)) / n));
    const out = path.join(outDir, `f${String(i + 1).padStart(2, '0')}.jpg`);
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '3', out]);
    files.push(out);
  }
  return files;
}

/** Contact sheet: 3 columns tile, scaled to 480px wide per cell. */
export async function contactSheet(file, out, cols = 3, rows = 2, duration) {
  const d = duration || (await probe(file)).duration || 5;
  const every = d / (cols * rows);
  const fpsExpr = `fps=1/${every.toFixed(3)}`;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', file,
    '-vf', `${fpsExpr},scale=480:-1,tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '3', out]);
  return out;
}

/** Cheap automatic checks used to reject broken takes before a human looks. */
export async function qualityMetrics(file, info) {
  const flags = [];
  const m = { ...info };
  if (info.size_bytes === 0) flags.push('empty_file');
  if (info.height >= 1000 && info.bitrate_kbps && info.bitrate_kbps < 2000) flags.push('low_bitrate_static');
  // freezes >= 1s
  try {
    const { stderr } = await run('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'freezedetect=n=-50dB:d=1.0', '-an', '-f', 'null', '-']);
    m.freezes = (stderr.match(/freeze_start/g) || []).length;
    if (m.freezes > 0) flags.push('freeze');
  } catch { m.freezes = null; }
  // hard cuts (scene change > 0.3)
  try {
    const { stderr } = await run('ffmpeg', ['-v', 'info', '-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-']);
    m.cuts = (stderr.match(/pts_time/g) || []).length;
  } catch { m.cuts = null; }
  // overexposed frames: mean luma > 235 on any sampled frame
  try {
    const { stderr } = await run('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-']);
    const yavg = [...stderr.matchAll(/YAVG=([\d.]+)/g)].map((x) => Number(x[1]));
    m.luma_max = yavg.length ? Math.max(...yavg) : null;
    m.luma_min = yavg.length ? Math.min(...yavg) : null;
    if (m.luma_max != null && m.luma_max > 235) flags.push('blown_out');
    if (m.luma_min != null && m.luma_min < 8) flags.push('black_frames');
  } catch { /* ignore */ }
  m.flags = flags;
  return m;
}
