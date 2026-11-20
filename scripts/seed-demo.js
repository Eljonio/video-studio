// Copies the fictional demo project and library from examples/demo-data into DATA_DIR (default ./data).
// Never overwrites existing files, so it is safe to run on a data folder that is already in use.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo-data');
await fs.mkdir(config.dataDir, { recursive: true });
await fs.cp(src, config.dataDir, { recursive: true, force: false, errorOnExist: false });
console.log(`demo data copied into ${config.dataDir} (existing files kept)`);
