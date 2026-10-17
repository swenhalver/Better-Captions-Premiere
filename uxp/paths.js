'use strict';
// UXP has no Node path module. Keep local path validation independent of the host OS.
function localPath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f]/.test(value)) throw new Error('Expected a local absolute caption path.');
  const normalized = value.replace(/\\/g, '/');
  const windows = /^[a-z]:\//i.test(normalized);
  if (!windows && (!normalized.startsWith('/') || normalized.startsWith('//'))) throw new Error('Expected a local absolute caption path.');
  if (normalized.split('/').some(part => part === '..' || part === '.')) throw new Error('Caption paths cannot contain traversal segments.');
  if (windows && normalized.slice(3).split('/').some(part => /[<>:"|?*]|[. ]$/.test(part))) throw new Error('Invalid Windows caption path.');
  if (!windows && normalized.includes('\\')) throw new Error('Invalid caption path.');
  return /^[a-z]:\/$/i.test(normalized) ? normalized : normalized.replace(/\/$/, '') || '/';
}
function parentPath(value) {
  const normalized = localPath(value), slash = normalized.lastIndexOf('/');
  if (normalized === '/' || /^[a-z]:\/$/i.test(normalized)) return null;
  if (slash === 0) return '/';
  if (slash === 2 && /^[a-z]:/i.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, slash);
}
function fileUrl(value) {
  const normalized = localPath(value);
  return 'file:' + (/^[a-z]:/i.test(normalized) ? '/' : '') + normalized;
}
function privateBase(dataPath) {
  const normalized = localPath(dataPath);
  const marker = /^[a-z]:/i.test(normalized) ? '/Adobe/UXP/' : '/Library/Application Support/';
  const index = normalized.toLowerCase().indexOf(marker.toLowerCase());
  if (index < 1) throw new Error('Cannot locate the private Better Captions folder from Adobe UXP storage.');
  return normalized.slice(0, index) + (marker === '/Adobe/UXP/' ? '' : '/Library/Application Support') + '/Better Captions';
}
module.exports = { localPath, parentPath, fileUrl, privateBase };
