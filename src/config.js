import path from 'node:path';

const env = process.env;
export const config = {
  port: Number(env.PORT || 4600),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  hfBin: env.HF_BIN || 'higgsfield',
  pollMs: Number(env.HF_POLL_MS || 6000),
  maxParallel: Number(env.HF_MAX_PARALLEL || 4),
  waitTimeoutMs: Number(env.HF_WAIT_TIMEOUT_MS || 25 * 60 * 1000),
};
