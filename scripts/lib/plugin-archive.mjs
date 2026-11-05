import path from 'node:path';
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
export const MAX_PLUGIN_ARCHIVE = 16 * 1024 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
function safePath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || !/^[a-zA-Z0-9_.@/-]+$/.test(name)) throw new Error('插件包路径无效');
  return name;
}
/** Deterministic USTAR, regular files only. No tar subprocess or link extraction. */
export function packPlugin(directory) {
  const chunks = [];
  let size = 0, count = 0;
  function visit(relative) {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      const child = relative ? `${relative}/${name}` : name;
      safePath(child);
      const file = path.join(directory, child), stat = lstatSync(file);
      if (stat.isDirectory()) { visit(child); continue; }
      if (!stat.isFile() || stat.isSymbolicLink() || ++count > 4000 || (size += stat.size) > MAX_EXPANDED) throw new Error('插件包包含特殊文件或超出大小限制');
      const data = readFileSync(file), header = Buffer.alloc(512);
      let base = child, prefix = '';
      if (Buffer.byteLength(child) > 100) {
        const at = child.lastIndexOf('/'); prefix = child.slice(0, at); base = child.slice(at + 1);
      }
      if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('插件包路径过长');
      header.write(base, 0, 100); header.write(prefix, 345, 155);
      header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
      header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
      header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48;
      header.write('ustar\0', 257); header.write('00', 263);
      const checksum = header.reduce((n, b) => n + b, 0);
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
      chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
    }
  }
  visit(''); chunks.push(Buffer.alloc(1024));
  const result = gzipSync(Buffer.concat(chunks), { level: 9 });
  if (result.length > MAX_PLUGIN_ARCHIVE) throw new Error('插件包压缩大小超限');
  return result;
}
export function unpackPlugin(archive, directory) {
  if (archive.length > MAX_PLUGIN_ARCHIVE) throw new Error('插件包压缩大小超限');
  const tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED + 5 * 1024 * 1024 });
  const files = [], names = new Set(); let offset = 0, total = 0, ended = false;
  const string = (h, a, b) => h.subarray(a, b).toString('utf8').split('\0')[0];
  const octal = (s) => { if (!/^[0-7]+$/.test(s.trim())) throw new Error('插件包数值无效'); return parseInt(s.trim(), 8); };
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512); offset += 512;
    if (h.every(b => b === 0)) {
      if (tar.length - offset < 512 || !tar.subarray(offset).every(b => b === 0)) throw new Error('插件包结束标记无效');
      offset = tar.length; ended = true; break;
    }
    if (string(h, 257, 263) !== 'ustar' || ![0, 48].includes(h[156])) throw new Error('插件包仅支持普通 USTAR 文件');
    const expected = octal(string(h, 148, 156));
    const checksum = h.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    if (expected !== checksum) throw new Error('插件包头校验失败');
    const prefix = string(h, 345, 500), base = string(h, 0, 100);
    const name = safePath(prefix ? `${prefix}/${base}` : base);
    const size = octal(string(h, 124, 136));
    if (names.has(name) || files.length >= 4000 || (total += size) > MAX_EXPANDED || offset + size > tar.length) throw new Error('插件包重复文件、截断或大小超限');
    names.add(name); files.push({ name, data: tar.subarray(offset, offset + size) });
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended || offset !== tar.length || !files.length || !names.has('manifest.json')) throw new Error('插件包结构无效');
  // Validate the entire archive before creating anything. Destination is a new private staging directory.
  for (const file of files) {
    const target = path.join(directory, file.name);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.data, { flag: 'wx', mode: 0o600 });
  }
}
