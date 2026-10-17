'use strict';
const fs = require('uxp').storage.localFileSystem;
const { localPath, parentPath, fileUrl, privateBase } = require('./paths.js');
function randomId() { return crypto.randomUUID().replace(/-/g, ''); }
async function ensureFolder(absolutePath) {
  absolutePath = localPath(absolutePath);
  try { const entry = await fs.getEntryWithUrl(fileUrl(absolutePath)); if (!entry.isFolder) throw new Error('Caption folder path is occupied by a file.'); return entry; }
  catch (error) {
    const parentName = parentPath(absolutePath);
    if (!parentName) throw error;
    const parent = await ensureFolder(parentName);
    try { return await parent.createFolder(absolutePath.slice(absolutePath.lastIndexOf('/') + 1)); }
    catch { const entry = await fs.getEntryWithUrl(fileUrl(absolutePath)); if (!entry.isFolder) throw error; return entry; }
  }
}
async function privateRoot(scope) {
  if (!['agent', 'service'].includes(scope)) throw new Error('Unknown caption service scope.');
  const data = await fs.getDataFolder();
  return ensureFolder(privateBase(data.nativePath) + '/' + scope);
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
