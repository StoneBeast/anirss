'use strict';

const fs = require('fs');
const path = require('path');
const { APP_VERSION, uid, nowMs, deepMerge, composeUrl, ALLOW_CUSTOM_BASES } = require('./util');
const { defaultProxy, normalizeProxy } = require('./proxy');
const { DEFAULT_EXTENSIONS, DEFAULT_SUB_EXTENSIONS, DEFAULT_EXCLUDE_DIRS, DEFAULT_EXCLUDE_TAGS } = require('./hardlink');

// 内置站点：当前所有功能都围绕蜜柑计划展开，暂不支持自定义站点基础地址，
// 软件直接内置这两个站点（「站点与路径」里只读展示，接口层禁止增删改）。
function builtinBases(ts) {
  return [
    { id: 'b_mikan', name: '蜜柑计划', url: 'https://mikanime.tv', note: '内置站点 · 默认', createdAt: ts },
    { id: 'b_mikan_overseas', name: '蜜柑计划(境外)', url: 'https://mikanani.me', note: '内置站点 · 境外线路', createdAt: ts },
  ];
}

/** 内置站点里 URL 主机名对应的 id（用于把旧站点迁移到内置站点） */
function builtinBaseIdForHost(host) {
  return String(host || '').toLowerCase() === 'mikanani.me' ? 'b_mikan_overseas' : 'b_mikan';
}

function hostOfUrl(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function defaultData() {
  const ts = nowMs();
  return {
    version: 1,
    appVersion: APP_VERSION,
    createdAt: ts,
    updatedAt: ts,
    qb: {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: '',
      skipTlsVerify: false,
      verifiedAt: 0,
      lastTest: null,
    },
    proxy: defaultProxy(),
    // 补番硬链接：正片/字幕筛选、排除规则、默认目标模板
    hardlink: {
      mode: 'season',
      videoExts: DEFAULT_EXTENSIONS,
      subExts: DEFAULT_SUB_EXTENSIONS,
      excludeDirs: DEFAULT_EXCLUDE_DIRS,
      excludeTags: DEFAULT_EXCLUDE_TAGS,
      includeFonts: false,
      stripRoot: false,
      renamePattern: '${name} - ${episode2}',
      defaultDest: '',
    },
    bases: builtinBases(ts),
    paths: [],
    subs: [],
    extras: [],
    downloads: [],
    logs: [],
  };
}

class Store {
  constructor(file) {
    this.file = path.resolve(file);
    this.dir = path.dirname(this.file);
    this.rev = 0;
    this._saveTimer = null;
    fs.mkdirSync(this.dir, { recursive: true });
    this.data = this._load();
    this._normalize();
    this.save();
  }

  _load() {
    if (!fs.existsSync(this.file)) return defaultData();
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('empty config');
      return parsed;
    } catch (e) {
      const backup = this.file + '.corrupt-' + Date.now();
      try {
        fs.renameSync(this.file, backup);
        console.error(`[store] 配置文件损坏，已备份到 ${backup}：${e.message}`);
      } catch {
        /* ignore */
      }
      return defaultData();
    }
  }

  _normalize() {
    const base = defaultData();
    // 以默认结构补齐缺失字段；paths/subs/extras 等数组以文件内容为准。
    // bases 例外：站点由应用内置，见下方「站点不再支持自定义」。
    const merged = deepMerge(base, this.data);
    merged.appVersion = APP_VERSION;
    merged.paths = Array.isArray(this.data.paths) ? this.data.paths : [];
    merged.subs = Array.isArray(this.data.subs) ? this.data.subs : [];
    merged.extras = Array.isArray(this.data.extras) ? this.data.extras : [];
    merged.downloads = Array.isArray(this.data.downloads) ? this.data.downloads : [];
    merged.logs = Array.isArray(this.data.logs) ? this.data.logs : [];
    if (!merged.qb || typeof merged.qb !== 'object') merged.qb = base.qb;
    merged.qb.baseUrl = String(merged.qb.baseUrl || '');
    merged.qb.username = String(merged.qb.username || '');
    merged.qb.password = String(merged.qb.password || '');
    merged.qb.skipTlsVerify = !!merged.qb.skipTlsVerify;
    merged.qb.verifiedAt = Number(merged.qb.verifiedAt) || 0;
    merged.qb.lastTest = merged.qb.lastTest && typeof merged.qb.lastTest === 'object' ? merged.qb.lastTest : null;
    merged.proxy = normalizeProxy(this.data.proxy, base.proxy);

    if (!merged.hardlink || typeof merged.hardlink !== 'object') merged.hardlink = { ...base.hardlink };
    // 兼容 1.8.0 的 extensions 字段
    if (merged.hardlink.videoExts == null && merged.hardlink.extensions != null) {
      merged.hardlink.videoExts = merged.hardlink.extensions;
    }
    merged.hardlink.mode = merged.hardlink.mode === 'mirror' ? 'mirror' : 'season';
    merged.hardlink.videoExts = String(merged.hardlink.videoExts == null ? base.hardlink.videoExts : merged.hardlink.videoExts).slice(0, 300);
    merged.hardlink.subExts = String(merged.hardlink.subExts == null ? base.hardlink.subExts : merged.hardlink.subExts).slice(0, 300);
    merged.hardlink.excludeDirs = String(merged.hardlink.excludeDirs == null ? base.hardlink.excludeDirs : merged.hardlink.excludeDirs).slice(0, 600);
    merged.hardlink.excludeTags = String(merged.hardlink.excludeTags == null ? base.hardlink.excludeTags : merged.hardlink.excludeTags).slice(0, 600);
    merged.hardlink.includeFonts = !!merged.hardlink.includeFonts;
    merged.hardlink.stripRoot = !!merged.hardlink.stripRoot;
    merged.hardlink.renamePattern = String(merged.hardlink.renamePattern || '${name} - ${episode2}').slice(0, 200);
    merged.hardlink.defaultDest = String(merged.hardlink.defaultDest || '').slice(0, 800);
    delete merged.hardlink.extensions;

    // 站点不再支持自定义：默认使用内置站点；旧配置文件里的站点会被替换，
    // 追番按原站点主机名映射到对应内置站点（认不出就落到默认站点）。
    // dev/smoke/demo 等本地测试用 ANIRSS_DEV_ALLOW_CUSTOM_BASES=1 保留配置文件里的站点。
    if (ALLOW_CUSTOM_BASES && Array.isArray(this.data.bases)) {
      merged.bases = this.data.bases;
    } else {
      const prevBases = Array.isArray(this.data.bases) ? this.data.bases : [];
      const prevById = new Map(prevBases.filter((b) => b && b.id).map((b) => [b.id, b]));
      merged.bases = builtinBases(nowMs()).map((b) => {
        // 沿用已落盘的 createdAt，避免每次启动都刷新内置站点的时间戳
        const old = prevById.get(b.id);
        return old && Number(old.createdAt) ? { ...b, createdAt: Number(old.createdAt) } : b;
      });
      for (const s of merged.subs) {
        if (!s.baseId) continue; // 完整 URL 追番不依赖站点
        const prev = prevBases.find((b) => b && b.id === s.baseId);
        s.baseId = builtinBaseIdForHost(hostOfUrl(prev && prev.url));
        if (s.path && !/^https?:\/\//i.test(s.path)) {
          const next = merged.bases.find((b) => b.id === s.baseId);
          try { s.url = composeUrl(next.url, s.path); } catch { /* 保留原值 */ }
        }
      }
    }

    for (const b of merged.bases) {
      b.id = String(b.id || uid('b_'));
      b.name = String(b.name || '未命名站点');
      b.url = String(b.url || '');
      b.note = String(b.note || '');
    }
    for (const p of merged.paths) {
      p.id = String(p.id || uid('p_'));
      p.name = String(p.name || '未命名路径');
      p.path = String(p.path || '');
    }
    const defaults = merged.paths.filter((p) => p.isDefault);
    if (defaults.length > 1) defaults.slice(1).forEach((p) => { p.isDefault = false; });

    for (const s of merged.subs) {
      s.id = String(s.id || uid('s_'));
      s.seen = s.seen && typeof s.seen === 'object' && !Array.isArray(s.seen) ? s.seen : {};
      s.enabled = s.enabled !== false;
      s.intervalMin = Number(s.intervalMin) || 10;
      s.maxPerCheck = Number(s.maxPerCheck) || 5;
      s.include = String(s.include || '');
      s.exclude = String(s.exclude || '');
      s.ignoreCase = s.ignoreCase !== false;
      s.savePath = String(s.savePath || '');
      s.category = String(s.category || '');
      s.tags = String(s.tags || '');
      s.meta = s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta) ? s.meta : {};
      s.meta.homeUrl = String(s.meta.homeUrl || '');
      s.meta.cover = String(s.meta.cover || '');
      s.meta.title = String(s.meta.title || '');
      s.meta.bgmUrl = String(s.meta.bgmUrl || '');
      s.meta.bgmId = String(s.meta.bgmId || '');
      s.meta.airWeekday = String(s.meta.airWeekday || '');
      s.meta.episodes = String(s.meta.episodes || '');
      s.meta.startDate = String(s.meta.startDate || '');
      s.meta.officialSite = String(s.meta.officialSite || '');
      s.meta.fetchedAt = Number(s.meta.fetchedAt) || 0;
      s.meta.error = String(s.meta.error || '');
      delete s.meta.subgroups;
    }

    for (const x of merged.extras) {
      x.id = String(x.id || uid('x_'));
      x.name = String(x.name || '未命名补番');
      x.source = x.source === 'file' ? 'file' : 'magnet';
      x.magnet = String(x.magnet || '');
      x.hash = String(x.hash || '').toLowerCase();
      x.fileName = String(x.fileName || '');
      x.savePath = String(x.savePath || '');
      x.category = String(x.category || '');
      x.tags = String(x.tags || '');
      x.paused = !!x.paused;
      x.ok = !!x.ok;
      x.error = String(x.error || '');
      x.createdAt = Number(x.createdAt) || 0;
      x.qb = x.qb && typeof x.qb === 'object' ? x.qb : null;
      // 外挂字幕库（应用数据目录 subtitles/<id>/ 下的相对路径清单）
      x.subs = Array.isArray(x.subs)
        ? x.subs.slice(0, 1000)
          .map((s) => ({ name: String(s && s.name || '').replace(/\\/g, '/').slice(0, 400), size: Number(s && s.size) || 0, at: Number(s && s.at) || 0 }))
          .filter((s) => s.name && !s.name.split('/').includes('..'))
        : [];
      const hl = x.hardlink && typeof x.hardlink === 'object' ? x.hardlink : {};
      const clampOffset = (v) => Math.max(-999, Math.min(999, Math.trunc(Number(v) || 0)));
      // 1.11 及更早的记录只有 videoOffset/subOffset 两个数字；
      // 迁移为「整体 offset + 可选字幕偏移」：字幕偏移和视频相同 → 视为跟随（null）
      const legacyVideoOffset = clampOffset(hl.videoOffset);
      const legacySubOffset = clampOffset(hl.subOffset);
      const isNewFormat = hl.offset !== undefined;
      x.hardlink = {
        dest: String(hl.dest || ''),
        season: Math.max(0, Math.min(999, Number(hl.season) || 0)),
        enabled: hl.enabled !== false,
        rename: !!hl.rename,
        offset: isNewFormat ? clampOffset(hl.offset) : legacyVideoOffset,
        subOffset: isNewFormat
          ? (hl.subOffset == null || hl.subOffset === '' ? null : clampOffset(hl.subOffset))
          : (legacySubOffset === legacyVideoOffset ? null : legacySubOffset),
        done: !!hl.done,
        at: Number(hl.at) || 0,
        files: Number(hl.files) || 0,
        videos: Number(hl.videos) || 0,
        subs: Number(hl.subs) || 0,
        linked: Number(hl.linked) || 0,
        existed: Number(hl.existed) || 0,
        conflicts: Number(hl.conflicts) || 0,
        skipped: Number(hl.skipped) || 0,
        bytes: Number(hl.bytes) || 0,
        error: String(hl.error || ''),
        attempts: Number(hl.attempts) || 0,
        retryAt: Number(hl.retryAt) || 0,
      };
      delete x.buffer;
    }

    for (const d of merged.downloads) {
      d.id = String(d.id || uid('d_'));
      d.status = String(d.status || 'failed');
      d.dedupe = d.dedupe !== false;
    }

    this.data = merged;
  }

  save() {
    this.rev++;
    this.data.updatedAt = nowMs();
    const json = JSON.stringify(this.data, null, 2);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.copyFileSync(tmp, this.file);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
    try { fs.chmodSync(this.file, 0o600); } catch { /* Windows 上可能不支持 */ }
  }

  /** 只递增 rev（不写盘）：内存态变化（如日志）要反映到 /api/state 的 ETag 上 */
  bump() {
    this.rev++;
  }

  /**
   * 合并写：rev 立即递增（保证 /api/state 的 ETag 感知到变化），
   * 磁盘写入按 SCHEDULE_SAVE_MS 合并成一次。
   * 用于下载循环 / 后台巡检这类一次动作里连续改多次数据的热点路径；
   * 用户主动修改配置仍走 save() 同步落盘。
   */
  scheduleSave() {
    if (this._saveTimer) {
      this.rev++;
      return;
    }
    this.rev++;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try { this.save(); } catch (e) {
        console.error('[store] 延迟写入配置失败：' + e.message);
      }
    }, 200);
  }

  /** 有排队的合并写时立即落盘（进程退出前调用） */
  flush() {
    if (!this._saveTimer) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try { this.save(); } catch (e) {
      console.error('[store] 退出前写入配置失败：' + e.message);
    }
  }

  pruneSeen(sub, maxEntries, maxAgeDays) {
    const max = maxEntries || 2500;
    const cutoff = nowMs() - (maxAgeDays || 180) * 86400000;
    const entries = Object.entries(sub.seen || {});
    if (entries.length <= max && entries.every(([, ts]) => Number(ts) >= cutoff)) return;
    const kept = entries
      .filter(([, ts]) => Number(ts) >= cutoff)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, max);
    sub.seen = Object.fromEntries(kept);
  }
}

module.exports = { Store, defaultData };
