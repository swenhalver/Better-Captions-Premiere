'use strict';
const FILE = 'style-presets.json';
const MAX_BYTES = 2 * 1024 * 1024;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
// The host bounds stored data; the editor also validates every appearance field before use.
function validateLibrary(value) {
  if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.presets) || value.presets.length > 200 || JSON.stringify(value).length > MAX_BYTES) throw new Error('The saved preset library is unsupported or too large.');
  const ids = new Set(), names = new Set();
  for (const p of value.presets) {
    if (!record(p) || typeof p.id !== 'string' || !/^preset-[a-zA-Z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name !== p.name.trim() || p.name.length > 80 || /[\x00-\x1f\x7f]/.test(p.name) || names.has(p.name.toLowerCase()) || !record(p.style) || !record(p.animation) || !Number.isSafeInteger(p.createdAt) || !Number.isSafeInteger(p.updatedAt) || p.createdAt < 0 || p.updatedAt < p.createdAt) throw new Error('The saved preset library contains an invalid or duplicate preset.');
    ids.add(p.id); names.add(p.name.toLowerCase());
  }
  return JSON.parse(JSON.stringify(value));
}
function createPresetStore({ getFolder, readJSON, writeJSON }) {
  async function read(folder) {
    const file = (await folder.getEntries()).find(entry => entry.name === FILE);
    return file ? validateLibrary(await readJSON(file, MAX_BYTES)) : { version: 1, revision: 0, presets: [] };
  }
  return {
    async load() { return read(await getFolder()); },
    async save(value) {
      const input = validateLibrary(value), folder = await getFolder(), current = await read(folder);
      if (input.revision !== current.revision) throw new Error('Presets changed in another panel. Reload presets before saving again.');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('The preset library revision limit was reached.');
      const next = { ...input, revision: current.revision + 1 };
      await writeJSON(folder, FILE, next);
      return next;
    },
  };
}
module.exports = { createPresetStore, validateLibrary };
