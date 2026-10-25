'use strict';

/**
 * 字幕压缩包解压（零 npm 依赖）：
 * - zip（store / deflate，即最常见的两种），文件名兼容 GBK 编码的中文包；
 * - tar / tar.gz / tgz；
 * - rar / 7z 无法在零依赖前提下解压，识别后直接给出可读的报错。
 *
 * 安全与限额：条目名会过滤掉 .. / 绝对路径等越界段（防 zip-slip），
 * 并限制条目数、单文件与总解压体积，防止恶意超大包。
 */

const zlib = require('zlib');
const { badRequest } = require('./util');
const { safeRelPath } = require('./hardlink');

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function decodeName(raw, flags) {
  // zip 名字编码：UTF-8 标志位（bit 11）置位用 utf8；否则按中文环境常见的 GBK 解，失败再退 latin1
  if (flags & 0x0800) return raw.toString('utf8');
  try {
    const gbk = new TextDecoder('gbk', { fatal: true }).decode(raw);
    if (gbk && !/\uFFFD/.test(gbk)) return gbk;
  } catch { /* 非 GBK，走 latin1 */ }
  return raw.toString('latin1');
}

function sanitizeEntryName(name) {
  // 去掉盘符/盘符冒号、反斜杠与越界段；空名/纯目录返回空串
  let s = String(name == null ? '' : name).replace(/\\/g, '/').trim();
  s = s.replace(/^[a-zA-Z]:/, '');
  const rel = safeRelPath(s);
  return rel.endsWith('/') ? rel.slice(0, -1) : rel;
}

function checkLimits(count, totalBytes, fileSize, fileName) {
  if (count > MAX_ENTRIES) {
    throw badRequest(`压缩包条目太多（超过 ${MAX_ENTRIES} 个），请先清理后再上传`, 'ARCHIVE_TOO_MANY');
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw badRequest(`压缩包解压后总大小超过 ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB`, 'ARCHIVE_TOO_BIG');
  }
  if (fileSize > MAX_FILE_BYTES) {
    throw badRequest(`压缩包里的单个文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB：${fileName}`, 'ARCHIVE_FILE_TOO_BIG');
  }
}

// ---------- zip ----------

function findEocd(buf) {
  // EOCD 最短 22 字节，注释最长 65535；从尾部往前找签名
  const min = buf.length - 22;
  const start = Math.max(0, min - 65535);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function extractZip(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw badRequest('ZIP 文件损坏（找不到目录结尾）', 'BAD_ARCHIVE');
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  if (offset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    throw badRequest('暂不支持 Zip64 格式的压缩包', 'ARCHIVE_ZIP64');
  }
  if (offset + cdSize > buf.length) throw badRequest('ZIP 文件损坏（目录越界）', 'BAD_ARCHIVE');

  const entries = [];
  let totalBytes = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw badRequest('ZIP 文件损坏（目录项无效）', 'BAD_ARCHIVE');
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const uncompSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = decodeName(buf.subarray(offset + 46, offset + 46 + nameLen), flags);
    offset += 46 + nameLen + extraLen + commentLen;
    checkLimits(i + 1, totalBytes, uncompSize, name);
    if (flags & 0x0001) {
      throw badRequest(`压缩包已加密，暂不支持：${name}`, 'ARCHIVE_ENCRYPTED');
    }
    if (uncompSize === 0xFFFFFFFF) throw badRequest('暂不支持 Zip64 格式的压缩包', 'ARCHIVE_ZIP64');

    const rel = sanitizeEntryName(name);
    if (!rel) continue; // 目录或空名
    if (!compSize && !uncompSize) continue; // 空文件/目录项

    // 从 local header 取真实的数据起点（local 的 name/extra 长度可能与 central 不同）
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw badRequest(`ZIP 文件损坏（条目头无效）：${rel}`, 'BAD_ARCHIVE');
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) {
      throw badRequest(`ZIP 文件损坏（数据越界）：${rel}`, 'BAD_ARCHIVE');
    }
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    try {
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else throw new Error(`不支持的压缩方式（method ${method}）`);
    } catch (e) {
      throw badRequest(`解压失败：${rel}（${e.message}）`, 'ARCHIVE_DECOMPRESS');
    }
    totalBytes += data.length;
    checkLimits(entries.length + 1, totalBytes, data.length, rel);
    entries.push({ name: rel, data });
  }
  return entries;
}

// ---------- tar ----------

function tarSize(buf, off) {
  // GNU tar 对超大文件用 base-256；常规是八进制字符串
  if (buf[off] & 0x80) {
    let v = 0;
    for (let i = off + 1; i < off + 12; i++) v = v * 256 + buf[i];
    return v;
  }
  let s = '';
  for (let i = off; i < off + 12; i++) {
    if (!buf[i]) break;
    s += String.fromCharCode(buf[i]);
  }
  const v = parseInt(s.trim() || '0', 8);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function tarEntryName(buf, header) {
  let name = buf.subarray(header, header + 100).toString('utf8').replace(/\0+$/, '');
  const magic = buf.subarray(header + 257, header + 263).toString('latin1');
  if (magic.startsWith('ustar')) {
    const prefix = buf.subarray(header + 345, header + 500).toString('utf8').replace(/\0+$/, '');
    if (prefix) name = prefix + '/' + name;
  }
  return name;
}

function extractTarData(buf) {
  const entries = [];
  let off = 0;
  let pendingLongName = '';
  let totalBytes = 0;
  while (off + 512 <= buf.length) {
    const header = off;
    if (buf.subarray(header, header + 512).every((b) => b === 0)) break;
    const size = tarSize(buf, header + 124);
    const type = String.fromCharCode(buf[header + 156] || 0x30);
    const dataStart = header + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw badRequest('TAR 文件损坏（数据越界）', 'BAD_ARCHIVE');
    off = dataEnd + (size % 512 ? 512 - (size % 512) : 0); // 数据按 512 对齐

    if (type === 'L') { // GNU long name
      pendingLongName = buf.subarray(dataStart, dataStart + size).toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'x' || type === 'g') continue; // pax 头，忽略

    let name = pendingLongName || tarEntryName(buf, header);
    pendingLongName = '';
    if (type === '5') continue; // 目录：保留在条目名里即可，不需要单独入列
    const rel = sanitizeEntryName(name);
    if (!rel) continue;
    if (type !== '0' && type !== '7') continue; // 只收常规文件（0 也覆盖省略 typeflag 的情况）
    checkLimits(entries.length + 1, totalBytes, size, rel);
    totalBytes += size;
    entries.push({ name: rel, data: Buffer.from(buf.subarray(dataStart, dataStart + size)) });
  }
  return entries;
}

function extractTar(buf, gzipped) {
  let data = buf;
  if (gzipped) {
    try {
      data = zlib.gunzipSync(buf);
    } catch (e) {
      throw badRequest('gzip 解压失败：' + e.message, 'ARCHIVE_DECOMPRESS');
    }
  }
  return extractTarData(data);
}

// ---------- 识别与分发 ----------

function archiveKind(fileName, buf) {
  const name = String(fileName || '').toLowerCase();
  if (/\.zip$/.test(name)) return 'zip';
  if (/\.tar$/.test(name)) return 'tar';
  if (/\.tar\.gz$|\.tgz$/.test(name)) return 'tar.gz';
  if (/\.rar$/.test(name)) return 'rar';
  if (/\.7z$/.test(name)) return '7z';
  // 扩展名不可信时按魔数兜底
  if (buf && buf.length > 4) {
    if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7)) return 'zip';
    if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tar.gz';
    if (buf.length > 262 && buf.subarray(257, 262).toString('latin1') === 'ustar') return 'tar';
  }
  return '';
}

/**
 * 解压一个压缩包；不是压缩包返回 null。
 * @returns {{kind:string, entries:Array<{name:string,data:Buffer}>}|null}
 */
function extractArchive(fileName, buf) {
  const kind = archiveKind(fileName, buf);
  if (!kind) return null;
  if (kind === 'rar') {
    throw badRequest('RAR 压缩包需要专有解码器，暂不支持；请改用 zip 或 tar 压缩后上传', 'ARCHIVE_UNSUPPORTED');
  }
  if (kind === '7z') {
    throw badRequest('7z 压缩包暂不支持；请改用 zip 或 tar 压缩后上传', 'ARCHIVE_UNSUPPORTED');
  }
  if (kind === 'zip') return { kind, entries: extractZip(buf) };
  return { kind, entries: extractTar(buf, kind === 'tar.gz') };
}

module.exports = { archiveKind, extractArchive, MAX_TOTAL_BYTES, MAX_FILE_BYTES };
