'use strict';

const fs = require('fs');
const path = require('path');
const { APP_VERSION, uid, nowMs, deepMerge } = require('./util');
const { defaultProxy, normalizeProxy } = require('./proxy');

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
    bases: [
      {
        id: uid('b_'),
        name: 'Mikan',
        url: 'https://mikanime.tv',
        note: '蜜柑计划 · 默认站点，可编辑或删除',
        createdAt: ts,
      },
    ],
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
    // 以默认结构补齐缺失字段；数组（bases/paths/subs/...）以文件内容为准
    const merged = deepMerge(base, this.data);
    merged.appVersion = APP_VERSION;
    // 默认站点只在配置文件完全没有 bases 字段时给出，避免用户删空后又被塞回来
    if (!Array.isArray(this.data.bases)) merged.bases = base.bases;
    else merged.bases = this.data.bases;
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
