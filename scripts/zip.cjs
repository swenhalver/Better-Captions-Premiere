'use strict';
// Small ZIP writer for the plugin's static files; no platform zip command or install script.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function writeZip(destination, root, names) {
  const files = [];
  function collect(name) {
    const source = path.join(root, name), stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error('Packaging symbolic links is not supported: ' + name);
    if (stat.isDirectory()) for (const child of fs.readdirSync(source).sort()) collect(path.join(name, child));
    else if (stat.isFile() && !name.endsWith('.DS_Store')) files.push({ name: name.split(path.sep).join('/'), source, stat });
  }
  names.forEach(collect);
  if (files.length > 65535) throw new Error('Plugin archive has too many files.');
  const parts = [], central = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), data = fs.readFileSync(file.source), compressed = zlib.deflateRawSync(data), crc = crc32(data);
    if (data.length > 0xffffffff || offset + compressed.length > 0xffffffff) throw new Error('Plugin archive exceeds ZIP size limits.');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(0x314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(((file.name.endsWith('.sh') ? 0o100755 : 0o100644) << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed); central.push(entry, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(destination, Buffer.concat([...parts, directory, end]));
}
module.exports = { writeZip };
