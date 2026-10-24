'use strict';

const path = require('path');
const {
  APP_VERSION,
  uid,
  nowMs,
  httpError,
  badRequest,
  normalizeBaseUrl,
  validateFeedUrl,
  composeUrl,
  compileFilters,
  matchTitle,
  isMagnet,
  filenameFromUrl,
  looksLikeHtml,
  isHttpUrl,
  truncate,
  clampNumber,
  parseBool,
  todayStart,
  guessEpisode,
  episodeRanges,
  ByteLruCache,
} = require('./util');
const { fetchFeed } = require('./rss');
const { fetchBuffer, isHtmlResponse } = require('./http');
const { QBClient } = require('./qb');
const hardlink = require('./hardlink');
const { parseTorrentInfo, magnetInfoHash } = require('./bencode');
const { setProxy, publicProxy: proxyPublic, normalizeProxy, proxyLabel } = require('./proxy');
const {
  fetchSubMeta, deriveHomeUrl, cleanFeedTitle, parseMikanHome, parseEpisodePage, homeUrlFor, rssUrlFor,
} = require('./meta');

const MAX_PREVIEW_ITEMS = 150;
const MAX_DOWNLOADS = 1500;
const MAX_LOGS = 300;

function sortByNewest(list) {
  return list.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

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

class Engine {
  constructor(store) {
    this.store = store;
    this.data = store.data;
    this.cache = new Map();
    this.checking = new Set();
    this.queue = [];
    this.maxConcurrent = 2;
    this.startedAt = nowMs();
    this.qbClient = null;
    this.qbClientKey = '';
    this.qbStatusCache = { at: 0, data: null };
    // 封面/远程图片按字节预算淘汰（单图上限 8MB，按条数淘汰最坏能吃掉数百 MB 内存）
    this.coverCache = new ByteLruCache(64 * 1024 * 1024, 200);
    this.resolveCache = new Map();
    this.searchCache = new Map();
    this.episodeCache = new Map();
    this.homeMetaCache = new Map();
    this.subgroupCache = new Map();
    this.imageCache = new ByteLruCache(64 * 1024 * 1024, 240);
    this.timer = null;
    this.ticking = false;
    this.hardlinkBusy = new Set();
    this.hardlinkTicking = false;
    setProxy(this.data.proxy);
    this.log('info', `AniRSS 追番台 ${APP_VERSION} 已启动`);
    this.sweepStaleDownloads();
    this.store.save();
  }

  sweepStaleDownloads() {
    const cutoff = nowMs() - 15 * 60000;
    let count = 0;
    for (const d of this.data.downloads) {
      if (d.status === 'pending' && Number(d.updatedAt || d.createdAt || 0) < cutoff) {
        d.status = 'failed';
        d.error = '提交状态未知（应用可能中断），可手动重试';
        d.updatedAt = nowMs();
        count++;
      }
    }
    if (count) this.log('info', `已将 ${count} 条超时的提交记录标记为失败`);
  }

  log(level, message) {
    const entry = { at: nowMs(), level, msg: truncate(message, 600) };
    this.data.logs.unshift(entry);
    if (this.data.logs.length > MAX_LOGS) this.data.logs.length = MAX_LOGS;
    this.store.bump(); // 日志进 /api/state，rev 要动一下让 ETag 失效
    const fn = level === 'error' ? console.error : console.log;
    fn(`[${level}] ${entry.msg}`);
  }

  // ---------- qBittorrent ----------

  qb() {
    const cfg = this.data.qb;
    const key = [cfg.baseUrl, cfg.username, cfg.password, cfg.skipTlsVerify ? 1 : 0].join('|');
    if (!this.qbClient || key !== this.qbClientKey) {
      this.qbClient = new QBClient(cfg);
      this.qbClientKey = key;
      this.qbStatusCache = { at: 0, data: null };
    }
    return this.qbClient;
  }

  resetQb() {
    this.qbClient = null;
    this.qbClientKey = '';
    this.qbStatusCache = { at: 0, data: null };
  }

  publicQb() {
    const qb = this.data.qb;
    return {
      baseUrl: qb.baseUrl,
      username: qb.username,
      hasPassword: !!qb.password,
      skipTlsVerify: !!qb.skipTlsVerify,
      verifiedAt: qb.verifiedAt || 0,
      lastTest: qb.lastTest || null,
    };
  }

  publicProxyConfig() {
    return proxyPublic(this.data.proxy);
  }

  saveProxy(input) {
    const src = Object.assign({}, input || {});
    if (src.clearPassword) src.password = '';
    else if (src.password === undefined || src.password === '') src.password = this.data.proxy.password;
    const next = normalizeProxy(src, this.data.proxy);
    const changed = JSON.stringify(next) !== JSON.stringify(this.data.proxy);
    this.data.proxy = next;
    setProxy(next);
    if (changed) {
      this.coverCache.clear();
      this.store.save();
      this.log('info', `网络代理设置已保存：${next.enabled && next.host ? proxyLabel(next) : '未启用'}`);
    }
    return this.publicProxyConfig();
  }

  async testProxy(input) {
    const src = input || {};
    const testUrl = String(src.url || 'https://mikanime.tv/');
    const rawProxy = Object.assign({}, src.proxy !== undefined ? src.proxy : src);
    if (rawProxy.password === undefined || rawProxy.password === '') rawProxy.password = this.data.proxy.password;
    const target = normalizeProxy(rawProxy, this.data.proxy);
    const startedAt = nowMs();
    try {
      const res = await fetchBuffer(testUrl, {
        timeout: 20000,
        maxBytes: 1024 * 1024,
        proxy: target,
      });
      return {
        ok: true,
        at: nowMs(),
        url: testUrl,
        finalUrl: res.url || testUrl,
        status: res.status,
        bytes: res.buffer.length,
        durationMs: nowMs() - startedAt,
        proxy: proxyPublic(target),
        error: '',
      };
    } catch (e) {
      return {
        ok: false,
        at: nowMs(),
        url: testUrl,
        status: 0,
        bytes: 0,
        durationMs: nowMs() - startedAt,
        proxy: proxyPublic(target),
        error: e.message,
      };
    }
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

  publicMeta(sub) {
    const m = sub.meta || {};
    return {
      homeUrl: m.homeUrl || '',
      cover: m.cover || '',
      hasCover: !!m.cover,
      title: m.title || '',
      bgmUrl: m.bgmUrl || '',
      bgmId: m.bgmId || '',
      airWeekday: m.airWeekday || '',
      episodes: m.episodes || '',
      startDate: m.startDate || '',
      officialSite: m.officialSite || '',
      fetchedAt: Number(m.fetchedAt) || 0,
      error: m.error || '',
    };
  }

  async refreshSubMeta(id, opts) {
    const sub = this.findSub(id);
    const options = opts || {};
    if (!sub.meta || typeof sub.meta !== 'object') sub.meta = {};
    const homeUrl = deriveHomeUrl(sub.url);
    if (!homeUrl) {
      sub.meta.error = '无法从追番地址推导番组主页（需要包含 bangumiId）';
      sub.meta.fetchedAt = nowMs();
      this.store.scheduleSave();
      if (options.throwOnError) throw httpError(400, sub.meta.error, 'NO_HOME_URL');
      return this.publicSub(sub);
    }
    try {
      const meta = await fetchSubMeta(sub.url, { proxy: this.data.proxy });
      const keep = {};
      for (const key of ['homeUrl', 'cover', 'title', 'bgmUrl', 'bgmId', 'airWeekday', 'episodes', 'startDate', 'officialSite', 'fetchedAt']) {
        if (meta && meta[key] !== undefined) keep[key] = meta[key];
      }
      sub.meta = { ...sub.meta, ...keep, error: '' };
      sub.meta.homeUrl = sub.meta.homeUrl || homeUrl;
      sub.updatedAt = nowMs();
      this.store.scheduleSave();
      this.log('info', `已更新「${sub.name}」番组信息${meta && meta.title ? `：${meta.title}` : ''}${meta && meta.bgmUrl ? '（含 Bangumi 链接）' : ''}`);
      return this.publicSub(sub);
    } catch (e) {
      sub.meta.error = e.message;
      sub.meta.fetchedAt = nowMs();
      sub.updatedAt = nowMs();
      this.store.scheduleSave();
      this.log('error', `更新「${sub.name}」番组信息失败：${e.message}`);
      if (options.throwOnError) throw e;
      return this.publicSub(sub);
    }
  }

  async getCover(id) {
    const sub = this.findSub(id);
    if (!sub.meta || !sub.meta.cover) {
      await this.refreshSubMeta(sub.id, { throwOnError: true });
    }
    const coverUrl = sub.meta && sub.meta.cover;
    if (!coverUrl) throw httpError(404, '该追番没有可用封面', 'NO_COVER');
    const cacheKey = `${sub.id}|${coverUrl}`;
    const cached = this.coverCache.get(cacheKey);
    if (cached && nowMs() - cached.at < 6 * 3600000) return cached;
    const headers = { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*' };
    if (sub.meta.homeUrl) headers.Referer = sub.meta.homeUrl;
    const res = await fetchBuffer(coverUrl, {
      timeout: 20000,
      maxBytes: 8 * 1024 * 1024,
      headers,
    });
    const contentType = String(res.contentType || '').split(';')[0].trim() || 'image/jpeg';
    if (!/^image\//i.test(contentType)) {
      throw httpError(502, `封面返回的不是图片（${contentType || '未知类型'}）`, 'BAD_COVER');
    }
    const item = { at: nowMs(), buffer: res.buffer, contentType };
    this.coverCache.set(cacheKey, item, item.buffer.length);
    return item;
  }

  async testQb(input) {    const src = input || {};
    const stored = this.data.qb;
    const baseUrl = src.baseUrl !== undefined ? src.baseUrl : stored.baseUrl;
    const username = src.username !== undefined ? src.username : stored.username;
    let password = src.password;
    if (password === undefined || password === '') {
      password = src.useSavedPassword === false ? '' : stored.password;
    }
    const skipTlsVerify = src.skipTlsVerify !== undefined ? !!src.skipTlsVerify : !!stored.skipTlsVerify;
    const cfg = { baseUrl, username, password, skipTlsVerify };
    try {
      const result = await new QBClient(cfg).test();
      const same = normalizeBaseUrl(baseUrl) === stored.baseUrl &&
        String(username) === stored.username &&
        String(password) === stored.password &&
        !!skipTlsVerify === !!stored.skipTlsVerify;
      if (same) stored.verifiedAt = nowMs();
      stored.lastTest = {
        at: nowMs(),
        ok: true,
        baseUrl: cfg.baseUrl,
        version: result.version,
        webapi: result.webapi,
        defaultSavePath: result.defaultSavePath,
        error: '',
      };
      this.resetQb();
      this.store.save();
      this.log('info', `qBittorrent 连接成功：${result.version}`);
      return { ok: true, ...result, baseUrl: cfg.baseUrl };
    } catch (e) {
      stored.lastTest = {
        at: nowMs(),
        ok: false,
        baseUrl: cfg.baseUrl,
        version: '',
        webapi: '',
        error: e.message,
      };
      this.store.save();
      this.log('error', `qBittorrent 连接测试失败：${e.message}`);
      throw e;
    }
  }

  saveQb(input) {
    const src = input || {};
    const qb = this.data.qb;
    const nextBase = normalizeBaseUrl(src.baseUrl !== undefined ? src.baseUrl : qb.baseUrl);
    const nextUser = String(src.username !== undefined ? src.username : qb.username).slice(0, 120);
    let nextPass = qb.password;
    if (src.clearPassword) nextPass = '';
    else if (src.password !== undefined && src.password !== '') nextPass = String(src.password).slice(0, 500);
    const nextSkip = src.skipTlsVerify !== undefined ? !!src.skipTlsVerify : !!qb.skipTlsVerify;

    const changed = nextBase !== qb.baseUrl || nextUser !== qb.username ||
      nextPass !== qb.password || nextSkip !== qb.skipTlsVerify;
    qb.baseUrl = nextBase;
    qb.username = nextUser;
    qb.password = nextPass;
    qb.skipTlsVerify = nextSkip;
    if (changed) {
      qb.verifiedAt = 0;
      qb.lastTest = null;
    }
    this.resetQb();
    this.store.save();
    this.log('info', `qBittorrent 连接设置已保存：${nextBase || '(未设置)'}`);
    return this.publicQb();
  }

  async qbStatus(force) {
    if (!this.data.qb.baseUrl) {
      return { ok: false, error: '尚未配置 qBittorrent 地址', at: nowMs() };
    }
    const now = nowMs();
    if (!force && this.qbStatusCache.data && now - this.qbStatusCache.at < 5000) {
      return this.qbStatusCache.data;
    }
    try {
      const data = await this.qb().status();
      const result = { ok: true, at: now, ...data };
      this.qbStatusCache = { at: now, data: result };
      return result;
    } catch (e) {
      const result = { ok: false, error: e.message, at: now };
      this.qbStatusCache = { at: now, data: result };
      return result;
    }
  }

  // ---------- URL / 校验 ----------

  resolveUrl(input) {
    const src = input || {};
    const baseId = src.baseId == null ? '' : String(src.baseId);
    const pathPart = src.path == null ? '' : String(src.path).trim();
    const rawUrl = src.url == null ? '' : String(src.url).trim();

    if (baseId) {
      const base = this.data.bases.find((b) => b.id === baseId);
      if (!base) throw badRequest('选择的站点基础地址不存在，请重新选择', 'BASE_NOT_FOUND');
      if (!pathPart) throw badRequest('请填写追番路径（基础地址后面的部分）', 'EMPTY_PATH');
      if (/^https?:\/\//i.test(pathPart)) return { url: validateFeedUrl(pathPart), baseId: '', path: '', full: true };
      return { url: validateFeedUrl(composeUrl(base.url, pathPart)), baseId, path: pathPart, full: false };
    }

    const candidate = rawUrl || pathPart;
    if (!candidate) throw badRequest('请选择站点并填写路径，或直接填写完整 RSS 地址', 'EMPTY_URL');
    return { url: validateFeedUrl(candidate), baseId: '', path: '', full: true };
  }

  normalizeSubInput(input, existing) {
    const src = input || {};
    const old = existing || {};
    const name = String(src.name !== undefined ? src.name : old.name || '').trim();
    if (!name) throw badRequest('请填写追番名称', 'EMPTY_NAME');
    if (name.length > 80) throw badRequest('追番名称不能超过 80 个字符', 'NAME_TOO_LONG');

    const hasBaseField = src.baseId !== undefined || src.path !== undefined || src.url !== undefined;
    let baseId = src.baseId !== undefined ? String(src.baseId || '') : String(old.baseId || '');
    let pathPart = src.path !== undefined ? String(src.path || '').trim() : String(old.path || '');
    let url;
    if (hasBaseField) {
      if (baseId && pathPart && /^https?:\/\//i.test(pathPart)) {
        url = validateFeedUrl(pathPart);
        baseId = '';
        pathPart = '';
      } else if (baseId) {
        const base = this.data.bases.find((b) => b.id === baseId);
        if (!base) throw badRequest('选择的站点基础地址不存在，请重新选择', 'BASE_NOT_FOUND');
        if (!pathPart) throw badRequest('请填写追番路径（基础地址后面的部分）', 'EMPTY_PATH');
        url = validateFeedUrl(composeUrl(base.url, pathPart));
      } else {
        const candidate = String(src.url !== undefined ? src.url : pathPart || '').trim();
        if (!candidate) throw badRequest('请填写完整 RSS 地址，或选择站点后填写路径', 'EMPTY_URL');
        url = validateFeedUrl(candidate);
        pathPart = '';
      }
    } else {
      url = validateFeedUrl(old.url);
    }

    const include = String(src.include !== undefined ? src.include : old.include || '').slice(0, 8000);
    const exclude = String(src.exclude !== undefined ? src.exclude : old.exclude || '').slice(0, 8000);
    const ignoreCase = src.ignoreCase !== undefined ? !!src.ignoreCase : old.ignoreCase !== false;
    compileFilters(include, exclude, ignoreCase);

    const savePath = String(src.savePath !== undefined ? src.savePath : old.savePath || '').trim().slice(0, 800);
    const category = String(src.category !== undefined ? src.category : old.category || '').trim().slice(0, 120);
    const tags = String(src.tags !== undefined ? src.tags : old.tags || '').trim().slice(0, 200);
    const intervalMin = clampNumber(
      src.intervalMin !== undefined ? src.intervalMin : old.intervalMin,
      1, 1440, 10
    );
    const maxPerCheck = clampNumber(
      src.maxPerCheck !== undefined ? src.maxPerCheck : old.maxPerCheck,
      1, 50, 5
    );
    const enabled = src.enabled !== undefined ? parseBool(src.enabled, true) : old.enabled !== false;

    return {
      name,
      baseId,
      path: pathPart,
      url,
      include,
      exclude,
      ignoreCase,
      savePath,
      category,
      tags,
      intervalMin,
      maxPerCheck,
      enabled,
    };
  }

  // ---------- 追番 ----------

  publicSub(sub) {
    const now = nowMs();
    return {
      id: sub.id,
      name: sub.name,
      url: sub.url,
      baseId: sub.baseId || '',
      path: sub.path || '',
      include: sub.include || '',
      exclude: sub.exclude || '',
      ignoreCase: sub.ignoreCase !== false,
      savePath: sub.savePath || '',
      category: sub.category || '',
      tags: sub.tags || '',
      intervalMin: Number(sub.intervalMin) || 10,
      maxPerCheck: Number(sub.maxPerCheck) || 5,
      enabled: sub.enabled !== false,
      createdAt: sub.createdAt || 0,
      updatedAt: sub.updatedAt || 0,
      lastCheck: sub.lastCheck || null,
      lastRunAt: sub.lastRunAt || 0,
      nextCheckAt: this.nextCheckAt(sub),
      seenCount: Object.keys(sub.seen || {}).length,
      checking: this.checking.has(sub.id),
      queued: this.queue.some((job) => job.sub && job.sub.id === sub.id),
      needsSeed: !!sub.needsSeed,
      totalDownloads: sub.totalDownloads || 0,
      lastDownloadAt: sub.lastDownloadAt || 0,
      meta: this.publicMeta(sub),
      now,
    };
  }

  nextCheckAt(sub) {
    if (sub.enabled === false) return 0;
    const last = (sub.lastCheck && sub.lastCheck.at) || sub.lastRunAt || sub.createdAt || nowMs();
    return last + (Number(sub.intervalMin) || 10) * 60000;
  }

  findSub(id) {
    const sub = this.data.subs.find((s) => s.id === id);
    if (!sub) throw httpError(404, '追番不存在', 'SUB_NOT_FOUND');
    return sub;
  }

  candidateSubUrl(input) {
    const src = input || {};
    const direct = String(src.url || '').trim();
    if (direct && isHttpUrl(direct)) return direct;
    const baseId = String(src.baseId || '');
    const pathPart = String(src.path || '').trim();
    if (baseId && pathPart) {
      const base = this.data.bases.find((b) => b.id === baseId);
      if (base) {
        try { return composeUrl(base.url, pathPart); } catch { /* ignore */ }
      }
    }
    return '';
  }

  /** 从追番地址解析名称：优先 Mikan 番组标题，其次清理后的 RSS 标题 */
  async resolveName(input) {
    const url = typeof input === 'string' ? input : this.candidateSubUrl(input);
    const feedUrl = validateFeedUrl(url);
    const cached = this.resolveCache.get(feedUrl);
    if (cached && nowMs() - cached.at < 10 * 60000) return cached.data;

    let feedTitle = '';
    let meta = null;
    let warning = '';
    const home = deriveHomeUrl(feedUrl);
    const [feedRes, metaRes] = await Promise.allSettled([
      fetchFeed(feedUrl, { timeout: 15000, proxy: this.data.proxy }),
      home ? fetchSubMeta(feedUrl, { timeout: 20000, proxy: this.data.proxy }) : Promise.resolve(null),
    ]);
    if (feedRes.status === 'fulfilled') feedTitle = feedRes.value.title || '';
    else warning = feedRes.reason && feedRes.reason.message ? feedRes.reason.message : 'RSS 拉取失败';
    if (metaRes.status === 'fulfilled' && metaRes.value) meta = metaRes.value;
    else if (metaRes.status === 'rejected') warning = warning ? `${warning}；番组信息获取失败` : '番组信息获取失败';

    const name = (meta && meta.title ? meta.title : '') || cleanFeedTitle(feedTitle);
    if (!name) {
      throw httpError(502, `无法从追番地址获取名称（${truncate(feedUrl, 90)}）：${warning || '没有可用标题'}`, 'RESOLVE_FAILED');
    }
    const data = { url: feedUrl, name: truncate(name, 80), feedTitle, meta };
    this.resolveCache.set(feedUrl, { at: nowMs(), data });
    if (this.resolveCache.size > 100) {
      const first = this.resolveCache.keys().next().value;
      this.resolveCache.delete(first);
    }
    return data;
  }

  async createSub(input) {
    const src = Object.assign({}, input || {});
    if (!String(src.name || '').trim()) {
      try {
        const resolved = await this.resolveName(src);
        src.name = resolved.name;
      } catch { /* 交给 normalizeSubInput 报“请填写追番名称” */ }
    }
    const norm = this.normalizeSubInput(src, null);
    const ts = nowMs();
    const sub = {
      id: uid('s_'),
      ...norm,
      seen: {},
      needsSeed: !parseBool(src.downloadExisting, false),
      totalDownloads: 0,
      lastDownloadAt: 0,
      lastCheck: null,
      lastRunAt: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    this.data.subs.unshift(sub);
    this.store.save();
    this.log('info', `新增追番「${sub.name}」：${sub.url}`);
    let result = null;
    let warning = '';
    try {
      result = await this.checkSub(sub, {
        download: !!parseBool(src.downloadExisting, false),
        seedOnly: sub.needsSeed,
        reason: 'create',
      });
    } catch (e) {
      warning = e.message;
      if (!sub.lastCheck) {
        sub.lastCheck = { at: nowMs(), ok: false, error: e.message, newCount: 0, downloaded: 0, failed: 0 };
        sub.lastRunAt = nowMs();
      }
      this.store.save();
    }
    if (parseBool(src.fetchMeta, true)) {
      try {
        await this.refreshSubMeta(sub.id);
      } catch (e) {
        warning = warning ? `${warning}；番组信息获取失败：${e.message}` : `番组信息获取失败：${e.message}`;
      }
    }
    return { sub: this.publicSub(sub), check: result, warning };
  }

  updateSub(id, input) {
    const sub = this.findSub(id);
    const norm = this.normalizeSubInput(input, sub);
    const urlChanged = norm.url !== sub.url;
    Object.assign(sub, norm);
    sub.updatedAt = nowMs();
    if (urlChanged) {
      sub.needsSeed = true;
      sub.lastCheck = null;
      sub.meta = {};
      this.cache.delete(sub.id);
      this.log('info', `追番「${sub.name}」地址已变更，下次检查只记录现有条目`);
    }
    if (input && input.resetSeen) {
      sub.seen = {};
      sub.needsSeed = false;
      const cleared = this.clearSubDedupe(sub);
      this.cache.delete(sub.id);
      if (cleared) this.log('info', `追番「${sub.name}」已清空已见，${cleared} 条下载记录不再参与去重`);
    }
    this.store.save();
    if (urlChanged) this.refreshSubMeta(sub.id).catch(() => { /* 失败时保留错误信息 */ });
    return this.publicSub(sub);
  }

  deleteSub(id) {
    const sub = this.findSub(id);
    this.data.subs = this.data.subs.filter((s) => s.id !== id);
    for (const key of Array.from(this.coverCache.keys())) {
      if (key.startsWith(sub.id + '|')) this.coverCache.delete(key);
    }
    this.cache.delete(id);
    this.queue = this.queue.filter((job) => !job.sub || job.sub.id !== id);
    this.store.save();
    this.log('info', `已删除追番「${sub.name}」`);
  }

  resetSub(id, opts) {
    const sub = this.findSub(id);
    const options = opts || {};
    const count = Object.keys(sub.seen || {}).length;
    sub.seen = {};
    sub.needsSeed = false;
    sub.updatedAt = nowMs();
    // 默认同时让历史下载记录退出去重：qB 里删掉任务后，清空已见应该能重新下载
    const cleared = options.allowRedownload === false ? 0 : this.clearSubDedupe(sub);
    this.cache.delete(sub.id);
    this.store.save();
    this.log('info', `已重置追番「${sub.name}」的 ${count} 条历史记录${cleared ? `，${cleared} 条下载记录不再参与去重` : ''}`);
    return { ...this.publicSub(sub), clearedRecords: cleared };
  }

  /** 补下当前 RSS 中已存在的匹配条目（会重置已见与去重，再立即检查下载） */
  async downloadExisting(id) {
    const sub = this.findSub(id);
    if (this.checking.has(sub.id)) {
      throw httpError(409, '该追番正在检查中，请稍候', 'ALREADY_CHECKING');
    }
    this.resetSub(sub.id);
    const result = await this.checkSub(sub, { download: true });
    this.log('info', `补下现有匹配「${sub.name}」：下载 ${result.downloaded}，失败 ${result.failed}`);
    return result;
  }

  toggleSub(id, enabled) {
    const sub = this.findSub(id);
    sub.enabled = !!enabled;
    sub.updatedAt = nowMs();
    this.store.save();
    return this.publicSub(sub);
  }

  // ---------- 预览 ----------

  annotateItems(items, filters, sub, downloadedKeys) {
    return items.map((item) => {
      const m = matchTitle(item.title, filters);
      const guess = guessEpisode(item.title);
      return {
        ...item,
        matched: m.matched,
        reason: m.reason,
        downloadable: !!item.torrentUrl,
        seen: sub ? !!sub.seen[item.key] : false,
        downloaded: downloadedKeys ? downloadedKeys.has(item.key) : false,
        episode: guess ? guess.episode : null,
        episodeLabel: guess ? guess.label : '',
        episodeKind: guess ? guess.kind : '',
      };
    });
  }

  downloadedKeys(subId) {
    const set = new Set();
    for (const d of this.data.downloads) {
      if (d.subId === subId && d.dedupe !== false && (d.status === 'ok' || d.status === 'duplicate')) set.add(d.itemKey);
    }
    return set;
  }

  /** 该追番的历史下载记录不再参与去重（qB 里已经删掉任务时可以这样重新下载） */
  clearSubDedupe(sub) {
    let cleared = 0;
    for (const d of this.data.downloads) {
      if (d.subId === sub.id && d.dedupe !== false) {
        d.dedupe = false;
        cleared++;
      }
    }
    return cleared;
  }

  async previewInput(input) {
    const { url } = this.resolveUrl(input);
    const filters = compileFilters(
      input && input.include,
      input && input.exclude,
      input && input.ignoreCase !== false
    );
    const feed = await fetchFeed(url, { proxy: this.data.proxy });
    const annotated = this.annotateItems(feed.items, filters, null, null);
    const matched = annotated.filter((it) => it.matched).length;
    return {
      url: feed.finalUrl || url,
      feedTitle: feed.title,
      fetchedAt: feed.fetchedAt,
      total: annotated.length,
      matched,
      truncated: annotated.length > MAX_PREVIEW_ITEMS,
      items: annotated.slice(0, MAX_PREVIEW_ITEMS),
    };
  }

  async previewSub(id) {
    const sub = this.findSub(id);
    const filters = compileFilters(sub.include, sub.exclude, sub.ignoreCase);
    const feed = await fetchFeed(sub.url, { proxy: this.data.proxy });
    const annotated = this.annotateItems(feed.items, filters, sub, this.downloadedKeys(sub.id));
    const newCount = annotated.filter((it) => !it.seen).length;
    this.cache.set(sub.id, { at: nowMs(), feedTitle: feed.title, items: annotated });
    return {
      sub: this.publicSub(sub),
      url: feed.finalUrl || sub.url,
      feedTitle: feed.title,
      fetchedAt: feed.fetchedAt,
      total: annotated.length,
      matched: annotated.filter((it) => it.matched).length,
      newCount,
      truncated: annotated.length > MAX_PREVIEW_ITEMS,
      items: annotated.slice(0, MAX_PREVIEW_ITEMS),
    };
  }

  getCachedItems(id) {
    this.findSub(id);
    const cached = this.cache.get(id);
    if (!cached) return { cached: false, at: 0, feedTitle: '', items: [] };
    return {
      cached: true,
      at: cached.at,
      feedTitle: cached.feedTitle,
      items: cached.items.slice(0, MAX_PREVIEW_ITEMS),
      total: cached.items.length,
      truncated: cached.items.length > MAX_PREVIEW_ITEMS,
    };
  }

  // ---------- 检查 / 下载 ----------

  async checkSub(sub, opts) {
    const options = opts || {};
    if (this.checking.has(sub.id)) {
      throw httpError(409, '该追番正在检查中，请稍候', 'ALREADY_CHECKING');
    }
    this.queue = this.queue.filter((job) => !job.sub || job.sub.id !== sub.id);
    this.checking.add(sub.id);
    const startedAt = nowMs();

    try {
      const filters = compileFilters(sub.include, sub.exclude, sub.ignoreCase);
      const feed = await fetchFeed(sub.url, { timeout: 25000, proxy: this.data.proxy });
      const seedOnly = !!options.seedOnly || !!sub.needsSeed;
      const max = clampNumber(sub.maxPerCheck, 1, 50, 5);
      const now = nowMs();

      const newItems = feed.items.filter((item) => !sub.seen[item.key]);
      const annotated = this.annotateItems(feed.items, filters, sub, null);
      const matchedNew = annotated.filter((it) => it.matched && it.downloadable && !it.seen);
      const targets = seedOnly ? [] : matchedNew.slice(0, max);
      const overflowKeys = new Set(matchedNew.slice(max).map((it) => it.key));
      const targetKeys = new Set(targets.map((it) => it.key));

      // 下载前先真实探测 qB 是否可用：不可用就不标记 seen，下一轮自动重试，避免漏掉新番
      if (targets.length) {
        try {
          await this.qb().ping();
        } catch (e) {
          throw httpError(502, `qBittorrent 不可用，本次未标记条目：${e.message}`, 'QB_UNAVAILABLE');
        }
      }

      // 除“本次要下载的”和“超出单次上限的匹配项”外，其余新条目直接记为已见
      for (const item of newItems) {
        if (targetKeys.has(item.key) || overflowKeys.has(item.key)) continue;
        sub.seen[item.key] = now;
      }

      let downloaded = 0;
      let failed = 0;
      for (const item of targets) {
        const record = await this.downloadItem(sub, item);
        sub.seen[item.key] = nowMs();
        if (record && (record.status === 'ok' || record.status === 'duplicate')) downloaded++;
        else failed++;
      }

      if (seedOnly) {
        for (const item of newItems) sub.seen[item.key] = now;
        sub.needsSeed = false;
      }

      sub.lastCheck = {
        at: nowMs(),
        ok: true,
        feedTitle: feed.title,
        total: feed.items.length,
        newCount: newItems.length,
        downloaded,
        failed,
        seedOnly,
        error: '',
        durationMs: nowMs() - startedAt,
      };
      sub.lastRunAt = sub.lastCheck.at;
      sub.updatedAt = nowMs();
      this.store.pruneSeen(sub);

      const downloadedSet = this.downloadedKeys(sub.id);
      const finalItems = annotated.map((it) => ({
        ...it,
        seen: !!sub.seen[it.key],
        downloaded: downloadedSet.has(it.key),
      }));
      this.cache.set(sub.id, { at: nowMs(), feedTitle: feed.title, items: finalItems });
      this.store.scheduleSave();

      // 番组封面/元数据缺失或超过 7 天时后台刷新，不阻塞本次检查
      if (!sub.meta || !sub.meta.cover || nowMs() - (Number(sub.meta.fetchedAt) || 0) > 7 * 86400000) {
        this.refreshSubMeta(sub.id).catch(() => { /* 已写入 meta.error */ });
      }

      if (seedOnly) {
        this.log('info', `「${sub.name}」已记录 ${newItems.length} 条现有条目（不下载），之后只处理新增`);
      } else {
        this.log('info', `「${sub.name}」检查完成：共 ${feed.items.length} 条，新增 ${newItems.length}，下载 ${downloaded}${failed ? `，失败 ${failed}` : ''}`);
      }

      return {
        subId: sub.id,
        feedTitle: feed.title,
        at: sub.lastCheck.at,
        total: feed.items.length,
        newCount: newItems.length,
        matchedCount: annotated.filter((it) => it.matched && it.downloadable).length,
        downloaded,
        failed,
        seedOnly,
        durationMs: sub.lastCheck.durationMs,
        truncated: finalItems.length > MAX_PREVIEW_ITEMS,
        items: finalItems.slice(0, MAX_PREVIEW_ITEMS),
      };
    } catch (e) {
      sub.lastCheck = {
        at: nowMs(),
        ok: false,
        feedTitle: '',
        newCount: 0,
        downloaded: 0,
        failed: 0,
        error: e.message,
        durationMs: nowMs() - startedAt,
      };
      sub.lastRunAt = sub.lastCheck.at;
      this.store.scheduleSave();
      this.log('error', `「${sub.name}」检查失败：${e.message}`);
      throw e;
    } finally {
      this.checking.delete(sub.id);
      this.pump();
    }
  }

  duplicateError(hash) {
    return httpError(
      409,
      `qBittorrent 中已存在相同种子（infohash ${String(hash).slice(0, 12)}…），已跳过`,
      'QB_DUPLICATE'
    );
  }

  downloadErrorMessage(err, target) {
    let msg = err && err.message ? err.message : '下载失败';
    const parts = [];
    if (target && target.savePath) parts.push(`保存路径「${target.savePath}」`);
    if (target && target.category) parts.push(`分类「${target.category}」`);
    if (err && err.code === 'QB_REJECTED') {
      msg += ' 应用已先检查过同种子，仍被拒绝时通常是保存路径或分类不可用；';
      if (parts.length) msg += `请确认 ${parts.join('、')} 在 qBittorrent 侧存在且可写。`;
      else msg += '请确认 qBittorrent 的默认保存路径存在且可写。';
      msg += ' 若 qBittorrent 是 Docker 版，请填容器内路径，而不是 NAS 宿主机路径。';
    }
    return truncate(msg, 1000);
  }

  async submitTorrent(target) {
    const qb = this.qb();
    const common = {
      savePath: target.savePath || '',
      category: target.category || '',
      tags: target.tags || '',
    };
    const torrentUrl = String(target.torrentUrl || '');
    if (!torrentUrl) throw badRequest('条目没有下载地址', 'EMPTY_TORRENT_URL');
    if (!isMagnet(torrentUrl) && !isHttpUrl(torrentUrl)) {
      throw badRequest('条目的下载地址不是有效的 http/https 或磁力链接', 'BAD_TORRENT_URL');
    }

    if (isMagnet(torrentUrl)) {
      const hash = magnetInfoHash(torrentUrl);
      if (hash && await qb.hasTorrent(hash)) throw this.duplicateError(hash);
      await qb.addTorrent({ urls: torrentUrl, ...common });
      return 'magnet';
    }

    let buffer = null;
    let fetchError = null;
    try {
      let referer = '';
      try { referer = new URL(torrentUrl).origin + '/'; } catch { /* ignore */ }
      const res = await fetchBuffer(torrentUrl, {
        timeout: 30000,
        maxBytes: 12 * 1024 * 1024,
        proxy: this.data.proxy,
        headers: {
          'Accept': 'application/x-bittorrent, application/octet-stream, */*',
          ...(referer ? { 'Referer': referer } : {}),
        },
      });
      if (!res.buffer.length) throw new Error('种子文件为空');
      if (isHtmlResponse(res) || looksLikeHtml(res.buffer)) throw new Error('返回的是网页而不是 .torrent 文件');
      buffer = res.buffer;
    } catch (e) {
      fetchError = e;
    }

    if (buffer) {
      // 先校验种子内容，避免把 Cloudflare 页面/半截文件当 .torrent 发给 qB，只得到 Fails.
      const info = parseTorrentInfo(buffer);
      if (!info) {
        this.log('warn', `下载到的种子文件无法解析（${buffer.length} 字节），改为交给 qBittorrent 直接抓取`);
        try {
          await qb.addTorrent({ urls: torrentUrl, ...common });
          return 'url';
        } catch (e2) {
          throw httpError(
            502,
            `下载到的种子文件无效（${buffer.length} 字节），交给 qBittorrent 直接抓取也失败：${e2.message}`,
            'DOWNLOAD_FAILED'
          );
        }
      }

      this.log('info', `种子解析成功：${buffer.length} 字节，infohash ${info.hash.slice(0, 12)}…`);
      if (await qb.hasTorrent(info.hash)) throw this.duplicateError(info.hash);

      try {
        await qb.addTorrent({
          buffer,
          filename: filenameFromUrl(torrentUrl, 'download.torrent'),
          ...common,
        });
        return 'file';
      } catch (e) {
        if (e.code !== 'QB_REJECTED') throw e;
        if (e.debug) this.log('error', `qB add 调试：${JSON.stringify(e.debug)}`);

        // 旧 SID 可能让 qB 把上传当成异常会话来处理；用同一账号重新登录后重试一次
        if (e.debug && e.debug.hasCookie) {
          try {
            qb.cookie = '';
            qb.loggedIn = false;
            await qb.login();
            this.log('warn', 'qB 文件上传被拒，重新登录后重试一次');
            await qb.addTorrent({
              buffer,
              filename: filenameFromUrl(torrentUrl, 'download.torrent'),
              ...common,
            });
            return 'file';
          } catch (eRetry) {
            if (eRetry.code !== 'QB_REJECTED') throw eRetry;
            e = eRetry;
          }
        }

        this.log('warn', `qB 拒绝 .torrent（${buffer.length} 字节），改用 URL 交给 qBittorrent 重试`);
        try {
          await qb.addTorrent({ urls: torrentUrl, ...common });
          return 'url';
        } catch (e2) {
          throw httpError(
            502,
            `${e.message}；改用 URL 交给 qBittorrent 也失败：${e2.message}`,
            'QB_REJECTED'
          );
        }
      }
    }

    try {
      await qb.addTorrent({ urls: torrentUrl, ...common });
      return 'url';
    } catch (e2) {
      throw httpError(
        502,
        `获取种子失败：${fetchError ? fetchError.message : '未知错误'}；交由 qBittorrent 直接下载也失败：${e2.message}`,
        'DOWNLOAD_FAILED'
      );
    }
  }

  async downloadItem(sub, item, opts) {
    const options = opts || {};
    if (!item || !item.torrentUrl) {
      return { status: 'failed', error: '该条目没有种子链接' };
    }
    const existing = options.force ? null : this.data.downloads.find(
      (d) => d.torrentUrl === item.torrentUrl &&
        d.dedupe !== false &&
        (d.status === 'ok' || (d.status === 'pending' && nowMs() - Number(d.createdAt || 0) < 10 * 60000))
    );
    if (existing) {
      return { status: 'duplicate', error: '相同地址已提交过，已跳过' };
    }

    const ts = nowMs();
    const record = {
      id: uid('d_'),
      subId: sub.id,
      subName: sub.name,
      itemKey: item.key,
      title: item.title,
      torrentUrl: item.torrentUrl,
      savePath: sub.savePath || '',
      category: sub.category || '',
      tags: sub.tags || '',
      mode: '',
      status: 'pending',
      error: '',
      dedupe: true,
      force: !!options.force,
      createdAt: ts,
      updatedAt: ts,
    };
    this.data.downloads.unshift(record);
    if (this.data.downloads.length > MAX_DOWNLOADS) this.data.downloads.length = MAX_DOWNLOADS;
    this.store.scheduleSave();

    try {
      const mode = await this.submitTorrent({
        torrentUrl: item.torrentUrl,
        savePath: sub.savePath,
        category: sub.category,
        tags: sub.tags,
      });
      record.status = 'ok';
      record.mode = mode;
      record.error = '';
      record.updatedAt = nowMs();
      sub.totalDownloads = (sub.totalDownloads || 0) + 1;
      sub.lastDownloadAt = record.updatedAt;
      this.log('info', `已提交下载「${item.title}」（${mode}）`);
      this.store.scheduleSave();
      return record;
    } catch (e) {
      if (e.code === 'QB_DUPLICATE') {
        record.status = 'duplicate';
        record.mode = isMagnet(item.torrentUrl) ? 'magnet' : 'file';
        record.error = e.message;
        record.updatedAt = nowMs();
        this.log('info', `跳过重复种子「${item.title}」：${e.message}`);
        this.store.scheduleSave();
        return record;
      }
      record.status = 'failed';
      record.error = this.downloadErrorMessage(e, sub);
      record.updatedAt = nowMs();
      this.log('error', `下载失败「${item.title}」：${record.error}`);
      this.store.scheduleSave();
      return record;
    }
  }

  async downloadFromSub(subId, key, opts) {
    const sub = this.findSub(subId);
    if (!key) throw badRequest('缺少条目 key', 'EMPTY_KEY');
    let cached = this.cache.get(subId);
    let item = cached ? cached.items.find((it) => it.key === key) : null;
    if (!item) {
      const filters = compileFilters(sub.include, sub.exclude, sub.ignoreCase);
      const feed = await fetchFeed(sub.url, { proxy: this.data.proxy });
      const annotated = this.annotateItems(feed.items, filters, sub, this.downloadedKeys(sub.id));
      this.cache.set(sub.id, { at: nowMs(), feedTitle: feed.title, items: annotated });
      item = annotated.find((it) => it.key === key);
    }
    if (!item) throw httpError(404, '追番中找不到该条目，请重新预览', 'ITEM_NOT_FOUND');
    if (!item.torrentUrl) throw badRequest('该条目没有种子链接，无法下载', 'NO_TORRENT');

    sub.seen[item.key] = nowMs();
    const record = await this.downloadItem(sub, item, { force: !!(opts && opts.force) });
    item.seen = true;
    item.downloaded = record.status === 'ok' || record.status === 'duplicate';
    this.store.scheduleSave();
    return record;
  }

  /** 某条下载记录不再参与去重（qB 里删掉任务后可重新下载） */
  allowRedownload(recordId) {
    const record = this.data.downloads.find((d) => d.id === recordId);
    if (!record) throw httpError(404, '下载记录不存在', 'DOWNLOAD_NOT_FOUND');
    record.dedupe = false;
    record.updatedAt = nowMs();
    const sub = this.data.subs.find((s) => s.id === record.subId);
    if (sub && record.itemKey) delete sub.seen[record.itemKey];
    this.store.save();
    this.log('info', `已允许重新下载「${truncate(record.title, 60)}」`);
    return { ok: true, record };
  }

  async retryDownload(id) {
    const record = this.data.downloads.find((d) => d.id === id);
    if (!record) throw httpError(404, '下载记录不存在', 'DOWNLOAD_NOT_FOUND');
    if (record.status === 'pending') throw httpError(409, '该记录正在提交中', 'ALREADY_PENDING');
    const duplicate = this.data.downloads.find(
      (d) => d.id !== record.id && d.torrentUrl === record.torrentUrl && d.status === 'ok' && d.dedupe !== false
    );
    if (duplicate) {
      throw httpError(409, '相同地址已有一条成功记录，无需重试', 'DUPLICATE');
    }
    record.status = 'pending';
    record.error = '';
    record.updatedAt = nowMs();
    this.store.scheduleSave();
    try {
      const mode = await this.submitTorrent({
        torrentUrl: record.torrentUrl,
        savePath: record.savePath,
        category: record.category,
        tags: record.tags,
      });
      record.status = 'ok';
      record.mode = mode;
      record.updatedAt = nowMs();
      const sub = this.data.subs.find((s) => s.id === record.subId);
      if (sub) {
        sub.totalDownloads = (sub.totalDownloads || 0) + 1;
        sub.lastDownloadAt = record.updatedAt;
      }
      this.log('info', `重试成功「${record.title}」`);
      this.store.scheduleSave();
      return record;
    } catch (e) {
      if (e.code === 'QB_DUPLICATE') {
        record.status = 'duplicate';
        record.error = e.message;
        record.updatedAt = nowMs();
        this.log('info', `跳过重复种子「${record.title}」：${e.message}`);
        this.store.scheduleSave();
        return record;
      }
      record.status = 'failed';
      record.error = this.downloadErrorMessage(e, record);
      record.updatedAt = nowMs();
      this.log('error', `重试失败「${record.title}」：${record.error}`);
      this.store.scheduleSave();
      return record;
    }
  }

  clearDownloads() {
    const count = this.data.downloads.length;
    this.data.downloads = [];
    this.store.save();
    this.log('info', `已清空 ${count} 条下载记录（追番去重记录不受影响）`);
    return { cleared: count };
  }

  // ---------- 调度 ----------

  isDue(sub) {
    return sub.enabled !== false && nowMs() >= this.nextCheckAt(sub);
  }

  enqueue(sub, opts) {
    if (!sub || this.checking.has(sub.id)) return false;
    if (this.queue.some((job) => job.sub && job.sub.id === sub.id)) return false;
    this.queue.push({ sub, opts: opts || {} });
    this.pump();
    return true;
  }

  pump() {
    while (this.checking.size < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      if (!job || !job.sub || this.checking.has(job.sub.id)) continue;
      this.checkSub(job.sub, job.opts).catch(() => { /* 已在 lastCheck 中记录 */ });
    }
  }

  checkAll() {
    const enabled = this.data.subs.filter((s) => s.enabled !== false);
    let started = 0;
    for (const sub of enabled) {
      if (this.enqueue(sub, { download: true })) started++;
    }
    return { started, total: enabled.length, queued: this.queue.length, checking: this.checking.size };
  }

  tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.data.qb.baseUrl) return;
      const due = this.data.subs
        .filter((sub) => this.isDue(sub) && !this.checking.has(sub.id))
        .sort((a, b) => this.nextCheckAt(a) - this.nextCheckAt(b))
        .slice(0, 3);
      for (const sub of due) this.enqueue(sub, { download: true });
    } finally {
      this.ticking = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.tick(); } catch (e) { this.log('error', '调度器异常：' + e.message); }
    }, 15000);
    // 补番硬链接巡检：只扫等着链接的记录，下载完成后自动执行
    this.hardlinkTimer = setInterval(() => {
      try { this.hardlinkTick(); } catch { /* ignore */ }
    }, 30000);
    setTimeout(() => {
      try { this.tick(); } catch { /* ignore */ }
    }, 5000);
    setTimeout(() => {
      try { this.hardlinkTick(); } catch { /* ignore */ }
    }, 8000);
    this.log('info', '自动检查调度器已启动（每 15 秒扫描一次到期追番，每 30 秒巡检补番硬链接）');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.hardlinkTimer) clearInterval(this.hardlinkTimer);
    this.timer = null;
    this.hardlinkTimer = null;
  }

  // ---------- 状态 / 统计 ----------

  stats() {
    const today = todayStart();
    const downloads = this.data.downloads;
    const okDownloads = downloads.filter((d) => d.status === 'ok');
    return {
      subs: this.data.subs.length,
      enabled: this.data.subs.filter((s) => s.enabled !== false).length,
      due: this.data.subs.filter((s) => this.isDue(s)).length,
      downloadsToday: okDownloads.filter((d) => Number(d.createdAt) >= today).length,
      downloadsTotal: okDownloads.length,
      failed: downloads.filter((d) => d.status === 'failed').length,
      pending: downloads.filter((d) => d.status === 'pending').length,
      checking: this.checking.size,
      queued: this.queue.length,
      bases: this.data.bases.length,
      paths: this.data.paths.length,
    };
  }

  /* ============================================================
   * 站点搜索 / 补番
   * ============================================================ */

  pickSearchBase(baseId) {
    const id = String(baseId || '');
    let base = null;
    if (id) base = this.data.bases.find((b) => b.id === id) || null;
    else base = this.data.bases.find((b) => /mikan/i.test(b.url)) || this.data.bases[0] || null;
    if (!base) throw badRequest('请先在「站点与路径」添加站点基础地址', 'NO_BASE');
    let host = '';
    try { host = new URL(base.url).hostname.toLowerCase(); } catch { /* ignore */ }
    const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!/mikan/.test(host) && !isLocal) {
      throw badRequest(`「${base.name}」暂不支持在线搜索（目前支持 Mikan 系站点），请手动填写追番路径`, 'SEARCH_UNSUPPORTED');
    }
    return base;
  }

  async fetchEpisodeInfo(baseUrl, hash) {
    const cached = this.episodeCache.get(hash);
    if (cached && nowMs() - cached.at < 10 * 60000) return cached.data;
    const pageUrl = `${String(baseUrl).replace(/\/+$/, '')}/Home/Episode/${hash}`;
    const res = await fetchBuffer(pageUrl, {
      timeout: 15000,
      maxBytes: 2 * 1024 * 1024,
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
      proxy: this.data.proxy,
    });
    const data = parseEpisodePage(res.buffer.toString('utf8'), res.url || pageUrl);
    this.episodeCache.set(hash, { at: nowMs(), data });
    if (this.episodeCache.size > 200) this.episodeCache.delete(this.episodeCache.keys().next().value);
    return data;
  }

  /** 某个字幕组的 RSS 里实际有多少集（比主页最近列表更准确） */
  async fetchSubgroupRss(baseUrl, bangumiId, subgroupId) {
    const key = `${bangumiId}|${subgroupId}`;
    const cached = this.subgroupCache.get(key);
    if (cached && nowMs() - cached.at < 15 * 60000) return cached.data;
    const url = rssUrlFor(baseUrl, bangumiId, subgroupId);
    const feed = await fetchFeed(url, { timeout: 20000, proxy: this.data.proxy });
    const episodes = new Set();
    let specials = 0;
    for (const it of feed.items || []) {
      const guess = guessEpisode(it.title);
      if (!guess) continue;
      if (guess.kind === 'range') {
        for (let n = guess.from; n <= guess.to && n - guess.from < 500; n++) episodes.add(n);
      } else if (guess.kind === 'single' && guess.episode) {
        episodes.add(guess.episode);
      } else {
        specials++;
      }
    }
    const data = {
      url,
      items: (feed.items || []).length,
      episodes: Array.from(episodes).sort((a, b) => a - b),
      // 同一集可能有多个版本（简/繁、不同分辨率），优先按识别出的不同集数计数
      count: episodes.size || (feed.items || []).length,
      specials,
      title: feed.title || '',
    };
    this.subgroupCache.set(key, { at: nowMs(), data });
    if (this.subgroupCache.size > 200) this.subgroupCache.delete(this.subgroupCache.keys().next().value);
    return data;
  }

  async fetchHomeMetaFor(homeUrl) {    const cached = this.homeMetaCache.get(homeUrl);
    if (cached && nowMs() - cached.at < 10 * 60000) return cached.data;
    const res = await fetchBuffer(homeUrl, {
      timeout: 20000,
      maxBytes: 6 * 1024 * 1024,
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
      proxy: this.data.proxy,
    });
    const data = parseMikanHome(res.buffer.toString('utf8'), res.url || homeUrl);
    this.homeMetaCache.set(homeUrl, { at: nowMs(), data });
    if (this.homeMetaCache.size > 100) this.homeMetaCache.delete(this.homeMetaCache.keys().next().value);
    return data;
  }

  /** 在配置好的站点里搜索番剧，返回番剧 + 发布组（字幕组）列表 */
  async searchBangumi(input) {
    const src = input || {};
    const q = String(src.q || src.query || '').trim();
    if (!q) throw badRequest('请输入要搜索的番剧名', 'EMPTY_QUERY');
    if (q.length > 60) throw badRequest('搜索关键词过长', 'QUERY_TOO_LONG');
    const base = this.pickSearchBase(src.baseId);
    const limit = Math.min(24, Math.max(4, Number(src.limit) || 12));
    const cacheKey = `${base.id}|${q.toLowerCase()}|${limit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && nowMs() - cached.at < 5 * 60000) return cached.data;

    const searchUrl = `${String(base.url).replace(/\/+$/, '')}/RSS/Search?searchStr=${encodeURIComponent(q)}`;
    const feed = await fetchFeed(searchUrl, { timeout: 20000, proxy: this.data.proxy });

    const episodes = [];
    const seen = new Set();
    for (const it of feed.items || []) {
      const link = String(it.link || '');
      const enclosure = String(it.enclosure || '');
      const hash = (/\/Home\/Episode\/([0-9a-f]{40})/i.exec(link) || [])[1]
        || (/\/Download\/\d+\/([0-9a-f]{40})\.torrent/i.exec(enclosure) || [])[1]
        || (/btih:([0-9a-f]{40})/i.exec(enclosure) || [])[1];
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      episodes.push({ hash, title: String(it.title || ''), torrentUrl: enclosure });
      if (episodes.length >= limit) break;
    }
    if (!episodes.length) throw httpError(404, `没有找到与「${q}」匹配的番剧`, 'SEARCH_EMPTY');

    // 并发抓取单集页面，拿到所属番剧与字幕组（限制 4 并发）
    const details = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, episodes.length) }, async () => {
      while (cursor < episodes.length) {
        const ep = episodes[cursor++];
        try {
          const info = await this.fetchEpisodeInfo(base.url, ep.hash);
          details.push({ ...ep, ...info });
        } catch {
          details.push({ ...ep, bangumiId: '', subgroupId: '', title: ep.title });
        }
      }
    });
    await Promise.all(workers);

    const groups = new Map();
    for (const d of details) {
      if (!d.bangumiId) continue;
      if (!groups.has(d.bangumiId)) {
        groups.set(d.bangumiId, {
          bangumiId: d.bangumiId,
          title: d.title || '',
          cover: d.cover || '',
          homeUrl: d.homeUrl || homeUrlFor(base.url, d.bangumiId),
          subgroups: new Map(),
          hitCount: 0,
        });
      }
      const g = groups.get(d.bangumiId);
      g.hitCount++;
      if (!g.title && d.title) g.title = d.title;
      if (!g.cover && d.cover) g.cover = d.cover;
      if (d.subgroupId) {
        const s = g.subgroups.get(d.subgroupId) || { id: d.subgroupId, name: '', hitCount: 0, sampleTitle: d.title || '' };
        s.hitCount++;
        g.subgroups.set(d.subgroupId, s);
      }
    }

    const results = await Promise.all(Array.from(groups.values()).map(async (g) => {
      let home = null;
      try { home = await this.fetchHomeMetaFor(g.homeUrl); } catch { /* 名称用兜底 */ }
      const homeSubs = (home && home.subgroups) || [];
      const byId = new Map(homeSubs.map((s) => [String(s.id), s]));
      const merged = [];
      for (const s of g.subgroups.values()) {
        const full = byId.get(String(s.id)) || null;
        merged.push({
          id: s.id,
          name: (full && full.name) || s.name || `字幕组 ${s.id}`,
          matched: s.hitCount,
          sampleTitle: s.sampleTitle,
          episodeCount: full ? full.episodeCount : 0,
          episodeText: full ? episodeRanges(full.episodes) : '',
          batch: !!(full && full.batch),
          specials: full ? full.specials : 0,
          exact: !!full,
          rssUrl: rssUrlFor(base.url, g.bangumiId, s.id),
        });
      }
      for (const s of homeSubs) {
        if (g.subgroups.has(String(s.id))) continue;
        merged.push({
          id: String(s.id),
          name: s.name,
          matched: 0,
          sampleTitle: '',
          episodeCount: s.episodeCount,
          episodeText: episodeRanges(s.episodes),
          batch: !!s.batch,
          specials: s.specials || 0,
          exact: true,
          rssUrl: rssUrlFor(base.url, g.bangumiId, s.id),
        });
      }
      merged.sort((a, b) => (b.episodeCount - a.episodeCount) || (b.matched - a.matched) || Number(a.id) - Number(b.id));

      // 主页只列最近若干集；再按字幕组 RSS 校正真实集数（最多 10 个发布组）
      const candidates = merged.slice().sort((a, b) => (b.matched - a.matched) || (b.episodeCount - a.episodeCount)).slice(0, 10);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (cursor < candidates.length) {
          const s = candidates[cursor++];
          try {
            const rss = await this.fetchSubgroupRss(base.url, g.bangumiId, s.id);
            if (rss.count > s.episodeCount) {
              s.episodeCount = rss.count;
              s.episodeText = episodeRanges(rss.episodes);
              s.countSource = 'rss';
            } else if (rss.episodes.length) {
              s.countSource = 'rss';
            }
            s.rssItems = rss.items;
            s.specials = Math.max(s.specials || 0, rss.specials || 0);
          } catch {
            s.countSource = s.countSource || 'home';
          }
        }
      });
      await Promise.all(workers);
      merged.sort((a, b) => (b.episodeCount - a.episodeCount) || (b.matched - a.matched) || Number(a.id) - Number(b.id));

      const total = Number(String((home && home.episodes) || '').replace(/[^\d]/g, ''))
        || merged.reduce((max, s) => Math.max(max, s.episodeCount || 0), 0);
      return {
        bangumiId: g.bangumiId,
        title: (home && home.title) || g.title,
        cover: (home && home.cover) || g.cover,
        homeUrl: g.homeUrl,
        airWeekday: (home && home.airWeekday) || '',
        episodes: (home && home.episodes) || '',
        episodeTotal: total,
        bgmUrl: (home && home.bgmUrl) || '',
        matched: g.hitCount,
        hitCount: g.hitCount,
        subgroups: merged.slice(0, 40),
      };
    }));

    results.sort((a, b) => b.hitCount - a.hitCount || a.title.localeCompare(b.title, 'zh'));
    const data = {
      query: q,
      baseId: base.id,
      baseName: base.name,
      searchedAt: nowMs(),
      totalEpisodes: episodes.length,
      results,
    };
    this.searchCache.set(cacheKey, { at: nowMs(), data });
    if (this.searchCache.size > 60) this.searchCache.delete(this.searchCache.keys().next().value);
    this.log('info', `搜索「${q}」：${results.length} 部番剧 / ${episodes.length} 条单集（${base.name}）`);
    return data;
  }

  isAllowedImageHost(rawUrl) {
    let host = '';
    try { host = new URL(rawUrl).hostname.toLowerCase(); } catch { return false; }
    const allowed = new Set(['mikanime.tv', 'mikanani.me', 'mikan.tv', 'bgm.tv', 'lain.bgm.tv', 'bangumi.tv']);
    if (allowed.has(host) || host === '127.0.0.1' || host === 'localhost') return true;
    for (const b of this.data.bases) {
      try {
        if (new URL(b.url).hostname.toLowerCase() === host) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  /** 同源代理远程图片（仅允许配置站点与 Mikan/bgm 域名），用于搜索结果封面 */
  async fetchImage(rawUrl) {
    const target = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(target)) throw badRequest('图片地址无效', 'BAD_IMAGE_URL');
    if (!this.isAllowedImageHost(target)) throw badRequest('该图片域名不在允许列表内', 'IMAGE_HOST_DENIED');
    const cached = this.imageCache.get(target);
    if (cached && nowMs() - cached.at < 6 * 3600000) return cached;
    const res = await fetchBuffer(target, {
      timeout: 20000,
      maxBytes: 8 * 1024 * 1024,
      headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*' },
    });
    const contentType = String(res.contentType || '').split(';')[0].trim() || 'image/jpeg';
    if (!/^image\//i.test(contentType)) throw httpError(502, `返回的不是图片（${contentType || '未知类型'}）`, 'BAD_IMAGE');
    const item = { at: nowMs(), buffer: res.buffer, contentType };
    this.imageCache.set(target, item, item.buffer.length);
    return item;
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
          videoOffset: Number(e.hardlink.videoOffset) || 0,
          subOffset: Number(e.hardlink.subOffset) || 0,
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

  /** 集数识别小工具：从文件名 / 种子名 / 磁力名猜集数 */
  guessEpisodeTool(text) {
    const input = String(text == null ? '' : text).trim();
    if (!input) throw badRequest('请输入文件名或种子名称', 'EMPTY_TEXT');
    if (input.length > 400) throw badRequest('文本过长', 'TEXT_TOO_LONG');
    const lines = input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
    return {
      results: lines.map((line) => {
        const guess = guessEpisode(line);
        return {
          input: line,
          episode: guess ? guess.episode : null,
          from: guess ? guess.from : null,
          to: guess ? guess.to : null,
          kind: guess ? guess.kind : '',
          label: guess ? guess.label : '未识别',
          source: guess ? guess.source : '',
        };
      }),
    };
  }

  extrasPublic() {
    return this.data.extras.map((x) => this.publicExtra(x));
  }

  pushExtra(rec) {
    const clean = { ...rec };
    delete clean.buffer;
    this.data.extras.unshift(clean);
    if (this.data.extras.length > 300) this.data.extras.length = 300;
    this.store.scheduleSave();
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
      savePath: String(src.savePath || '').trim(),
      category: String(src.category || '').trim(),
      tags: String(src.tags || '').trim(),
      paused: !!src.paused,
      hardlinkDest: String(src.hardlinkDest || '').trim(),
      season: Number(src.season) || 0,
      hardlinkEnabled: src.hardlinkEnabled !== false,
      rename: !!src.rename,
      videoOffset: Number(src.videoOffset) || 0,
      subOffset: Number(src.subOffset) || 0,
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
      savePath: String(src.savePath || '').trim(),
      category: String(src.category || '').trim(),
      tags: String(src.tags || '').trim(),
      paused: !!src.paused,
      hardlinkDest: String(src.hardlinkDest || '').trim(),
      season: Number(src.season) || 0,
      hardlinkEnabled: src.hardlinkEnabled !== false,
      rename: !!src.rename,
      videoOffset: Number(src.videoOffset) || 0,
      subOffset: Number(src.subOffset) || 0,
    });
  }

  async submitExtra(payload) {
    const name = truncate(String(payload.name || '未命名补番'), 160);
    const season = Math.max(0, Math.min(999, Math.trunc(Number(payload.season) || 0)));
    const destTemplate = String(payload.hardlinkDest || '').trim();
    if (destTemplate) this.resolveHardlinkDest(destTemplate, name, season);
    const offset = (v) => Math.max(-999, Math.min(999, Math.trunc(Number(v) || 0)));
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
        videoOffset: offset(payload.videoOffset),
        subOffset: offset(payload.subOffset),
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
        videoOffset: Number(x.hardlink.videoOffset) || 0,
        subOffset: Number(x.hardlink.subOffset) || 0,
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

  /** 修改某条补番的硬链接目录 / 季 / 开关 / 偏移（空目录 = 取消硬链接） */
  updateExtraHardlink(id, input) {
    const x = this.data.extras.find((e) => e.id === id);
    if (!x) throw httpError(404, '补番记录不存在', 'EXTRA_NOT_FOUND');
    const src = input || {};
    const offset = (v) => Math.max(-999, Math.min(999, Math.trunc(Number(v) || 0)));
    const season = src.season === undefined
      ? Number(x.hardlink && x.hardlink.season) || 0
      : Math.max(0, Math.min(999, Math.trunc(Number(src.season) || 0)));
    const dest = String(src.dest === undefined ? ((x.hardlink && x.hardlink.dest) || '') : (src.dest || '')).trim();
    if (dest) this.resolveHardlinkDest(dest, x.name, season);
    if (!x.hardlink) {
      x.hardlink = {
        dest: '', season: 0, enabled: true, rename: false, videoOffset: 0, subOffset: 0,
        done: false, at: 0, files: 0, videos: 0, subs: 0,
        linked: 0, existed: 0, conflicts: 0, skipped: 0, bytes: 0, error: '', attempts: 0, retryAt: 0,
      };
    }
    const enabled = src.enabled === undefined ? x.hardlink.enabled !== false : !!src.enabled;
    const rename = src.rename === undefined ? !!x.hardlink.rename : !!src.rename;
    const videoOffset = src.videoOffset === undefined
      ? (Number(x.hardlink.videoOffset) || 0) : offset(src.videoOffset);
    const subOffset = src.subOffset === undefined
      ? (Number(x.hardlink.subOffset) || 0) : offset(src.subOffset);
    const changed = dest !== x.hardlink.dest
      || season !== (Number(x.hardlink.season) || 0)
      || rename !== !!x.hardlink.rename
      || videoOffset !== (Number(x.hardlink.videoOffset) || 0)
      || subOffset !== (Number(x.hardlink.subOffset) || 0);
    const reenabled = enabled && x.hardlink.enabled === false;
    if (changed || reenabled) {
      x.hardlink.dest = dest;
      x.hardlink.season = season;
      x.hardlink.rename = rename;
      x.hardlink.videoOffset = videoOffset;
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
      if (videoOffset) extraBits.push(`视频${videoOffset > 0 ? '+' : ''}${videoOffset}`);
      if (subOffset) extraBits.push(`字幕${subOffset > 0 ? '+' : ''}${subOffset}`);
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
    if (x.hardlink.enabled === false) throw badRequest('这条补番已关闭硬链接（可在铅笔按钮里重新打开）', 'HARDLINK_DISABLED');
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
    this.store.save();
    this.log('info', `已删除补番记录「${x.name}」${deletedTorrent ? '（同时删除 qB 任务）' : ''}`);
    return { ok: true, deletedTorrent };
  }

  /** 轻量状态指纹：启动时间 + 配置 rev + 并发标志，供 /api/state 协商缓存（304） */
  stateEtag() {
    return `"${this.startedAt}.${this.store.rev}.${this.checking.size}.${this.queue.length}"`;
  }

  /** 只构建下载记录列表（/api/downloads 用，避免拉起整个 state） */
  downloadsPublic(limit) {
    return sortByNewest(this.data.downloads)
      .slice(0, Math.min(1000, Math.max(1, Number(limit) || 200)))
      .map((d) => {
        const guess = guessEpisode(d.title);
        return {
          ...d,
          episode: guess ? guess.episode : null,
          episodeLabel: guess ? guess.label : '',
          episodeKind: guess ? guess.kind : '',
        };
      });
  }

  state() {
    const downloads = this.downloadsPublic(200);
    return {
      app: {
        name: 'anirss',
        version: APP_VERSION,
        startedAt: this.startedAt,
        serverTime: nowMs(),
        dataDir: this.store.dir,
        revision: this.store.rev,
      },
      qb: this.publicQb(),
      proxy: this.publicProxyConfig(),
      hardlink: this.publicHardlinkConfig(),
      bases: this.data.bases.map((b) => ({ ...b })),
      paths: this.data.paths.map((p) => ({ ...p })),
      subs: this.data.subs.map((s) => this.publicSub(s)),
      extras: this.data.extras.slice(0, 200).map((x) => this.publicExtra(x)),
      stats: this.stats(),
      downloads,
      logs: this.data.logs.slice(0, 80),
      checkingIds: Array.from(this.checking),
    };
  }

  /**
   * 导入配置：接受 /api/export 的导出文件，或直接是旧的 config.json。
   * 站点、路径、追番、补番、代理会被覆盖；qBittorrent 与代理的密码保留本机现有值（导出文件里本来就没有）。
   */
  importConfig(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw badRequest('配置文件内容不是有效的 JSON 对象', 'BAD_IMPORT');
    }
    const src = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const keys = ['bases', 'paths', 'subs', 'extras', 'qb', 'proxy', 'hardlink'];
    if (!keys.some((k) => src[k] !== undefined)) {
      throw badRequest('配置文件里没有可导入的配置项（站点 / 路径 / 追番 / 补番 / 连接 / 硬链接）', 'EMPTY_IMPORT');
    }

    const counts = {};
    if (Array.isArray(src.bases)) { this.data.bases = src.bases; counts.bases = src.bases.length; }
    if (Array.isArray(src.paths)) { this.data.paths = src.paths; counts.paths = src.paths.length; }
    if (Array.isArray(src.subs)) { this.data.subs = src.subs; counts.subs = src.subs.length; }
    if (Array.isArray(src.extras)) { this.data.extras = src.extras; counts.extras = src.extras.length; }
    if (src.qb && typeof src.qb === 'object') {
      const qb = this.data.qb;
      if (src.qb.baseUrl) qb.baseUrl = String(src.qb.baseUrl);
      if (src.qb.username !== undefined) qb.username = String(src.qb.username || '');
      if (src.qb.skipTlsVerify !== undefined) qb.skipTlsVerify = !!src.qb.skipTlsVerify;
      if (typeof src.qb.password === 'string' && src.qb.password) qb.password = src.qb.password;
      counts.qb = 1;
    }
    if (src.proxy && typeof src.proxy === 'object') {
      this.data.proxy = normalizeProxy(src.proxy);
      counts.proxy = 1;
    }
    if (src.hardlink && typeof src.hardlink === 'object') {
      const cur = this.data.hardlink || {};
      const pick = (key, fallback, max) => String(src.hardlink[key] == null ? (cur[key] == null ? fallback : cur[key]) : src.hardlink[key]).slice(0, max);
      this.data.hardlink = {
        mode: (src.hardlink.mode || cur.mode) === 'mirror' ? 'mirror' : 'season',
        videoExts: pick('videoExts', hardlink.DEFAULT_EXTENSIONS, 300),
        subExts: pick('subExts', hardlink.DEFAULT_SUB_EXTENSIONS, 300),
        excludeDirs: pick('excludeDirs', hardlink.DEFAULT_EXCLUDE_DIRS, 600),
        excludeTags: pick('excludeTags', hardlink.DEFAULT_EXCLUDE_TAGS, 600),
        includeFonts: src.hardlink.includeFonts === undefined ? !!cur.includeFonts : !!src.hardlink.includeFonts,
        stripRoot: !!src.hardlink.stripRoot,
        defaultDest: String(src.hardlink.defaultDest || '').slice(0, 800),
      };
      counts.hardlink = 1;
    }

    this.store._normalize();
    this.cache.clear();
    this.homeMetaCache.clear();
    this.store.save();
    this.log('info', `已导入配置：站点 ${counts.bases || 0}、路径 ${counts.paths || 0}、追番 ${counts.subs || 0}、补番 ${counts.extras || 0}`);
    return {
      ok: true,
      imported: counts,
      totals: {
        bases: this.data.bases.length,
        paths: this.data.paths.length,
        subs: this.data.subs.length,
        extras: this.data.extras.length,
      },
      note: '为了安全，qBittorrent 与代理的密码没有导入，请到「连接设置」确认。',
    };
  }

  exportConfig() {
    return {
      app: 'anirss',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      note: '不包含 qBittorrent 密码与代理密码；导入后请重新填写密码。',
      qb: {
        baseUrl: this.data.qb.baseUrl,
        username: this.data.qb.username,
        skipTlsVerify: !!this.data.qb.skipTlsVerify,
      },
      proxy: this.publicProxyConfig(),
      hardlink: this.publicHardlinkConfig(),
      bases: this.data.bases,
      paths: this.data.paths,
      subs: this.data.subs,
      extras: this.data.extras,
    };
  }
}

module.exports = { Engine };
