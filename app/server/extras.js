'use strict';

const fs = require('fs');
const path = require('path');
const { uid, nowMs, httpError, badRequest, filenameFromUrl, truncate, guessEpisode } = require('./util');
const { fetchBuffer } = require('./http');
const { extractArchive, archiveKind, MAX_TOTAL_BYTES } = require('./archive');
const { parseTorrentInfo, magnetInfoHash } = require('./bencode');
const hardlink = require('./hardlink');

/** 把名称变成可用于路径的一段（与前端同名逻辑保持一致） */
function sanitizeShareName(name) {
  return String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim()
    .slice(0, 120);
}

function clampOffset(v) {
  return Math.max(-999, Math.min(999, Math.trunc(Number(v) || 0)));
}

function downloadOptions(src) {
  return {
    savePath: String(src.savePath || '').trim(),
    category: String(src.category || '').trim(),
    tags: String(src.tags || '').trim(),
    paused: !!src.paused,
    hardlinkDest: String(src.hardlinkDest || '').trim(),
    season: Number(src.season) || 0,
    hardlinkEnabled: src.hardlinkEnabled !== false,
    rename: !!src.rename,
    offset: clampOffset(src.offset ?? src.videoOffset),
    subOffset: src.subOffset == null || src.subOffset === ''
      ? null
      : clampOffset(src.subOffset),
  };
}

class ExtrasService {
  constructor(store, { qb, log }) {
    this.store = store;
    this.qb = qb;
    this.log = log;
    this.hardlinkBusy = new Set();
    this.hardlinkTicking = false;
  }

  get data() {
    // 导入配置会替换 store.data，补番与引擎都读取当前对象。
    return this.store.data;
  }

  // ---------- 补番硬链接 ----------

  publicHardlinkConfig() {
    const cfg = this.data.hardlink || {};
    return {
      mode: cfg.mode === 'mirror' ? 'mirror' : 'season',
      videoExts: String(cfg.videoExts || hardlink.DEFAULT_EXTENSIONS),
      subExts: String(cfg.subExts || hardlink.DEFAULT_SUB_EXTENSIONS),
      excludeDirs: String(cfg.excludeDirs == null ? hardlink.DEFAULT_EXCLUDE_DIRS : cfg.excludeDirs),
      excludeTags: String(cfg.excludeTags == null ? hardlink.DEFAULT_EXCLUDE_TAGS : cfg.excludeTags),
      includeFonts: !!cfg.includeFonts,
      stripRoot: !!cfg.stripRoot,
      renamePattern: String(cfg.renamePattern || '${name} - ${episode2}'),
      defaultDest: String(cfg.defaultDest || ''),
    };
  }

  saveHardlink(input) {
    const src = input || {};
    const cur = this.data.hardlink || {};
    let defaultDest = src.defaultDest === undefined ? String(cur.defaultDest || '') : String(src.defaultDest || '').trim();
    if (defaultDest && !path.isAbsolute(defaultDest)) {
      throw badRequest('默认硬链接目录必须是绝对路径（例如 /volume1/media/动画）', 'BAD_HARDLINK_DEST');
    }
    if (defaultDest) defaultDest = path.normalize(defaultDest).replace(/[\\/]+$/, '');
    const mode = src.mode === undefined ? (cur.mode === 'mirror' ? 'mirror' : 'season') : (src.mode === 'mirror' ? 'mirror' : 'season');
    const text = (value, fallback, max) => (value === undefined ? String(fallback == null ? '' : fallback) : String(value || '')).trim().slice(0, max || 300);
    let renamePattern = text(src.renamePattern, cur.renamePattern == null ? '${name} - ${episode2}' : cur.renamePattern, 200);
    if (!renamePattern) renamePattern = '${name} - ${episode2}';
    if (!/\$\{?\{?\s*episode2?\s*\}?\}/i.test(renamePattern)) {
      throw badRequest('重命名模板必须包含 ${episode} 或 ${episode2}，否则每集都会重名', 'BAD_RENAME_PATTERN');
    }
    const next = {
      mode,
      videoExts: text(src.videoExts, cur.videoExts == null ? hardlink.DEFAULT_EXTENSIONS : cur.videoExts),
      subExts: text(src.subExts, cur.subExts == null ? hardlink.DEFAULT_SUB_EXTENSIONS : cur.subExts),
      excludeDirs: text(src.excludeDirs, cur.excludeDirs == null ? hardlink.DEFAULT_EXCLUDE_DIRS : cur.excludeDirs, 600),
      excludeTags: text(src.excludeTags, cur.excludeTags == null ? hardlink.DEFAULT_EXCLUDE_TAGS : cur.excludeTags, 600),
      includeFonts: src.includeFonts === undefined ? !!cur.includeFonts : !!src.includeFonts,
      stripRoot: src.stripRoot === undefined ? !!cur.stripRoot : !!src.stripRoot,
      renamePattern,
      defaultDest,
    };
    const before = {
      mode: cur.mode === 'mirror' ? 'mirror' : 'season',
      videoExts: String(cur.videoExts == null ? hardlink.DEFAULT_EXTENSIONS : cur.videoExts),
      subExts: String(cur.subExts == null ? hardlink.DEFAULT_SUB_EXTENSIONS : cur.subExts),
      excludeDirs: String(cur.excludeDirs == null ? hardlink.DEFAULT_EXCLUDE_DIRS : cur.excludeDirs),
      excludeTags: String(cur.excludeTags == null ? hardlink.DEFAULT_EXCLUDE_TAGS : cur.excludeTags),
      includeFonts: !!cur.includeFonts,
      stripRoot: !!cur.stripRoot,
      renamePattern: String(cur.renamePattern || '${name} - ${episode2}'),
      defaultDest: String(cur.defaultDest || ''),
    };
    const changed = JSON.stringify(next) !== JSON.stringify(before);
    this.data.hardlink = next;
    if (changed) {
      this.store.save();
      const label = next.mode === 'mirror' ? '全部文件（保持相对路径）' : '正片+字幕（平铺到季目录）';
      this.log('info', `硬链接设置已保存：${label}，视频 ${next.videoExts || '全部'}，字幕 ${next.subExts || '无'}`);
    }
    return this.publicHardlinkConfig();
  }

  /**
   * 校验并渲染硬链接目标目录。
   * 支持 ${name}（补番名称）、${season}（季），以及路径预设里的数字变量：
   * 第 1 个变量 = 名称，第 2 个及以后 = 季。
   */
  resolveHardlinkDest(input, name, season) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) return '';
    const show = sanitizeShareName(name);
    const seasonText = Number.isFinite(Number(season)) && Number(season) > 0 ? String(Math.trunc(Number(season))) : '';
    let filled = raw
      .replace(/\$?\{\{\s*name\s*\}\}|\$\{\s*name\s*\}/gi, show)
      .replace(/\$?\{\{\s*season\s*\}\}|\$\{\s*season\s*\}/gi, seasonText);
    // 路径预设里的数字变量：${1} / ${{1}} / ${{}}
    let index = 0;
    filled = filled.replace(/\$?\{\{\s*(\d*)\s*\}\}|\$\{\s*(\d+)\s*\}/g, (all, anon, num) => {
      index += 1;
      const value = index === 1 ? show : seasonText;
      return value;
    });
    if (/\$\{/.test(filled)) {
      throw badRequest('硬链接目录只支持 ${name} / ${season} 变量，其他模板变量请改成固定目录', 'BAD_HARDLINK_TEMPLATE');
    }
    if (!path.isAbsolute(filled)) {
      throw badRequest('硬链接目录必须是绝对路径（例如 /volume1/media/动画）', 'BAD_HARDLINK_DEST');
    }
    const dest = path.normalize(filled).replace(/[\\/]+$/, '');
    if (!dest) throw badRequest('硬链接目录无效', 'BAD_HARDLINK_DEST');
    return dest.slice(0, 800);
  }

  /** 检查目录是否可写（用于解释「无法创建目录」并给出真实权限） */
  probeHardlinkPath(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) throw badRequest('请填写要检查的目录', 'BAD_HARDLINK_PROBE');
    if (!path.isAbsolute(raw)) throw badRequest('目录必须是绝对路径', 'BAD_HARDLINK_DEST');
    return hardlink.probePath(raw);
  }

  importHardlinkConfig(src) {
    const cur = this.data.hardlink || {};
    const pick = (key, fallback, max) => String(src[key] == null ? (cur[key] == null ? fallback : cur[key]) : src[key]).slice(0, max);
    this.data.hardlink = {
      mode: (src.mode || cur.mode) === 'mirror' ? 'mirror' : 'season',
      videoExts: pick('videoExts', hardlink.DEFAULT_EXTENSIONS, 300),
      subExts: pick('subExts', hardlink.DEFAULT_SUB_EXTENSIONS, 300),
      excludeDirs: pick('excludeDirs', hardlink.DEFAULT_EXCLUDE_DIRS, 600),
      excludeTags: pick('excludeTags', hardlink.DEFAULT_EXCLUDE_TAGS, 600),
      includeFonts: src.includeFonts === undefined ? !!cur.includeFonts : !!src.includeFonts,
      stripRoot: !!src.stripRoot,
      defaultDest: String(src.defaultDest || '').slice(0, 800),
    };
  }

  // ---------- 外挂字幕库 ----------

  subsDir(extraId) {
    return path.join(this.store.dir, 'subtitles', String(extraId));
  }

  /** 字幕库接受哪些文件：硬链接设置里的字幕扩展名 + 常见字体 */
  extraSubAccepted(name) {
    const cfg = this.publicHardlinkConfig();
    const subExts = hardlink.parseExtensions(cfg.subExts);
    for (const ext of ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2']) subExts.add(ext);
    const base = String(name || '').replace(/\\/g, '/').split('/').pop();
    const idx = base.lastIndexOf('.');
    if (idx <= 0 || idx === base.length - 1) return false;
    return subExts.has(base.slice(idx + 1).toLowerCase());
  }

  /**
   * 落一个字幕文件到字幕库（保留压缩包内的目录层级），并同步到补番记录。
   * 相对路径已经过 safeRelPath 清洗，不含 .. 越界段。
   */
  writeExtraSubFile(extra, relName, data) {
    const rel = hardlink.safeRelPath(relName);
    if (!rel) return null;
    const dir = this.subsDir(extra.id);
    const full = path.join(dir, ...rel.split('/'));
    if (!full.startsWith(dir + path.sep)) return null;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data, { mode: 0o644 });
    extra.subs = Array.isArray(extra.subs) ? extra.subs : [];
    const existing = extra.subs.find((s) => s.name === rel);
    const entry = { name: rel, size: data.length, at: nowMs() };
    if (existing) Object.assign(existing, entry);
    else extra.subs.push(entry);
    return entry;
  }

  /**
   * 把字幕库里的文件转成硬链接规划用的合成条目：
   * progress=1 视为已完成，abs 指向字幕库真实路径，跨分区时允许复制兜底。
   */
  extraSubFileEntries(extra) {
    const out = [];
    const dir = this.subsDir(extra.id);
    for (const s of extra.subs || []) {
      const full = path.join(dir, ...String(s.name).split('/'));
      if (!full.startsWith(dir + path.sep)) continue;
      let st = null;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      out.push({ name: s.name, size: st.size, progress: 1, priority: 1, abs: full, allowCopy: true });
    }
    return out;
  }

  /** 解析/下载到的内容入库：压缩包自动解压，非压缩包按单文件处理 */
  extraSubsBytes(extra) {
    return (extra.subs || []).reduce((n, s) => n + (Number(s.size) || 0), 0);
  }

  ingestExtraSubs(extra, fileName, data, added, skipped) {
    const name = String(fileName || 'file').replace(/[\\/]+/g, '_').slice(0, 200);
    if (!data || !data.length) {
      skipped.push({ name, reason: '文件为空' });
      return;
    }
    if (data.length > 96 * 1024 * 1024) {
      skipped.push({ name, reason: '超过 96MB 上限' });
      return;
    }
    const store = (relName, buf) => {
      if (!this.extraSubAccepted(relName)) {
        skipped.push({ name: relName, reason: '不是可识别的字幕/字体扩展名' });
        return false;
      }
      if (this.extraSubsBytes(extra) + buf.length > MAX_TOTAL_BYTES) {
        skipped.push({ name: relName, reason: '字幕库累计超过 256MB，请先删除部分文件' });
        return false;
      }
      const storedEntry = this.writeExtraSubFile(extra, relName, buf);
      if (storedEntry) {
        added.push({ name: storedEntry.name, size: storedEntry.size });
        return true;
      }
      return false;
    };
    const kind = archiveKind(name, data);
    if (kind) {
      let entries;
      try {
        entries = extractArchive(name, data).entries;
      } catch (e) {
        skipped.push({ name, reason: e.message });
        return;
      }
      let stored = 0;
      for (const entry of entries) {
        if (store(entry.name, entry.data)) stored++;
      }
      if (!stored) skipped.push({ name, reason: `压缩包（${kind}）里没有可用的字幕/字体` });
      return;
    }
    if (!this.extraSubAccepted(name)) {
      skipped.push({ name, reason: '不是可识别的字幕/字体扩展名，也不是支持的压缩包（zip/tar）' });
      return;
    }
    store(name, data);
  }

  /** 入库后的公共收尾：保存记录，已完成的补番自动重新硬链接一次 */
  async finishExtraSubs(extra, added, skipped) {
    if (added.length) this.store.scheduleSave();
    let link = null;
    if (added.length && extra.hardlink && extra.hardlink.dest
      && extra.hardlink.enabled !== false && extra.ok) {
      try {
        await this.refreshExtraQb([extra]);
        const progress = Number(extra.qb && extra.qb.progress) || 0;
        if (progress >= 0.9999 && !this.hardlinkBusy.has(extra.id)) {
          const result = await this.linkExtraRecord(extra);
          if (result && !result.notReady) {
            link = {
              ok: !!result.ok, linked: result.linked || 0, copied: result.copied || 0,
              existed: result.existed || 0, conflicts: result.conflicts || 0,
              subs: result.subs || 0, error: result.error || '',
            };
          }
        }
      } catch { /* 链接失败不打断字幕入库，卡片上可手动重跑 */ }
    }
    return { ok: true, added, skipped, link };
  }

  /** 补番页批量上传字幕/压缩包 */
  async addExtraSubsUpload(id, input) {
    const extra = this.data.extras.find((e) => e.id === id);
    if (!extra) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    const files = Array.isArray(input && input.files) ? input.files : [];
    if (!files.length) throw badRequest('请选择要上传的字幕文件或压缩包', 'EMPTY_SUBS_UPLOAD');
    if (files.length > 20) throw badRequest('一次最多上传 20 个文件，大包请压缩后上传', 'TOO_MANY_FILES');
    const added = [];
    const skipped = [];
    for (const f of files.slice(0, 20)) {
      const name = String(f && f.name || 'file');
      let data = null;
      try {
        data = Buffer.from(String(f && f.data || '').replace(/^data:[^,]+,/, ''), 'base64');
      } catch {
        skipped.push({ name, reason: '文件内容不是有效的 base64' });
        continue;
      }
      this.ingestExtraSubs(extra, name, data, added, skipped);
    }
    this.log('info', `补番「${extra.name}」上传字幕：新增 ${added.length} 个${skipped.length ? `，跳过 ${skipped.length} 个` : ''}`);
    return this.finishExtraSubs(extra, added, skipped);
  }

  /** 从链接自动下载字幕（字幕文件或 zip/tar 压缩包） */
  async addExtraSubsFromUrl(id, input) {
    const extra = this.data.extras.find((e) => e.id === id);
    if (!extra) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    const url = String(input && input.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw badRequest('请填写 http/https 的字幕下载链接', 'BAD_SUBS_URL');
    const res = await fetchBuffer(url, {
      timeout: 60000,
      maxBytes: 96 * 1024 * 1024,
      proxy: this.data.proxy,
      headers: { 'Accept': 'application/zip, application/x-tar, application/octet-stream, text/*, */*' },
    });
    const fileName = filenameFromUrl(res.url || url, 'subs.zip');
    const added = [];
    const skipped = [];
    this.ingestExtraSubs(extra, fileName, res.buffer, added, skipped);
    this.log('info', `补番「${extra.name}」从链接抓取字幕：新增 ${added.length} 个${skipped.length ? `，跳过 ${skipped.length} 个` : ''}`);
    return this.finishExtraSubs(extra, added, skipped);
  }

  /** 删除字幕库文件（单个或全部） */
  removeExtraSubs(id, input) {
    const extra = this.data.extras.find((e) => e.id === id);
    if (!extra) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    const options = input || {};
    const dir = this.subsDir(extra.id);
    if (options.all) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      const count = (extra.subs || []).length;
      extra.subs = [];
      this.store.save();
      this.log('info', `已清空补番「${extra.name}」的字幕库（${count} 个文件）`);
      return { ok: true, removed: count };
    }
    const name = String(options.name || '').replace(/\\/g, '/').trim();
    if (!name) throw badRequest('请指定要删除的字幕文件，或用 all=1 清空', 'EMPTY_SUBS_NAME');
    const full = path.join(dir, ...hardlink.safeRelPath(name).split('/'));
    if (!full.startsWith(dir + path.sep)) throw badRequest('字幕路径无效', 'BAD_SUBS_NAME');
    let removed = 0;
    try {
      if (fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
        removed = 1;
      }
    } catch { /* ignore */ }
    // 顺手清掉空目录
    let parent = path.dirname(full);
    while (parent.startsWith(dir + path.sep) && parent !== dir) {
      try { fs.rmdirSync(parent); } catch { break; }
      parent = path.dirname(parent);
    }
    extra.subs = (extra.subs || []).filter((s) => s.name !== name);
    this.store.save();
    return { ok: true, removed };
  }

  // ---------- 补番记录与下载 ----------

  publicExtra(x) {
    const e = x || {};
    const guess = guessEpisode(e.name);
    let destResolved = '';
    if (e.hardlink && e.hardlink.dest) {
      try {
        destResolved = this.resolveHardlinkDest(e.hardlink.dest, e.name, e.hardlink.season);
      } catch {
        destResolved = e.hardlink.dest;
      }
    }
    return {
      id: e.id,
      name: e.name,
      source: e.source,
      magnet: e.source === 'magnet' ? e.magnet : '',
      hash: e.hash,
      fileName: e.fileName,
      savePath: e.savePath,
      category: e.category,
      tags: e.tags,
      paused: !!e.paused,
      ok: !!e.ok,
      error: e.error || '',
      createdAt: e.createdAt || 0,
      subs: (e.subs || []).slice(0, 100).map((s) => ({
        name: s.name,
        size: Number(s.size) || 0,
        at: Number(s.at) || 0,
      })),
      episode: guess ? guess.episode : null,
      episodeLabel: guess ? guess.label : '',
      episodeKind: guess ? guess.kind : '',
      qb: e.qb || null,
      hardlink: e.hardlink
        ? {
          dest: e.hardlink.dest || '',
          destResolved,
          season: e.hardlink.season || 0,
          enabled: e.hardlink.enabled !== false,
          rename: !!e.hardlink.rename,
          offset: Number(e.hardlink.offset) || 0,
          subOffset: e.hardlink.subOffset == null ? null : (Number(e.hardlink.subOffset) || 0),
          done: !!e.hardlink.done,
          at: e.hardlink.at || 0,
          files: e.hardlink.files || 0,
          videos: e.hardlink.videos || 0,
          subs: e.hardlink.subs || 0,
          linked: e.hardlink.linked || 0,
          existed: e.hardlink.existed || 0,
          conflicts: e.hardlink.conflicts || 0,
          skipped: e.hardlink.skipped || 0,
          bytes: e.hardlink.bytes || 0,
          error: e.hardlink.error || '',
          attempts: e.hardlink.attempts || 0,
          retryAt: e.hardlink.retryAt || 0,
        }
        : null,
    };
  }

  extrasPublic(limit) {
    return this.data.extras.slice(0, limit).map((x) => this.publicExtra(x));
  }

  pushExtra(rec) {
    const clean = { ...rec };
    delete clean.buffer;
    this.data.extras.unshift(clean);
    if (this.data.extras.length > 300) this.data.extras.length = 300;
    this.store.scheduleSave();
  }

  magnetName(magnet) {
    try {
      const idx = String(magnet).indexOf('?');
      if (idx < 0) return '';
      const params = new URLSearchParams(String(magnet).slice(idx + 1));
      return String(params.get('dn') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch {
      return '';
    }
  }

  async addExtra(input) {
    const src = input || {};
    const magnet = String(src.magnet || '').trim();
    if (!magnet) throw badRequest('请粘贴磁力链接', 'EMPTY_MAGNET');
    if (!/^magnet:\?/i.test(magnet)) throw badRequest('磁力链接应以 magnet:? 开头', 'BAD_MAGNET');
    const hash = magnetInfoHash(magnet);
    if (!hash) throw badRequest('无法从磁力链接解析 infohash，请检查链接', 'BAD_MAGNET_HASH');
    const name = String(src.name || '').trim() || this.magnetName(magnet) || `磁力 ${hash.slice(0, 8)}`;
    return this.submitExtra({
      source: 'magnet',
      magnet,
      hash,
      name,
      ...downloadOptions(src),
    });
  }

  async addExtraFile(input) {
    const src = input || {};
    const b64 = String(src.fileBase64 || '').replace(/^data:[^,]+,/, '');
    if (!b64) throw badRequest('请选择 .torrent 文件', 'EMPTY_FILE');
    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw badRequest('种子文件内容无效', 'BAD_FILE');
    }
    if (!buffer || !buffer.length) throw badRequest('种子文件内容为空', 'EMPTY_FILE');
    if (buffer.length > 8 * 1024 * 1024) throw badRequest('种子文件过大（上限 8MB）', 'FILE_TOO_LARGE');
    let parsed;
    try {
      parsed = parseTorrentInfo(buffer);
    } catch (e) {
      throw badRequest(`种子文件解析失败：${e.message}`, 'BAD_TORRENT');
    }
    const fileName = String(src.fileName || 'file.torrent').replace(/[\\/]+/g, '_').slice(0, 200);
    const name = String(src.name || '').trim() || fileName.replace(/\.torrent$/i, '');
    return this.submitExtra({
      source: 'file',
      buffer,
      fileName,
      hash: parsed.hash,
      name,
      ...downloadOptions(src),
    });
  }

  async submitExtra(payload) {
    const name = truncate(String(payload.name || '未命名补番'), 160);
    const season = Math.max(0, Math.min(999, Math.trunc(Number(payload.season) || 0)));
    const destTemplate = String(payload.hardlinkDest || '').trim();
    if (destTemplate) this.resolveHardlinkDest(destTemplate, name, season);
    const rec = {
      id: uid('x_'),
      createdAt: nowMs(),
      ok: false,
      error: '',
      name,
      source: payload.source,
      magnet: payload.magnet || '',
      hash: String(payload.hash || '').toLowerCase(),
      fileName: payload.fileName || '',
      savePath: payload.savePath || '',
      category: payload.category || '',
      tags: payload.tags || '',
      paused: !!payload.paused,
      qb: null,
      hardlink: {
        dest: destTemplate,
        season,
        enabled: payload.hardlinkEnabled !== false,
        rename: !!payload.rename,
        offset: clampOffset(payload.offset),
        subOffset: payload.subOffset == null
          ? null
          : clampOffset(payload.subOffset),
        done: false,
        at: 0,
        files: 0,
        videos: 0,
        subs: 0,
        linked: 0,
        existed: 0,
        conflicts: 0,
        skipped: 0,
        bytes: 0,
        error: '',
        attempts: 0,
        retryAt: 0,
      },
    };
    if (!/^[a-f0-9]{40}$/.test(rec.hash)) throw badRequest('无法确定种子 infohash', 'BAD_HASH');
    const dupRecord = this.data.extras.find((x) => x.ok && x.hash === rec.hash);
    if (dupRecord) throw httpError(409, `该种子已在补番记录中：${dupRecord.name}`, 'EXTRA_DUPLICATE');
    let inQb = false;
    try { inQb = await this.qb().hasTorrent(rec.hash); } catch { inQb = false; }
    if (inQb) {
      rec.error = 'qBittorrent 中已存在相同种子（infohash 相同）';
      this.pushExtra(rec);
      throw httpError(409, rec.error, 'EXTRA_IN_QB');
    }
    try {
      const opts = { savePath: rec.savePath, category: rec.category, tags: rec.tags, paused: rec.paused };
      if (rec.source === 'file') await this.qb().addTorrent({ ...opts, buffer: payload.buffer, filename: rec.fileName });
      else await this.qb().addTorrent({ ...opts, urls: rec.magnet });
      rec.ok = true;
      this.pushExtra(rec);
      this.log('info', `补番已提交「${rec.name}」${rec.savePath ? ` → ${rec.savePath}` : ''}（${rec.source === 'file' ? '种子文件' : '磁力链接'}）`);
      return this.publicExtra(rec);
    } catch (e) {
      rec.ok = false;
      rec.error = e.message;
      this.pushExtra(rec);
      throw e;
    }
  }

  /** 把 qB 的 torrents/info 条目转成记录里保存的 qb 快照 */
  qbSnapshot(t, fallbackName) {
    if (!t) return null;
    return {
      state: String(t.state || ''),
      progress: Number(t.progress) || 0,
      size: Number(t.size) || 0,
      dlspeed: Number(t.dlspeed) || 0,
      upspeed: Number(t.upspeed) || 0,
      eta: Number(t.eta) || 0,
      savePath: String(t.save_path || ''),
      name: String(t.name || fallbackName || ''),
      at: nowMs(),
    };
  }

  /** 刷新一批补番记录的 qB 状态，返回 hash → info 的映射 */
  async refreshExtraQb(list) {
    let info = [];
    let error = '';
    try {
      info = await this.qb().torrentsInfo(list.map((x) => x.hash));
    } catch (e) {
      error = e.message;
    }
    const map = new Map(info.map((t) => [String(t.hash || '').toLowerCase(), t]));
    let changed = false;
    for (const x of list) {
      const next = this.qbSnapshot(map.get(String(x.hash).toLowerCase()), x.name);
      if (JSON.stringify(next) !== JSON.stringify(x.qb || null)) {
        x.qb = next;
        changed = true;
      }
    }
    return { map, error, changed };
  }

  async extrasStatus() {
    const list = this.data.extras.filter((x) => x.hash);
    if (!list.length) return { ok: true, at: nowMs(), extras: this.extrasPublic(), missing: 0 };
    const { error, changed } = await this.refreshExtraQb(list);
    if (changed) this.store.scheduleSave();
    const linked = await this.autoHardlink(list);
    return {
      ok: !error,
      error,
      at: nowMs(),
      missing: error ? 0 : list.filter((x) => !x.qb).length,
      hardlinked: linked,
      extras: this.extrasPublic(),
    };
  }

  // ---------- 补番硬链接 ----------

  /** 这条记录是否还等着做硬链接 */
  // ---------- 自动与手动入库 ----------

  wantsHardlink(x) {
    return !!(x && x.ok && x.hash && x.hardlink && x.hardlink.dest
      && x.hardlink.enabled !== false && !x.hardlink.done);
  }

  bumpHardlinkRetry(hl) {
    hl.attempts = (Number(hl.attempts) || 0) + 1;
    const delay = Math.min(60 * 60000, 2 * 60000 * Math.pow(2, Math.min(5, hl.attempts - 1)));
    hl.retryAt = nowMs() + delay;
  }

  /** 下载完成（progress 到 1）后自动硬链接，最多一次处理 3 条 */
  async autoHardlink(list) {
    const ready = list.filter((x) => this.wantsHardlink(x)
      && Number(x.qb && x.qb.progress) >= 0.9999
      && nowMs() >= Number(x.hardlink.retryAt || 0));
    let done = 0;
    for (const x of ready.slice(0, 3)) {
      try {
        const result = await this.linkExtraRecord(x);
        if (result) done++;
      } catch { /* 单条失败不影响其它记录 */ }
    }
    return done;
  }

  /** 对一条记录执行硬链接（自动与手动共用） */
  async linkExtraRecord(x) {
    if (!x || !x.hardlink || !x.hardlink.dest) return null;
    if (x.hardlink.enabled === false) return null;
    if (this.hardlinkBusy.has(x.id)) return null;
    this.hardlinkBusy.add(x.id);
    const prevError = x.hardlink.error;
    const fail = (message) => {
      x.hardlink.error = message;
      this.bumpHardlinkRetry(x.hardlink);
      this.store.scheduleSave();
      // 同一错误只记一次，避免轮询刷日志
      if (prevError !== message) this.log('error', `补番硬链接失败「${x.name}」：${message}`);
      return null;
    };
    try {
      const cfg = this.publicHardlinkConfig();
      let info = [];
      try {
        info = await this.qb().torrentsInfo([x.hash]);
      } catch (e) {
        return fail(`读取 qBittorrent 任务失败：${e.message}`);
      }
      const t = info[0] || null;
      if (!t) return fail('qBittorrent 中找不到该任务（可能已被删除）');
      const snapshot = this.qbSnapshot(t, x.name);
      if (snapshot) x.qb = snapshot;
      const progress = Number(t.progress) || 0;
      if (progress < 0.9999) {
        x.hardlink.error = `等待下载完成（${Math.round(progress * 100)}%）`;
        x.hardlink.retryAt = 0;
        this.store.scheduleSave();
        return { ok: false, notReady: true, error: x.hardlink.error };
      }
      let files = [];
      try {
        files = await this.qb().torrentsFiles(x.hash);
      } catch (e) {
        return fail(`读取种子文件列表失败：${e.message}`);
      }
      // 外挂字幕库里的文件一起参与规划（配对、重命名与种子内字幕同一套逻辑）
      const subEntries = this.extraSubFileEntries(x);
      if (subEntries.length) files = files.concat(subEntries);
      const result = await hardlink.runHardlink({
        savePath: String(t.save_path || (x.qb && x.qb.savePath) || ''),
        destRoot: this.resolveHardlinkDest(x.hardlink.dest, x.name, x.hardlink.season),
        files,
        name: x.name,
        season: Number(x.hardlink.season) || 0,
        mode: cfg.mode,
        videoExts: cfg.videoExts,
        subExts: cfg.subExts,
        excludeDirs: cfg.excludeDirs,
        excludeTags: cfg.excludeTags,
        includeFonts: cfg.includeFonts,
        rename: !!x.hardlink.rename,
        renamePattern: cfg.renamePattern,
        offset: Number(x.hardlink.offset) || 0,
        subOffset: x.hardlink.subOffset == null ? null : (Number(x.hardlink.subOffset) || 0),
        extensions: cfg.videoExts,
        stripRoot: cfg.stripRoot,
      });
      const hl = x.hardlink;
      hl.at = nowMs();
      hl.files = result.files || 0;
      hl.videos = result.videos || 0;
      hl.subs = result.subs || 0;
      hl.linked = result.linked || 0;
      hl.existed = result.existed || 0;
      hl.conflicts = result.conflicts || 0;
      hl.skipped = result.skipped || 0;
      hl.bytes = result.bytes || 0;
      hl.error = result.ok ? '' : (result.error || '硬链接失败');
      // 没有匹配扩展名的文件时重试也没意义，照样标记完成并留下提示
      hl.done = !!result.ok || !!result.empty;
      if (hl.done) {
        hl.attempts = 0;
        hl.retryAt = 0;
        const content = cfg.mode === 'mirror'
          ? `新建 ${hl.linked} 个${hl.existed ? `，已存在 ${hl.existed} 个` : ''}`
          : `${hl.videos} 集 + ${hl.subs} 字幕（新建 ${hl.linked}，已存在 ${hl.existed}，跳过 ${hl.conflicts}）`;
        this.log('info', `补番硬链接「${x.name}」：${content} → ${this.resolveHardlinkDest(hl.dest, x.name, hl.season)}${hl.error ? `（${hl.error}）` : ''}`);
      } else {
        this.bumpHardlinkRetry(hl);
        if (prevError !== hl.error) this.log('error', `补番硬链接失败「${x.name}」：${hl.error}`);
      }
      this.store.scheduleSave();
      return result;
    } finally {
      this.hardlinkBusy.delete(x.id);
    }
  }

  /** 修改某条补番的硬链接目录 / 季 / 开关 / 偏移（空目录 = 取消硬链接；subOffset 传空 = 跟随整体偏移） */
  updateExtraHardlink(id, input) {
    const x = this.data.extras.find((e) => e.id === id);
    if (!x) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    const src = input || {};
    const season = src.season === undefined
      ? Number(x.hardlink && x.hardlink.season) || 0
      : Math.max(0, Math.min(999, Math.trunc(Number(src.season) || 0)));
    const dest = String(src.dest === undefined ? ((x.hardlink && x.hardlink.dest) || '') : (src.dest || '')).trim();
    if (dest) this.resolveHardlinkDest(dest, x.name, season);
    if (!x.hardlink) {
      x.hardlink = {
        dest: '', season: 0, enabled: true, rename: false, offset: 0, subOffset: null,
        done: false, at: 0, files: 0, videos: 0, subs: 0,
        linked: 0, existed: 0, conflicts: 0, skipped: 0, bytes: 0, error: '', attempts: 0, retryAt: 0,
      };
    }
    const enabled = src.enabled === undefined ? x.hardlink.enabled !== false : !!src.enabled;
    const rename = src.rename === undefined ? !!x.hardlink.rename : !!src.rename;
    // 整体偏移：接受 offset（新）/ videoOffset（旧）入参；字幕偏移：空串/null = 跟随
    const offset = (src.offset !== undefined || src.videoOffset !== undefined)
      ? clampOffset(src.offset !== undefined ? src.offset : src.videoOffset)
      : (Number(x.hardlink.offset) || 0);
    const subOffset = src.subOffset === undefined
      ? (x.hardlink.subOffset == null ? null : (Number(x.hardlink.subOffset) || 0))
      : (src.subOffset === '' || src.subOffset == null ? null : clampOffset(src.subOffset));
    const curOffset = Number(x.hardlink.offset) || 0;
    const curSubOffset = x.hardlink.subOffset == null ? null : (Number(x.hardlink.subOffset) || 0);
    const changed = dest !== x.hardlink.dest
      || season !== (Number(x.hardlink.season) || 0)
      || rename !== !!x.hardlink.rename
      || offset !== curOffset
      || subOffset !== curSubOffset;
    const reenabled = enabled && x.hardlink.enabled === false;
    if (changed || reenabled) {
      x.hardlink.dest = dest;
      x.hardlink.season = season;
      x.hardlink.rename = rename;
      x.hardlink.offset = offset;
      x.hardlink.subOffset = subOffset;
      x.hardlink.enabled = enabled;
      x.hardlink.done = false;
      x.hardlink.at = 0;
      x.hardlink.files = 0;
      x.hardlink.videos = 0;
      x.hardlink.subs = 0;
      x.hardlink.linked = 0;
      x.hardlink.existed = 0;
      x.hardlink.conflicts = 0;
      x.hardlink.skipped = 0;
      x.hardlink.bytes = 0;
      x.hardlink.error = '';
      x.hardlink.attempts = 0;
      x.hardlink.retryAt = 0;
      this.store.save();
      const shown = dest ? this.resolveHardlinkDest(dest, x.name, season) : '不硬链接';
      const extraBits = [];
      if (rename) extraBits.push('重命名');
      if (offset) extraBits.push(`整体${offset > 0 ? '+' : ''}${offset}`);
      if (subOffset == null) {
        if (offset) extraBits.push('字幕跟随整体');
      } else if (subOffset) {
        extraBits.push(`字幕${subOffset > 0 ? '+' : ''}${subOffset}`);
      }
      this.log('info', `补番硬链接目标已改为「${shown}」${extraBits.length ? `（${extraBits.join('，')}）` : ''}${enabled ? '' : '，已关闭'}：${x.name}`);
    } else if (enabled !== (x.hardlink.enabled !== false)) {
      x.hardlink.enabled = enabled;
      this.store.save();
      this.log('info', `补番硬链接已${enabled ? '开启' : '关闭'}：${x.name}`);
    }
    return this.publicExtra(x);
  }

  /** 手动触发某条补番的硬链接 */
  async linkExtra(id) {
    const x = this.data.extras.find((e) => e.id === id);
    if (!x) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    if (!x.hardlink || !x.hardlink.dest) throw badRequest('这条补番没有设置硬链接目录', 'HARDLINK_NO_DEST');
    if (x.hardlink.enabled === false) throw badRequest('这条补番已关闭入库，可在「详情 → 入库设置」中开启', 'HARDLINK_DISABLED');
    if (this.hardlinkBusy.has(x.id)) throw httpError(409, '硬链接正在执行，请稍等', 'HARDLINK_BUSY');
    const result = await this.linkExtraRecord(x);
    if (!result) throw httpError(409, x.hardlink.error || '硬链接未执行', 'HARDLINK_FAILED');
    if (result.notReady) throw httpError(409, result.error || '尚未下载完成', 'HARDLINK_NOT_READY');
    return { ok: !!result.ok, result, extra: this.publicExtra(x) };
  }

  /** 后台巡检：只处理等着硬链接的记录，避免每轮都拉全部补番状态 */
  async hardlinkTick() {
    if (this.hardlinkTicking || !this.data.qb.baseUrl) return;
    const now = nowMs();
    const pending = this.data.extras.filter((x) => this.wantsHardlink(x) && now >= Number(x.hardlink.retryAt || 0));
    if (!pending.length) return;
    this.hardlinkTicking = true;
    try {
      const { error, changed } = await this.refreshExtraQb(pending);
      if (changed) this.store.scheduleSave();
      if (!error) await this.autoHardlink(pending);
    } catch { /* 下一轮再说 */ } finally {
      this.hardlinkTicking = false;
    }
  }

  async deleteExtra(id, opts) {
    const x = this.data.extras.find((e) => e.id === id);
    if (!x) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    const options = opts || {};
    let deletedTorrent = false;
    if (options.deleteTorrent && x.hash) {
      await this.qb().deleteTorrents([x.hash], !!options.deleteFiles);
      deletedTorrent = true;
    }
    this.data.extras = this.data.extras.filter((e) => e.id !== id);
    try { fs.rmSync(this.subsDir(id), { recursive: true, force: true }); } catch { /* ignore */ }
    this.store.save();
    this.log('info', `已删除补番记录「${x.name}」${deletedTorrent ? '（同时删除 qB 任务）' : ''}`);
    return { ok: true, deletedTorrent };
  }

  /**
   * 补番记录的「可迁移」形态：只保留配置，丢掉与本机 qBittorrent / 硬链接进度绑定的运行态。
   * 导出与导入共用，避免旧备份或手工文件把 qB 快照、已完成标记带回来。
   */
  portableExtra(x) {
    const e = x || {};
    const hl = e.hardlink && typeof e.hardlink === 'object' ? e.hardlink : {};
    // eslint-disable-next-line no-unused-vars -- 故意从 rest 中剥离 qB 运行快照
    const { qb, ...rest } = e; // qB 运行快照不跨机器迁移
    return {
      ...rest,
      hardlink: {
        dest: String(hl.dest || ''),
        season: Math.max(0, Math.min(999, Number(hl.season) || 0)),
        enabled: hl.enabled !== false,
        rename: !!hl.rename,
        offset: clampOffset(hl.offset),
        subOffset: hl.subOffset == null || hl.subOffset === '' ? null : clampOffset(hl.subOffset),
      },
    };
  }
}

module.exports = { ExtrasService };
