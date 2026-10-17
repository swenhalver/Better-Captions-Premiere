'use strict';
const fs = require('uxp').storage.localFileSystem;
function randomId() { return crypto.randomUUID().replace(/-/g, ''); }
async function ensureFolder(absolutePath) {
  if (typeof absolutePath !== 'string' || !absolutePath.startsWith('/') || absolutePath.split('/').some(part => part === '..' || part === '.')) throw new Error('Expected a local absolute caption folder.');
  try { const entry = await fs.getEntryWithUrl('file:' + absolutePath); if (!entry.isFolder) throw new Error('Caption folder path is occupied by a file.'); return entry; }
  catch (error) {
    const slash = absolutePath.lastIndexOf('/');
    if (slash <= 0) throw error;
    const parent = await ensureFolder(absolutePath.slice(0, slash));
    try { return await parent.createFolder(absolutePath.slice(slash + 1)); }
    catch { const entry = await fs.getEntryWithUrl('file:' + absolutePath); if (!entry.isFolder) throw error; return entry; }
  }
}
async function privateRoot(scope) {
  if (!['agent', 'service'].includes(scope)) throw new Error('Unknown caption service scope.');
  const data = await fs.getDataFolder();
  const marker = '/Library/Application Support/';
  const index = data.nativePath.indexOf(marker);
  if (index < 1) throw new Error('This installer requires a standard macOS user Library folder.');
  return ensureFolder(data.nativePath.slice(0, index) + '/Library/Application Support/Better Captions/' + scope);
}
async function readJSON(file, maxBytes = 20 * 1024 * 1024) {
  if (!file.isFile) throw new Error('Expected a caption JSON file.');
  if (typeof file.getMetadata === 'function') { const meta = await file.getMetadata(); if (meta.size > maxBytes) throw new Error('Caption JSON file is too large.'); }
  const text = await file.read();
  if (typeof text !== 'string' || text.length > maxBytes) throw new Error('Caption JSON file is too large.');
  return JSON.parse(text);
}
async function writeJSON(folder, name, value) {
  if (!/^[a-zA-Z0-9_.-]{1,180}$/.test(name)) throw new Error('Invalid caption JSON file name.');
  const temp = await folder.createFile(name + '.' + randomId() + '.tmp', { overwrite: false });
  try { await temp.write(JSON.stringify(value)); await temp.moveTo(folder, { newName: name, overwrite: true }); }
  catch (error) { try { await temp.delete(); } catch {} throw error; }
}
module.exports = { ensureFolder, privateRoot, readJSON, writeJSON, randomId };
