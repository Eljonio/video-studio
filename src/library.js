// Global library shared by every project: characters, locations, props/products, style presets.
// One JSON file + media folder under data/library/. Projects COPY entries (with a link back via library_id).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { newId } from './store.js';

const file = () => path.join(config.dataDir, 'library', 'library.json');
export const libraryMediaDir = () => path.join(config.dataDir, 'library', 'media');

const EMPTY = { characters: [], locations: [], props: [], styles: [], updated_at: null };

export async function getLibrary() {
  try { return { ...EMPTY, ...JSON.parse(await fs.readFile(file(), 'utf8')) }; }
  catch { return structuredClone(EMPTY); }
}

export async function saveLibrary(lib) {
  lib.updated_at = new Date().toISOString();
  await fs.mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${newId().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(lib, null, 2));
  await fs.rename(tmp, file());
  return lib;
}

export async function upsertItem(group, item) {
  const lib = await getLibrary();
  if (!lib[group]) throw new Error(`unknown group ${group}`);
  if (!item.id) item.id = newId();
  item.updated_at = new Date().toISOString();
  const i = lib[group].findIndex((x) => x.id === item.id);
  if (i >= 0) lib[group][i] = item; else lib[group].push(item);
  await saveLibrary(lib);
  return item;
}

export async function removeItem(group, id) {
  const lib = await getLibrary();
  lib[group] = (lib[group] || []).filter((x) => x.id !== id);
  await saveLibrary(lib);
}

/** Absolute path of a media ref: library media or project media. */
export function mediaPath(projectMediaDir, m) {
  return m.scope === 'library' ? path.join(libraryMediaDir(), m.file) : path.join(projectMediaDir, m.file);
}
