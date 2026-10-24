'use strict';

(function () {
  /* ============================================================
   * 常量 / 图标
   * ============================================================ */

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 21h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    plug: '<path d="M9 3v6"/><path d="M15 3v6"/><path d="M7 9h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5z"/><path d="M12 17v4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
    'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    alert: '<path d="M10.3 4.3 2.8 18a1.6 1.6 0 0 0 1.4 2.4h15.6a1.6 1.6 0 0 0 1.4-2.4L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    tag: '<path d="M20 13 13 20l-9-9V4h7z"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    bookmark: '<path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z"/>',
    zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    magnet: '<path d="M5 4v7a7 7 0 0 0 14 0V4"/><path d="M5 8h4M15 8h4"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
    shield: '<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/>',
  };

  function icon(name, size, cls) {
    const body = ICONS[name] || ICONS.info;
    return `<svg class="${cls || ''}" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /* ============================================================
   * 基础工具
   * ============================================================ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const API = (() => {
    const p = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    return p + 'api/';
  })();

  const S = {
    data: null,
    qbStatus: null,
    qbLoading: false,
    view: 'overview',
    subFilter: 'all',
    downloadFilter: 'all',
    formDirty: false,
    testResult: null,
    proxyTestResult: null,
    drawer: null,
    modal: null,
    subTemplate: null,
    nameTouched: false,
    nameTimer: null,
    nameToken: 0,
    lastResolveUrl: '',
    subView: (() => {
      try { return (localStorage.getItem('anirss-subview') || localStorage.getItem('qbrss-subview')) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
    })(),
    searchResult: null,
    searchLoading: false,
    searchError: '',
    guessResult: null,
    confirmResolve: null,
    refreshing: false,
    loadError: '',
    offlineNotified: false,
    pollTimer: null,
    etags: new Map(),
    renderedView: null,
    viewDirty: false,
    drafts: {},
    modalDirty: false,
    subModalDraft: null,
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function safeUrl(value) {
    const s = String(value == null ? '' : value);
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '#';
    } catch {
      return '#';
    }
  }

  function hostOf(value) {
    try { return new URL(value).host; } catch { return String(value || ''); }
  }

  function fmtBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return '—';
    if (num < 1024) return num + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = num / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
  }

  function fmtSpeed(n) {
    return fmtBytes(n) + '/s';
  }

  function fmtCount(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('zh-CN');
  }

  function relTime(ts) {
    if (!ts) return '从未';
    const diff = Date.now() - Number(ts);
    if (diff < 0) return untilTime(ts);
    if (diff < 45000) return '刚刚';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + ' 分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时前';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + ' 天前';
    return fmtDate(ts, true);
  }

  function untilTime(ts) {
    if (!ts) return '已暂停';
    const diff = Number(ts) - Date.now();
    if (diff <= 0) return '即将';
    const mins = Math.ceil(diff / 60000);
    if (mins <= 1) return '不到 1 分钟';
    if (mins < 60) return mins + ' 分钟后';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时后';
    return Math.floor(hours / 24) + ' 天后';
  }

  function fmtDate(ts, short) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    try {
      return new Intl.DateTimeFormat('zh-CN', short
        ? { year: 'numeric', month: '2-digit', day: '2-digit' }
        : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
      ).format(d);
    } catch {
      return d.toLocaleString();
    }
  }

  function fmtClock(ts) {
    try {
      return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(Number(ts)));
    } catch {
      return '';
    }
  }

  function ruleCount(text) {
    return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).length;
  }

  /**
   * 存储路径模板。支持：
   *   ${1} ${2}          （推荐）
   *   ${{1}} ${{2}}      （兼容）
   *   ${{}} {{}}         （匿名变量，按出现顺序编号）
   * 例如 /vol2/1000/media/动画/${{1}}/Season ${{}}
   * 返回 parts（文本 / 变量）与去重后的变量编号。
   */
  function sanitizePathName(name) {
    return String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/[\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim()
      .slice(0, 120);
  }

  function substituteNameInPath(path, name) {
    const safe = sanitizePathName(name);
    return String(path == null ? '' : path)
      .replace(/\$?\{\{\s*name\s*\}\}|\$\{\s*name\s*\}/gi, safe || '${name}');
  }

  function parsePathTemplate(template) {
    const tpl = String(template == null ? '' : template);
    const re = /\$?\{\{\s*(name|\d*)\s*\}\}|\$\{\s*(name|\d+)\s*\}/gi;
    const parts = [];
    const indices = [];
    const seen = new Set();
    let hasName = false;
    let last = 0;
    let next = 1;
    let m;
    while ((m = re.exec(tpl))) {
      if (m.index > last) parts.push({ text: tpl.slice(last, m.index) });
      const key = String(m[1] || m[2] || '').toLowerCase();
      if (key === 'name') {
        hasName = true;
        parts.push({ name: true });
      } else {
        let idx = m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : 0;
        if (!idx || idx < 1) {
          while (seen.has(next)) next++;
          idx = next;
        }
        seen.add(idx);
        indices.push(idx);
        parts.push({ var: idx });
      }
      last = re.lastIndex;
    }
    if (last < tpl.length) parts.push({ text: tpl.slice(last) });
    const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
    return { template: tpl, parts, indices: unique, count: unique.length, hasName };
  }

  function composePathTemplate(parsed, values, subName) {
    const name = sanitizePathName(subName);
    const composed = parsed.parts.map((part) => {
      if (part.text != null) return part.text;
      if (part.name) return name || '${name}';
      const raw = String(values[part.var] == null ? '' : values[part.var]).trim();
      if (!raw) return '${' + part.var + '}';
      // 变量值里也允许写 ${name}，一并替换成追番名称
      return substituteNameInPath(raw, subName);
    }).join('');
    return substituteNameInPath(composed, subName);
  }

  function hasNamePlaceholder(text) {
    return /\$?\{\{\s*name\s*\}\}|\$\{\s*name\s*\}/i.test(String(text == null ? '' : text));
  }

  function composeClientUrl(base, subPath) {
    const b = String(base || '').trim().replace(/\/+$/, '');
    const p = String(subPath || '').trim();
    if (!p) return b;
    if (/^https?:\/\//i.test(p)) return p;
    if (!b) return p;
    return b + '/' + p.replace(/^\/+/, '');
  }

  function isHttp(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  }

  function regexErrorOf(text) {
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i].trim();
      if (!p || p.startsWith('#')) continue;
      try { new RegExp(p, 'i'); } catch (e) {
        return `第 ${i + 1} 行正则无效：${e.message}`;
      }
    }
    return '';
  }

  /** 带 ETag 协商的 GET：内容没变时服务端返回 304，返回 null 表示无需更新 */
  async function apiCached(pathname) {
    const headers = {};
    const etag = S.etags.get(pathname);
    if (etag) headers['If-None-Match'] = etag;
    let res;
    try {
      res = await fetch(API + String(pathname).replace(/^\/+/, ''), {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
    } catch {
      throw new Error('无法连接应用服务，请确认服务仍在运行');
    }
    if (res.status === 304) return null;
    const data = await parseJsonResponse(res);
    if (res.headers.get('ETag')) S.etags.set(pathname, res.headers.get('ETag'));
    return data;
  }

  async function parseJsonResponse(res) {
    const raw = await res.text();
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); } catch { throw new Error('应用服务返回了无法解析的响应'); }
    }
    if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
    return data;
  }

  async function api(pathname, options) {
    const opts = options || {};
    let res;
    try {
      res = await fetch(API + String(pathname).replace(/^\/+/, ''), {
        method: opts.method || 'GET',
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new Error('无法连接应用服务，请确认服务仍在运行');
    }
    return parseJsonResponse(res);
  }

  function toast(message, type, title) {
    const root = $('#toast-root');
    if (!root) return;
    const kind = type || 'info';
    const iconName = kind === 'success' ? 'check' : kind === 'error' || kind === 'warn' ? 'alert' : 'info';
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `
      <div class="toast-icon">${icon(iconName, 12)}</div>
      <div class="toast-text">${title ? `<strong>${esc(title)}</strong>` : ''}<span>${esc(message)}</span></div>
      <button class="toast-close" type="button" data-action="toast-close">${icon('x', 11)}</button>`;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    }, 4600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function applyTheme(theme, persist) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    if (persist) {
      try { localStorage.setItem('anirss-theme', next); } catch { /* ignore */ }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#f4f7fb' : '#070b11');
    const btn = $('#theme-toggle');
    if (btn) {
      btn.innerHTML = icon(next === 'light' ? 'moon' : 'sun', 17);
      btn.title = next === 'light' ? '切换到深色主题' : '切换到浅色主题';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  async function withBusy(btn, fn) {
    if (!btn) return fn();
    if (btn.dataset.busy === '1') return undefined;
    btn.dataset.busy = '1';
    btn.classList.add('is-busy');
    btn.disabled = true;
    try {
      return await fn();
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    } finally {
      btn.classList.remove('is-busy');
      btn.disabled = false;
      delete btn.dataset.busy;
    }
  }

  /* ============================================================
   * 路由 / 渲染骨架
   * ============================================================ */

  const ROUTES = {
    overview: '总览',
    subs: '追番',
    extras: '补番',
    downloads: '下载记录',
    library: '站点与路径',
    connection: '连接设置',
  };

  function readRoute() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    return Object.prototype.hasOwnProperty.call(ROUTES, raw) ? raw : 'overview';
  }

  function onRoute() {
    const next = readRoute();
    if (next !== S.view) {
      // 离开当前页前保存未提交的草稿（页面内表单 + 追番弹窗）
      if (S.viewDirty) {
        const el = $('#view');
        if (el) S.drafts[S.view] = captureViewDraft(el);
      }
      const modalDraft = captureSubModalDraft();
      S.view = next;
      S.formDirty = false;
      S.viewDirty = false;
      S.testResult = null;
      closeLayers();
      if (modalDraft) S.subModalDraft = modalDraft;
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    renderChrome();
    renderView();
    if (next === 'overview') loadQbStatus();
    if (next === 'extras') refreshExtrasStatus(null, true);
    if (next === 'subs' && S.subModalDraft) {
      const draft = S.subModalDraft;
      S.subModalDraft = null;
      openSubModal(draft.id || undefined, { draft });
    }
  }

  function renderChrome() {
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === S.view));
    const crumb = $('#crumb');
    if (crumb) crumb.textContent = ROUTES[S.view] || '总览';

    const count = S.data ? S.data.stats.subs : 0;
    const navCount = $('#nav-sub-count');
    if (navCount) navCount.textContent = count ? String(count) : '';
    const extraCount = S.data ? (S.data.extras || []).length : 0;
    const navExtra = $('#nav-extra-count');
    if (navExtra) navExtra.textContent = extraCount ? String(extraCount) : '';

    updateConnectionChrome();
    const checkAll = $('#check-all-btn');
    if (checkAll) {
      const visible = S.view === 'overview' || S.view === 'subs';
      checkAll.style.display = visible ? '' : 'none';
      checkAll.disabled = !S.data || S.data.stats.enabled === 0;
      const label = checkAll.querySelector('span:last-child');
      if (label) label.textContent = S.data && S.data.stats.checking > 0 ? '检查中…' : '全部检查';
    }
  }

  function updateConnectionChrome() {
    const qb = S.data ? S.data.qb : null;
    const st = S.qbStatus;
    let dotClass = 'dot';
    let text = '读取中';
    let side = '正在读取连接状态…';
    let tip = '';

    if (S.offlineNotified) {
      dotClass = 'dot red';
      text = '服务离线';
      side = '无法连接应用服务';
    } else if (st && st.ok) {
      dotClass = 'dot green';
      text = st.version ? `qB ${st.version}` : 'qB 已连接';
      side = `${st.version || '已连接'} · ↓ ${fmtSpeed(st.dlSpeed || 0)}`;
      tip = `qBittorrent WebUI ${st.webapi || ''} · ${st.connectionStatus || ''}`;
    } else if (st && st.ok === false && st.error) {
      dotClass = 'dot red';
      text = 'qB 异常';
      side = 'qBittorrent 连接异常';
      tip = st.error;
    } else if (qb && qb.lastTest && qb.lastTest.ok) {
      dotClass = 'dot green';
      text = 'qB 已连接';
      side = qb.lastTest.version || '已连接';
    } else if (qb && qb.lastTest && qb.lastTest.ok === false) {
      dotClass = 'dot red';
      text = '连接失败';
      side = 'qBittorrent 连接失败';
      tip = qb.lastTest.error || '';
    } else if (qb && qb.baseUrl) {
      dotClass = 'dot amber';
      text = '未验证';
      side = hostOf(qb.baseUrl);
    } else {
      dotClass = 'dot amber';
      text = '未配置';
      side = '尚未配置 qBittorrent';
    }

    const statusDot = $('#status-dot');
    const statusText = $('#status-text');
    const sideDot = $('#side-dot');
    const sideText = $('#side-conn-text');
    if (statusDot) statusDot.className = dotClass;
    if (statusText) statusText.textContent = text;
    if (sideDot) sideDot.className = dotClass;
    if (sideText) sideText.textContent = side;
    const pill = $('#status-pill');
    if (pill) pill.title = tip || '';
  }

  /* ------------------------------------------------------------
   * 视图重绘时的表单草稿
   * renderView() 会整体替换 #view 的 HTML；后台轮询（12 秒一次）、
   * 「刷新状态」、窗口重新可见都会走到这里，不暂存就会把用户刚粘贴的
   * 磁力链接、名称、分类等清空（v1.7.1 修复）。这里按 id 暂存后还原，
   * 顺带还原焦点与光标位置，正在输入法组字时则由 refresh 跳过重绘。
   * ---------------------------------------------------------- */

  const DRAFT_TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local']);

  function draftKind(el) {
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'text';
    if (tag === 'SELECT') return 'select';
    if (tag !== 'INPUT') return '';
    const type = String(el.type || 'text').toLowerCase();
    if (type === 'file') return 'file';
    if (type === 'checkbox' || type === 'radio') return 'check';
    return DRAFT_TEXT_TYPES.has(type) ? 'text' : '';
  }

  function captureViewDraft(root) {
    const active = document.activeElement;
    const fields = [];
    let focused = null;
    $$('[id]', root).forEach((el) => {
      const kind = draftKind(el);
      if (!kind) return;
      const item = { id: el.id, kind, value: '', checked: false, files: null };
      if (kind === 'file') {
        item.files = Array.from(el.files || []);
      } else if (kind === 'check') {
        item.checked = !!el.checked;
      } else {
        item.value = el.value;
      }
      fields.push(item);
      if (el === active) {
        let start = null;
        let end = null;
        try {
          start = el.selectionStart;
          end = el.selectionEnd;
        } catch { /* select / number 等没有选区 */ }
        focused = { id: el.id, start, end };
      }
    });
    return { fields, focused, template: S.view === 'extras' && !!S.subTemplate, templateState: S.view === 'extras' && S.subTemplate ? { id: S.subTemplate.id, values: { ...S.subTemplate.values } } : null };
  }

  /** 用路径预设 id + 变量值恢复 S.subTemplate（跨页草稿用） */
  function restoreSubTemplate(state) {
    if (!state || !state.id) return;
    const preset = (S.data.paths || []).find((p) => p.id === state.id);
    if (!preset) return;
    S.subTemplate = {
      id: preset.id,
      name: preset.name,
      template: preset.path,
      parsed: parsePathTemplate(preset.path),
      values: { ...(state.values || {}) },
    };
  }

  function restoreViewDraft(root, draft) {    const byId = new Map($$('[id]', root).map((el) => [el.id, el]));
    draft.fields.forEach((item) => {
      const el = byId.get(item.id);
      if (!el) return;
      if (item.kind === 'file') {
        if (!item.files || !item.files.length) return;
        try {
          const dt = new DataTransfer();
          item.files.forEach((file) => dt.items.add(file));
          el.files = dt.files;
        } catch { /* 浏览器不允许写 FileList 时只能让用户重选 */ }
        return;
      }
      if (item.kind === 'check') {
        el.checked = item.checked;
        return;
      }
      if (item.kind === 'select') {
        if ($$('option', el).some((opt) => opt.value === item.value)) el.value = item.value;
        return;
      }
      el.value = item.value;
    });
    if (draft.templateState) restoreSubTemplate(draft.templateState);
    if (draft.template) resumeExtrasForm(root);
    if (draft.focused) {
      const el = byId.get(draft.focused.id);
      if (el && !el.disabled) {
        try {
          el.focus({ preventScroll: true });
          if (draft.focused.start != null && typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(draft.focused.start, draft.focused.end);
          }
        } catch { /* 焦点还原失败不影响重绘结果 */ }
      }
    }
  }

  /** 追番弹窗草稿：切换页面时暂存，切回来再原样恢复 */
  function captureSubModalDraft() {
    const form = $('#sub-form');
    if (!form || !S.modalDirty) return null;
    const read = (id) => {
      const el = $('#' + id, form);
      if (!el) return '';
      return draftKind(el) === 'check' ? !!el.checked : el.value;
    };
    return {
      id: form.dataset.id || '',
      mode: form.dataset.mode || 'base',
      values: {
        name: read('f-name'),
        baseId: read('f-base'),
        path: read('f-path'),
        url: read('f-url'),
        include: read('f-include'),
        exclude: read('f-exclude'),
        ignoreCase: !!read('f-ignorecase'),
        savePath: read('f-savepath'),
        category: read('f-category'),
        tags: read('f-tags'),
        intervalMin: read('f-interval'),
        maxPerCheck: read('f-max'),
        enabled: !!read('f-enabled'),
      },
      subTemplate: S.subTemplate ? { id: S.subTemplate.id, values: { ...S.subTemplate.values } } : null,
      nameTouched: !!S.nameTouched,
    };
  }

  function viewHTML(view) {
    const fn = {
      overview: viewOverview,
      subs: viewSubs,
      extras: viewExtras,
      downloads: viewDownloads,
      library: viewLibrary,
      connection: viewConnection,
    }[view];
    return fn ? fn() : viewOverview();
  }

  const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

  /** 把新 HTML 的属性/文本同步到现有 DOM，保留元素、焦点与输入内容 */
  function patchNode(node, src) {
    if (!node || !src) return;
    if (node.nodeType !== src.nodeType) {
      node.replaceWith(src.cloneNode(true));
      return;
    }
    if (node.nodeType === 3) {
      if (node.nodeValue !== src.nodeValue) node.nodeValue = src.nodeValue;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName !== src.tagName) {
      node.replaceWith(src.cloneNode(true));
      return;
    }
    const active = document.activeElement;
    if (active && node.contains(active)) return; // 正在编辑/聚焦的子树保持原样
    if (FORM_TAGS.has(node.tagName)) return; // 表单控件不碰，避免清掉未提交内容
    for (const attr of Array.from(src.attributes)) {
      if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
    }
    for (const attr of Array.from(node.attributes)) {
      if (!src.hasAttribute(attr.name)) node.removeAttribute(attr.name);
    }
    patchChildren(node, src);
  }

  function patchChildren(parent, srcParent) {
    const kids = Array.from(parent.childNodes);
    const srcs = Array.from(srcParent.childNodes);
    const kidEls = kids.filter((k) => k.nodeType === 1);
    const srcEls = srcs.filter((s) => s.nodeType === 1);
    const allKeyed = srcEls.length > 0 && srcEls.every((s) => s.hasAttribute('data-key'));
    const anyKeyed = kidEls.some((k) => k.hasAttribute('data-key'));
    // 带 data-key 的列表（下载行 / 追番卡片 / 抽屉条目…）：数量或顺序变化时按 key
    // 复用现有节点，避免整列表重建造成的闪动、封面重载与滚动跳动
    if (allKeyed && anyKeyed) {
      const same = kidEls.length === srcEls.length &&
        kidEls.every((k, i) => k.getAttribute('data-key') === srcEls[i].getAttribute('data-key'));
      if (!same) {
        const active = document.activeElement;
        if (active && parent.contains(active)) return; // 正在编辑的列表等编辑结束再对齐
        const byKey = new Map(kidEls.map((k) => [k.getAttribute('data-key'), k]));
        const frag = document.createDocumentFragment();
        for (const s of srcEls) {
          const ex = byKey.get(s.getAttribute('data-key'));
          if (ex) {
            byKey.delete(s.getAttribute('data-key'));
            patchNode(ex, s);
            frag.appendChild(ex);
          } else {
            frag.appendChild(s.cloneNode(true));
          }
        }
        parent.replaceChildren(frag); // 剩下的（含多余空白文本节点）一并清掉
        return;
      }
      // 结构一致：落到下面的逐节点比对，不移动任何节点
    }
    if (kids.length === srcs.length) {
      for (let i = 0; i < kids.length; i += 1) patchNode(kids[i], srcs[i]);
      return;
    }
    const active = document.activeElement;
    if (active && parent.contains(active)) return;
    const frag = document.createDocumentFragment();
    srcs.forEach((s) => frag.appendChild(s.cloneNode(true)));
    parent.replaceChildren(frag);
  }

  /** 原地更新（后台轮询用）：不重绘整页、不闪、不丢焦点与滚动位置 */
  function patchView(html) {
    const view = $('#view');
    if (!view) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    patchChildren(view, tpl.content);
  }

  function softRenderView() {
    if (!S.data) return;
    const view = $('#view');
    if (!view) return;
    if (S.view === 'connection' && S.formDirty) {
      renderConnectionResult();
      return;
    }
    patchView(viewHTML(S.view));
  }

  function renderView() {
    if (!S.data) {
      if (S.loadError) renderFatal();
      return;
    }
    if (S.view === 'connection' && S.formDirty) return;
    const el = $('#view');
    if (!el) return;
    // 同页重绘时暂存；跨页返回时用离开前保存的草稿
    const stored = S.drafts[S.view] || null;
    const draft = stored || (S.viewDirty && S.renderedView === S.view ? captureViewDraft(el) : null);
    el.innerHTML = viewHTML(S.view);
    if (S.view === 'extras' && !draft) initExtrasForm();
    if (draft) {
      restoreViewDraft(el, draft);
      S.viewDirty = true;
      if (S.view === 'connection') S.formDirty = true;
    }
    if (S.view === 'extras') updateHardlinkPreview();
    S.renderedView = S.view;
  }

  function renderFatal() {
    const el = $('#view');
    if (!el) return;
    el.innerHTML = `
      <div class="empty" style="margin-top:60px">
        <div class="empty-icon">${icon('alert', 30)}</div>
        <h3>应用服务不可用</h3>
        <p>${esc(S.loadError || '无法加载数据')}<br>请确认 anirss 服务进程仍在运行，然后重试。</p>
        <div class="empty-actions"><button class="btn btn-primary" data-action="refresh">${icon('refresh')}重新加载</button></div>
      </div>`;
  }

  /* ============================================================
   * 总览
   * ============================================================ */

  function viewOverview() {
    const d = S.data;
    const st = d.stats;
    const verified = !!((d.qb.lastTest && d.qb.lastTest.ok) || d.qb.verifiedAt);
    const heroTitle = st.subs > 0
      ? `${st.enabled || st.subs} 个追番正在自动守候`
      : '把 RSS 追番变成 qBittorrent 下载任务';
    const heroSub = st.subs > 0
      ? '新条目出现后按正则筛选，自动提交到 qBittorrent；保存路径、分类、标签均可按追番单独配置。'
      : '添加站点基础地址，拼出追番路径；用正则筛选标题，自动下载并归档到预设存储路径。';
    const recent = (d.downloads || []).slice(0, 6);
    const upcoming = d.subs
      .filter((s) => s.enabled)
      .sort((a, b) => (a.nextCheckAt || 0) - (b.nextCheckAt || 0))
      .slice(0, 5);

    return `
      <section class="hero">
        <div class="hero-main">
          <div class="hero-kicker"><span class="dot green"></span> RSS · FILTER · QBITTORRENT</div>
          <h1 class="hero-title">${esc(heroTitle)}</h1>
          <p class="hero-sub">${esc(heroSub)}</p>
          <div class="hero-actions">
            <button class="btn btn-primary btn-lg" data-action="open-sub">${icon('plus')}新增追番</button>
            <a class="btn btn-lg" href="#/library">${icon('folder')}站点与路径</a>
          </div>
        </div>
        <div class="hero-side">
          <div class="hero-metric">
            <strong>${fmtCount(st.downloadsToday)}</strong>
            <small>今日已提交</small>
          </div>
          <div class="hero-metric">
            <strong>${fmtCount(st.enabled)}</strong>
            <small>启用追番</small>
          </div>
        </div>
      </section>

      ${renderSetup(verified)}

      <section class="stats">
        ${statCard('rss', 'hue-blue', st.subs, '追番总数', `${st.enabled} 个启用`)}
        ${statCard('download', 'hue-green', st.downloadsToday, '今日提交', `累计 ${st.downloadsTotal}`)}
        ${statCard('clock', 'hue-amber', st.due, '待检查', '每 15 秒扫描一次')}
        ${statCard('alert', 'hue-red', st.failed, '失败记录', st.pending ? `${st.pending} 条提交中` : '可在下载记录重试')}
      </section>

      <div class="layout-2">
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">最近下载</div>
              <div class="card-sub">提交到 qBittorrent 的最新条目</div>
            </div>
            <a class="card-link" href="#/downloads">全部记录 ${icon('chevron-right')}</a>
          </div>
          <div class="card-body" style="padding-top:10px">
            ${recent.length ? `
              <div class="table-wrap">
                <table class="table recent-table">
                  <thead><tr><th>条目</th><th>时间</th><th>状态</th></tr></thead>
                  <tbody>${recent.map((x) => `
                    <tr>
                      <td><div class="t-title" title="${esc(x.title)}">${x.episodeLabel ? `<span class="chip accent t-ep">${esc(x.episodeLabel)}</span> ` : ''}${esc(x.title)}</div><div class="t-sub">${esc(x.savePath || 'qBittorrent 默认路径')}</div></td>
                      <td class="t-time">${relTime(x.createdAt)}</td>
                      <td>${downloadBadge(x.status)}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>` : `
              <div class="qb-empty">还没有下载记录。添加追番后，匹配到的新条目会自动出现在这里。</div>`}
          </div>
        </div>

        <div class="stack">
          ${qbCardHTML()}
          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">接下来</div>
                <div class="card-sub">按追番间隔自动检查</div>
              </div>
            </div>
            <div class="card-body" style="padding-top:10px">
              ${upcoming.length ? `<div class="next-list">${upcoming.map((s) => `
                <div class="next-item">
                  <span class="next-dot"></span>
                  <span class="next-name" title="${esc(s.name)}">${esc(s.name)}</span>
                  <span class="next-time">${untilTime(s.nextCheckAt)}</span>
                </div>`).join('')}</div>` : `<div class="qb-empty">暂无启用的追番</div>`}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderSetup(verified) {
    const d = S.data;
    const steps = [
      { done: verified, title: '连接 qBittorrent', desc: '填写 WebUI 地址和账号，确保能添加种子', action: 'open-connection', label: '去连接' },
      { done: d.bases.length > 0, title: '准备站点基础地址', desc: '例如 https://mikanime.tv，之后只需填路径', action: 'open-base', label: '添加站点' },
      { done: d.stats.subs > 0, title: '新增追番', desc: '站点 + 路径，配合包含/排除正则', action: 'open-sub', label: '新增追番' },
    ];
    if (steps.every((s) => s.done)) return '';
    return `
      <div class="card" style="margin-bottom:16px;border-color:rgba(56,182,255,.16)">
        <div class="card-head">
          <div>
            <div class="card-title">三步开始</div>
            <div class="card-sub">完成设置后，检查与下载会自动进行</div>
          </div>
          <span class="chip accent">${icon('zap')}自动化</span>
        </div>
        <div class="card-body" style="padding-top:6px">
          <div class="setup">
            ${steps.map((s, i) => `
              <div class="setup-item ${s.done ? 'done' : ''}">
                <span class="setup-num">${s.done ? icon('check', 13) : i + 1}</span>
                <div class="setup-main"><strong>${s.title}</strong><small>${s.desc}</small></div>
                ${s.done
                  ? '<span class="setup-state">已完成</span>'
                  : `<button class="btn btn-sm" data-action="${s.action}">${s.label}${icon('chevron-right')}</button>`}
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function statCard(iconName, hue, value, label, foot) {
    return `
      <div class="stat ${hue}">
        <div class="stat-top">
          <span class="stat-icon">${icon(iconName, 15)}</span>
          <span class="stat-foot">${esc(foot)}</span>
        </div>
        <div class="stat-value">${fmtCount(value)}</div>
        <div class="stat-label">${esc(label)}</div>
      </div>`;
  }

  function qbCardHTML() {
    const qb = S.data.qb;
    if (!qb.baseUrl) {
      return `
        <div class="card">
          <div class="card-body">
            <div class="qb-head">
              <span class="qb-logo">${icon('server')}</span>
              <div><div class="qb-name">qBittorrent</div><div class="qb-ver">尚未配置</div></div>
            </div>
            <div class="qb-empty">配置 WebUI 地址后即可自动提交种子。</div>
            <div style="text-align:center;margin-top:12px"><a class="btn btn-sm" href="#/connection">${icon('plug')}连接设置</a></div>
          </div>
        </div>`;
    }
    if (!qb.verifiedAt && !qb.lastTest) {
      return `
        <div class="card">
          <div class="card-body">
            <div class="qb-head">
              <span class="qb-logo" style="background:var(--amber-soft);color:var(--amber)">${icon('server')}</span>
              <div style="min-width:0;flex:1"><div class="qb-name">qBittorrent</div><div class="qb-ver">${esc(hostOf(qb.baseUrl))} · 尚未验证</div></div>
            </div>
            <div class="qb-empty">完成连接测试后，这里会显示 qBittorrent 版本、速度和活动任务。</div>
            <div style="text-align:center;margin-top:12px"><a class="btn btn-sm" href="#/connection">${icon('plug')}去连接</a></div>
          </div>
        </div>`;
    }
    const st = S.qbStatus;
    if (!st) {
      return `
        <div class="card">
          <div class="card-body">
            <div class="qb-head">
              <span class="qb-logo">${icon('server')}</span>
              <div><div class="qb-name">qBittorrent</div><div class="qb-ver">正在读取状态…</div></div>
            </div>
            <div class="qb-empty"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> 连接中</div>
          </div>
        </div>`;
    }
    if (!st.ok) {
      return `
        <div class="card">
          <div class="card-body">
            <div class="qb-head">
              <span class="qb-logo" style="background:var(--red-soft);color:var(--red)">${icon('server')}</span>
              <div><div class="qb-name">qBittorrent</div><div class="qb-ver">连接异常</div></div>
              <a class="card-link" style="margin-left:auto" href="#/connection">设置</a>
            </div>
            <div class="qb-error">${esc(st.error || '无法连接 qBittorrent')}</div>
            <div style="text-align:center;margin-top:12px"><a class="btn btn-sm" href="#/connection">${icon('plug')}检查连接</a></div>
          </div>
        </div>`;
    }
    const active = st.active || [];
    return `
      <div class="card">
        <div class="card-body">
          <div class="qb-head">
            <span class="qb-logo">${icon('server')}</span>
            <div style="min-width:0;flex:1">
              <div class="qb-name">qBittorrent</div>
              <div class="qb-ver">${esc(st.version || '')} · WebAPI ${esc(st.webapi || '—')}</div>
            </div>
            <a class="icon-btn" href="${esc(safeUrl(qb.baseUrl))}" target="_blank" rel="noopener" title="打开 qBittorrent WebUI">${icon('external')}</a>
          </div>
          <div class="speed-row">
            <div class="speed down"><small>DOWNLOAD</small><strong>${fmtSpeed(st.dlSpeed || 0)}</strong></div>
            <div class="speed up"><small>UPLOAD</small><strong>${fmtSpeed(st.upSpeed || 0)}</strong></div>
          </div>
          ${active.length ? active.slice(0, 3).map((t) => `
            <div class="torrent">
              <div class="torrent-top">
                <span class="torrent-name" title="${esc(t.name)}">${esc(t.name)}</span>
                <span class="torrent-meta">${Math.round((t.progress || 0) * 100)}% · ${fmtSpeed(t.dlspeed || 0)}</span>
              </div>
              <div class="bar"><div class="bar-inner" style="width:${Math.min(100, Math.max(0, (t.progress || 0) * 100))}%"></div></div>
            </div>`).join('') : `<div class="qb-empty">当前没有正在下载的任务</div>`}
        </div>
      </div>`;
  }

  function downloadBadge(status) {
    const map = {
      ok: ['green', '已提交'],
      failed: ['red', '失败'],
      pending: ['blue', '提交中'],
      duplicate: ['gray', '重复跳过'],
    };
    const item = map[status] || ['gray', status || '未知'];
    return `<span class="badge ${item[0]}">${item[1]}</span>`;
  }

  /* ============================================================
   * 追番列表
   * ============================================================ */

  function viewSubs() {
    const d = S.data;
    const filters = [
      { key: 'all', label: '全部', count: d.subs.length },
      { key: 'enabled', label: '已启用', count: d.subs.filter((s) => s.enabled).length },
      { key: 'paused', label: '已暂停', count: d.subs.filter((s) => !s.enabled).length },
      { key: 'error', label: '异常', count: d.subs.filter((s) => s.lastCheck && !s.lastCheck.ok).length },
    ];
    let list = d.subs;
    if (S.subFilter === 'enabled') list = list.filter((s) => s.enabled);
    else if (S.subFilter === 'paused') list = list.filter((s) => !s.enabled);
    else if (S.subFilter === 'error') list = list.filter((s) => s.lastCheck && !s.lastCheck.ok);

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">追番</h1>
          <p class="page-sub">一个追番 = 一个 RSS 地址 + 一组正则规则 + 一个存储路径</p>
        </div>
        <div class="page-actions">
          <button class="btn" data-action="open-search">${icon('search')}搜索番剧</button>
          <button class="btn btn-primary" data-action="open-sub">${icon('plus')}新增追番</button>
        </div>
      </div>

      <div class="toolbar">
        <div class="filters">
          ${filters.map((f) => `<button class="filter ${S.subFilter === f.key ? 'active' : ''}" data-action="filter-sub" data-filter="${f.key}">${f.label}${f.count ? ` <span class="faint">${f.count}</span>` : ''}</button>`).join('')}
        </div>
        <div class="toolbar-right">
          <div class="view-switch">
            <button class="view-btn ${S.subView === 'grid' ? '' : 'active'}" type="button" data-action="sub-view" data-view="list" title="列表视图">${icon('list', 15)}</button>
            <button class="view-btn ${S.subView === 'grid' ? 'active' : ''}" type="button" data-action="sub-view" data-view="grid" title="封面视图">${icon('grid', 15)}</button>
          </div>
          <div class="small faint">共 ${d.subs.length} 个追番 · ${d.stats.due} 个等待检查</div>
        </div>
      </div>

      ${d.subs.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">${icon('rss', 30)}</div>
          <h3>还没有追番</h3>
          <p>先在「站点与路径」里准备基础地址，然后选择站点、填写路径和正则。创建时只会记录现有条目，之后自动下载新增匹配项。</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-action="open-sub">${icon('plus')}新增追番</button>
            <button class="btn" data-action="open-search">${icon('search')}搜索番剧</button>
            <button class="btn" data-action="open-example">${icon('zap')}填入 Mikan 示例</button>
            <a class="btn btn-ghost" href="#/library">${icon('server')}管理站点</a>
          </div>
        </div>` : list.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">${icon('search', 28)}</div>
          <h3>没有符合筛选的追番</h3>
          <p>换一个筛选条件，或者新增追番。</p>
          <div class="empty-actions"><button class="btn" data-action="filter-sub" data-filter="all">查看全部</button></div>
        </div>` : `
        ${S.subView === 'grid'
          ? `<div class="sub-grid">${list.map(subTileHTML).join('')}</div>`
          : `<div class="sub-list">${list.map(subCardHTML).join('')}</div>`}`}`;
  }

  function subTileHTML(s) {
    const meta = s.meta || {};
    const hasError = !!(s.lastCheck && s.lastCheck.ok === false);
    const checking = s.checking || s.queued;
    const id = esc(s.id);
    const cover = meta.hasCover
      ? `<img class="tile-cover" src="${API}cover/${encodeURIComponent(s.id)}" alt="" loading="lazy" onerror="this.remove()">`
      : `<div class="tile-cover tile-cover-empty">${icon('rss', 30)}<span>${esc((meta.title || s.name).slice(0, 10))}</span></div>`;
    const chips = [
      meta.airWeekday ? `<span class="chip">${icon('clock')}${esc(meta.airWeekday)}</span>` : '',
      meta.episodes ? `<span class="chip">全 ${esc(meta.episodes)} 话</span>` : '',
      s.totalDownloads ? `<span class="chip">${icon('download')}${fmtCount(s.totalDownloads)}</span>` : '',
    ].filter(Boolean).join('');
    const links = [
      meta.homeUrl ? `<a href="${esc(safeUrl(meta.homeUrl))}" target="_blank" rel="noopener">${icon('external', 11)}主页</a>` : '',
      meta.bgmUrl ? `<a href="${esc(safeUrl(meta.bgmUrl))}" target="_blank" rel="noopener">${icon('external', 11)}Bangumi</a>` : '',
    ].filter(Boolean).join('');
    return `
      <article class="sub-tile ${s.enabled ? '' : 'disabled'} ${hasError ? 'has-error' : ''}" data-key="${id}" data-action="preview-sub" data-id="${id}" title="${esc(s.name)}">
        <div class="tile-cover-wrap">
          ${cover}
          <div class="tile-badges">
            ${s.enabled ? '' : '<span class="badge gray">已暂停</span>'}
            ${checking ? '<span class="badge blue">检查中</span>' : ''}
            ${hasError ? '<span class="badge red">异常</span>' : ''}
            ${s.needsSeed ? '<span class="chip amber">待初始化</span>' : ''}
          </div>
          <div class="tile-actions">
            <button class="icon-btn tile-toggle ${s.enabled ? '' : 'off'}" type="button" data-action="toggle-sub" data-id="${id}" title="${s.enabled ? '暂停自动检查' : '启用自动检查'}" aria-label="${s.enabled ? '暂停' : '启用'}">${icon('power', 15)}</button>
            <button class="icon-btn" type="button" data-action="check-sub" data-id="${id}" title="立即检查并下载" ${checking ? 'disabled' : ''}>${icon('refresh', 15)}</button>
            <button class="icon-btn" type="button" data-action="edit-sub" data-id="${id}" title="编辑">${icon('edit', 15)}</button>
            <button class="icon-btn danger" type="button" data-action="delete-sub" data-id="${id}" title="删除追番">${icon('trash', 15)}</button>
          </div>
        </div>
        <div class="tile-body">
          <div class="tile-name">${esc(meta.title || s.name)}</div>
          ${chips ? `<div class="tile-meta">${chips}</div>` : ''}
          <div class="tile-foot">
            ${links}
            <span class="tile-time">${s.lastCheck ? relTime(s.lastCheck.at) : '尚未检查'}</span>
          </div>
        </div>
      </article>`;
  }

  function subCardHTML(s) {
    const includeCount = ruleCount(s.include);
    const excludeCount = ruleCount(s.exclude);
    const hasError = !!(s.lastCheck && s.lastCheck.ok === false);
    const checking = s.checking || s.queued;
    const lastOk = s.lastCheck && s.lastCheck.ok;
    const meta = s.meta || {};
    const cover = meta.hasCover
      ? `<img class="sub-cover" src="${API}cover/${encodeURIComponent(s.id)}" alt="" loading="lazy" onerror="this.remove()">`
      : icon('rss');
    const links = (meta.homeUrl || meta.bgmUrl) ? `<div class="sub-links">
        ${meta.homeUrl ? `<a href="${esc(safeUrl(meta.homeUrl))}" target="_blank" rel="noopener">${icon('external', 12)}主页</a>` : ''}
        ${meta.bgmUrl ? `<a href="${esc(safeUrl(meta.bgmUrl))}" target="_blank" rel="noopener">${icon('external', 12)}Bangumi</a>` : ''}
      </div>` : '';
    return `
      <article class="sub-card ${s.enabled ? '' : 'disabled'} ${hasError ? 'has-error' : ''}" data-key="${esc(s.id)}">
        <div class="sub-head">
          <div class="sub-status ${meta.hasCover ? 'has-cover' : ''}">${cover}</div>
          <div class="sub-main">
            <div class="sub-title-row">
              <span class="sub-name">${esc(s.name)}</span>
              ${s.enabled ? '' : '<span class="badge gray">已暂停</span>'}
              ${checking ? '<span class="badge blue">检查中</span>' : ''}
              ${s.needsSeed ? '<span class="chip amber">待初始化</span>' : ''}
              ${meta.airWeekday ? `<span class="chip">${icon('clock')}${esc(meta.airWeekday)}</span>` : ''}
            </div>
            <div class="sub-url" title="${esc(s.url)}">${icon('link')}<span>${esc(s.url)}</span></div>
            ${links}
            <div class="sub-meta">
              ${includeCount ? `<span class="chip accent">${icon('filter')}包含 ${includeCount}</span>` : '<span class="chip muted">全部条目</span>'}
              ${excludeCount ? `<span class="chip red">排除 ${excludeCount}</span>` : ''}
              <span class="chip">${icon('folder')}${esc(s.savePath || 'qB 默认路径')}</span>
              <span class="chip">${icon('clock')}每 ${s.intervalMin} 分钟</span>
              ${s.category ? `<span class="chip purple">${esc(s.category)}</span>` : ''}
              ${s.tags ? `<span class="chip">${icon('tag')}${esc(s.tags)}</span>` : ''}
            </div>
          </div>
          <div class="sub-actions">
            <button class="switch ${s.enabled ? 'on' : ''}" type="button" data-action="toggle-sub" data-id="${esc(s.id)}" title="${s.enabled ? '暂停自动检查' : '启用自动检查'}" aria-label="${s.enabled ? '暂停' : '启用'}"></button>
            <button class="icon-btn" type="button" data-action="preview-sub" data-id="${esc(s.id)}" title="预览条目">${icon('eye')}</button>
            <button class="icon-btn" type="button" data-action="check-sub" data-id="${esc(s.id)}" title="立即检查并下载" ${checking ? 'disabled' : ''}>${icon('refresh')}</button>
            ${(meta.homeUrl || /bangumiId=\d+/i.test(s.url)) ? `<button class="icon-btn" type="button" data-action="refresh-meta" data-id="${esc(s.id)}" title="刷新封面/番组信息">${icon('image')}</button>` : ''}
            <button class="icon-btn" type="button" data-action="edit-sub" data-id="${esc(s.id)}" title="编辑">${icon('edit')}</button>
            <button class="icon-btn danger" type="button" data-action="delete-sub" data-id="${esc(s.id)}" title="删除">${icon('trash')}</button>
          </div>
        </div>
        <div class="sub-foot">
          <span>上次检查 <strong>${s.lastCheck ? relTime(s.lastCheck.at) : '尚未'}</strong></span>
          <span>下次 <strong>${s.enabled ? untilTime(s.nextCheckAt) : '已暂停'}</strong></span>
          <span>已见 <strong>${fmtCount(s.seenCount)}</strong></span>
          <span>累计下载 <strong>${fmtCount(s.totalDownloads)}</strong></span>
          ${lastOk ? `<span>上次新增 <strong>${fmtCount(s.lastCheck.newCount)}</strong> · 提交 <strong>${fmtCount(s.lastCheck.downloaded)}</strong></span>` : ''}
          <button class="sub-link" type="button" data-action="download-existing" data-id="${esc(s.id)}">补下现有</button>
        </div>
        ${hasError ? `<div class="sub-error">${icon('alert', 12)} ${esc(s.lastCheck.error || '检查失败')}</div>` : ''}
        ${s.needsSeed ? '<div class="sub-error amber">首次成功检查只记录现有条目，不会下载历史内容。之后才会自动下载新增匹配项。</div>' : ''}
      </article>`;
  }

  /* ============================================================
   * 下载记录
   * ============================================================ */

  /* ============================================================
   * 补番：磁力 / 种子单次下载
   * ============================================================ */

  function pathTemplatePanelHTML() {
    const t = S.subTemplate;
    const name = t ? esc(t.name) : '';
    const raw = t
      ? `模板 <code>${esc(t.template)}</code>${t.parsed.count ? ` · 共 ${t.parsed.count} 个空` : ''}${t.parsed.hasName ? ` · <code>${'${name}'}</code> 使用追番名称` : ''}`
      : '';
    const vars = t
      ? t.parsed.indices.map((idx) => `
          <label class="template-var">
            <span>变量 ${idx}</span>
            <input class="input" type="text" data-template-var="${idx}" value="${esc(t.values[idx] || '')}" placeholder="填写第 ${idx} 个空" autocomplete="off" spellcheck="false">
          </label>`).join('')
      : '';
    return `
      <div class="path-template ${t ? '' : 'hidden'}" id="path-template">
        <div class="template-head">
          <span class="template-name" id="path-template-name">${name}</span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-ghost" type="button" data-action="path-template-custom">改为自定义</button>
        </div>
        <div class="template-raw small faint" id="path-template-raw">${raw}</div>
        <div class="template-vars" id="path-template-vars">${vars}</div>
      </div>`;
  }

  function qbStateText(state) {
    const map = {
      downloading: '下载中',
      stalledDL: '等待下载',
      metaDL: '获取元数据',
      forcedDL: '下载中',
      uploading: '做种中',
      stalledUP: '做种中',
      forcedUP: '做种中',
      pausedDL: '已暂停',
      pausedUP: '已暂停',
      stoppedDL: '已暂停',
      stoppedUP: '已暂停',
      queuedDL: '排队中',
      queuedUP: '排队中',
      checkingDL: '校验中',
      checkingUP: '校验中',
      checkingResumeData: '校验中',
      allocating: '分配空间',
      moving: '移动中',
      error: '出错',
      missingFiles: '文件缺失',
    };
    return map[state] || state || '已提交';
  }

  function qbStateBadge(state) {
    if (!state) return 'blue';
    if (/error|missing/i.test(state)) return 'red';
    if (/paused|stopped/i.test(state)) return 'gray';
    if (/upload|stall.*UP/i.test(state)) return 'green';
    return 'blue';
  }

  function etaText(eta) {
    const n = Number(eta);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n > 86400) return '>1 天';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    if (h) return `${h} 小时 ${m} 分`;
    if (m) return `${m} 分`;
    return `${n} 秒`;
  }

  function hardlinkRowHTML(x) {
    const h = x.hardlink;
    if (!h || !h.dest) return '';
    const target = h.destResolved || h.dest;
    if (h.enabled === false) {
      return `<div class="extra-hl"><span class="extra-hl-path" title="${esc(target)}">${esc(target)}</span><span class="extra-hl-state">本次不硬链接（已关闭）</span></div>`;
    }
    const progress = Number(x.qb && x.qb.progress) || 0;
    let cls = '';
    let state = '';
    if (h.done) {
      const bits = [];
      if (h.videos || h.subs) {
        const counts = [];
        if (h.videos) counts.push(`${h.videos} 集`);
        if (h.subs) counts.push(`${h.subs} 字幕`);
        bits.push(counts.join(' + '));
        if (h.linked) bits.push(`新增 ${h.linked}`);
        if (h.existed) bits.push(`已有 ${h.existed}`);
      } else {
        if (h.linked) bits.push(`已链接 ${h.linked} 个文件`);
        if (h.existed) bits.push(`${h.existed} 个已存在`);
      }
      if (h.rename) bits.push('已重命名');
      if (h.conflicts) bits.push(`${h.conflicts} 个被占用`);
      if (h.skipped) bits.push(`跳过 ${h.skipped} 个非正片`);
      if (h.error) {
        cls = 'warn';
        state = h.error;
      } else {
        cls = h.linked || h.existed ? 'ok' : '';
        state = bits.join('，') || '没有需要链接的文件';
      }
    } else if (h.error && !/等待下载完成/.test(h.error)) {
      cls = 'bad';
      state = h.error;
    } else if (progress >= 0.9999) {
      state = '下载完成，准备硬链接…';
    } else {
      state = `等待下载完成${progress > 0 ? `（${Math.round(progress * 100)}%）` : ''}`;
    }
    return `<div class="extra-hl ${cls}">${icon('link', 12)}<span class="extra-hl-path" title="${esc(target)}">${esc(target)}</span><span class="extra-hl-state">${esc(state)}</span></div>`;
  }

  function extraCardHTML(x) {
    const qb = x.qb;
    const pct = qb ? Math.max(0, Math.min(100, Math.round((qb.progress || 0) * 100))) : 0;
    const meta = [];
    meta.push(`<span class="chip">${icon('folder')}${esc(x.savePath || 'qB 默认路径')}</span>`);
    if (x.category) meta.push(`<span class="chip purple">${esc(x.category)}</span>`);
    if (x.tags) meta.push(`<span class="chip">${icon('tag')}${esc(x.tags)}</span>`);
    meta.push(`<span class="chip">${icon('clock')}${relTime(x.createdAt)}</span>`);
    if (qb) {
      meta.push(`<span class="chip">${fmtBytes(qb.size || 0)}${qb.dlspeed ? ` · ${fmtBytes(qb.dlspeed)}/s` : ''}</span>`);
      if (qb.state && /download/i.test(qb.state)) meta.push(`<span class="chip">剩余 ${etaText(qb.eta)}</span>`);
    }
    return `
      <article class="extra-card ${x.ok ? '' : 'failed'}" data-key="${esc(x.id)}">
        <div class="extra-main">
          <div class="extra-title-row">
            <span class="extra-name" title="${esc(x.name)}">${esc(x.name)}</span>
            <span class="badge ${x.source === 'file' ? 'blue' : 'purple'}">${x.source === 'file' ? '种子文件' : '磁力链接'}</span>
            ${x.paused ? '<span class="badge gray">暂停</span>' : ''}
            ${x.episodeLabel ? `<span class="chip accent">${esc(x.episodeLabel)}</span>` : ''}
            ${x.ok
              ? `<span class="badge ${qbStateBadge(qb && qb.state)}">${esc(qbStateText(qb && qb.state))}</span>`
              : '<span class="badge red">提交失败</span>'}
          </div>
          <div class="extra-meta">${meta.join('')}</div>
          ${x.ok && qb ? `<div class="progress"><span style="width:${pct}%"></span></div>` : ''}
          ${hardlinkRowHTML(x)}
          ${x.error ? `<div class="sub-error">${icon('alert', 12)} ${esc(x.error)}</div>` : ''}
        </div>
        <div class="extra-actions">
          ${x.hardlink && x.hardlink.dest ? `<button class="icon-btn" type="button" data-action="extra-hardlink-edit" data-id="${esc(x.id)}" title="修改硬链接">${icon('edit')}</button>` : ''}
          ${x.hardlink && x.hardlink.dest && x.hardlink.enabled !== false ? `<button class="icon-btn" type="button" data-action="extra-hardlink" data-id="${esc(x.id)}" title="立即硬链接">${icon('link')}</button>` : ''}
          <button class="icon-btn" type="button" data-action="extra-copy" data-id="${esc(x.id)}" title="复制磁力链接">${icon('copy')}</button>
          <button class="icon-btn" type="button" data-action="extra-delete" data-id="${esc(x.id)}" title="只删除记录">${icon('trash')}</button>
          <button class="icon-btn danger" type="button" data-action="extra-delete-torrent" data-id="${esc(x.id)}" title="删除 qB 任务（含文件）">${icon('x')}</button>
        </div>
      </article>`;
  }

  function viewExtras() {
    const d = S.data;
    const extras = d.extras || [];
    const qbOk = !!(d.qb && d.qb.lastTest && d.qb.lastTest.ok);
    const hp = hardlinkPreviewState();
    const hl = d.hardlink || {
      mode: 'season', videoExts: '', subExts: '', excludeDirs: '', excludeTags: '',
      includeFonts: false, stripRoot: false, renamePattern: '${name} - ${episode2}', defaultDest: '',
    };
    const presetOptions = [
      '<option value="">自定义 / qBittorrent 默认路径</option>',
      ...d.paths.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.path)}</option>`),
    ].join('');
    // 硬链接目标直接复用「站点与路径」的预设
    const hardlinkPresetOptions = [
      '<option value="">自定义 / 不选预设</option>',
      ...d.paths.map((p) => `<option value="${esc(p.id)}" data-path="${esc(p.path)}">${esc(p.name)} — ${esc(p.path)}</option>`),
    ].join('');
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">补番</h1>
          <p class="page-sub">磁力链接或种子文件，单次下载；与追番共用同一套存储路径预设</p>
        </div>
        <div class="page-actions">
          <button class="btn" data-action="extras-status">${icon('refresh')}刷新状态</button>
        </div>
      </div>

      ${qbOk ? '' : `<div class="notice amber">${icon('alert')}<div>还没有成功连接 qBittorrent，补番任务可能提交失败；先到「连接设置」测试连接。</div></div>`}

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">集数识别</div>
            <div class="card-sub">从文件名 / 种子名 / 磁力名猜集数，支持 [12]、- 12、第 12 集、EP12、01-12 合集等写法</div>
          </div>
        </div>
        <div class="card-body">
          <form id="guess-form" class="form" autocomplete="off">
            <div class="field">
              <label class="field-label" for="guess-text">文件名 / 磁力名 <span class="tip">每行一条，最多 50 条</span></label>
              <textarea class="input mono" id="guess-text" rows="2" placeholder="[LoliHouse] 某番剧 - 07 [WebRip 1080p HEVC-10bit AAC][简繁内封]" spellcheck="false"></textarea>
            </div>
            <div class="btn-row">
              <button class="btn" type="submit">${icon('search')}识别集数</button>
              <span class="small faint">只在本机做字符串解析，不联网</span>
            </div>
          </form>
          <div id="guess-result">${guessResultHTML()}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">新增补番</div>
            <div class="card-sub">支持批量：磁力链接每行一条，种子文件可多选</div>
          </div>
        </div>
        <div class="card-body">
          <form id="extra-form" class="form" autocomplete="off">
            <div class="form-grid">
              <div class="field full">
                <label class="field-label" for="x-magnets">磁力链接</label>
                <textarea class="input mono" id="x-magnets" rows="3" placeholder="magnet:?xt=urn:btih:…&#10;每行一条，可留空只用种子文件" spellcheck="false"></textarea>
              </div>
              <div class="field full">
                <label class="field-label" for="x-files">种子文件 <span class="tip">可多选，单个 ≤ 8MB</span></label>
                <input class="input" id="x-files" type="file" accept=".torrent,application/x-bittorrent" multiple>
              </div>
              <div class="field">
                <label class="field-label" for="f-name">名称 <span class="tip">可选</span></label>
                <input class="input" id="f-name" placeholder="留空自动用磁力或种子文件名" maxlength="120">
                <div class="field-hint" id="f-name-hint">留空时使用磁力链接里的 dn 或种子文件名</div>
              </div>
              <div class="field">
                <label class="field-label" for="x-category">分类 <span class="tip">可选</span></label>
                <input class="input" id="x-category" placeholder="例如 anime">
              </div>
              <div class="field">
                <label class="field-label" for="x-tags">标签 <span class="tip">可选</span></label>
                <input class="input" id="x-tags" placeholder="逗号分隔">
              </div>
              <div class="field">
                <label class="field-label" for="f-path-preset">存储路径预设</label>
                <select class="select" id="f-path-preset">${presetOptions}</select>
              </div>
              <div class="field full">
                <label class="field-label" for="f-savepath">最终保存路径</label>
                <input class="input mono" id="f-savepath" placeholder="留空 = qBittorrent 默认路径" spellcheck="false">
                <div class="field-hint">与追番共用预设；支持 <code>${'${name}'}</code>（名称）与数字变量。</div>
              </div>
              <div class="field full">
                <label class="field-label" for="h-dest">硬链接到 <span class="tip">可选 · 下载完成后自动执行</span></label>
                <div class="inline-row">
                  <select class="select" id="h-path-preset" aria-label="硬链接目录预设">${hardlinkPresetOptions}</select>
                  <input class="input mono" id="h-dest" placeholder="留空 = 不硬链接；可用 ${'${name}'} / ${'${season}'}，例如 /pathb/动画/${'${name}'}/Season ${'${season}'}" spellcheck="false">
                  <input class="input h-season" id="h-season" type="number" min="0" max="999" step="1" value="1" aria-label="季" title="季">
                </div>
                <div class="field-hint">目标可直接选「站点与路径」里的预设；变量 <code>${'${name}'}</code>（名称）、<code>${'${season}'}</code>（季），预设里的数字变量依次按名称、季填充。</div>
                <div class="field-hint${hp.bad ? ' bad' : ''}" id="h-dest-preview">${esc(hp.text)}</div>
                <div class="field-hint">
                  <button class="btn btn-ghost btn-sm" type="button" data-action="hardlink-probe">${icon('search', 12)}检查目录权限</button>
                </div>
                <div class="field full">
                  <label class="check"><input type="checkbox" id="h-enabled" checked><span><strong>下载完成后硬链接</strong><span class="check-hint">这次不想硬链接就取消；目标模板会保留，之后可再打开</span></span></label>
                </div>
                <div class="field full">
                  <label class="check"><input type="checkbox" id="h-rename"><span><strong>按集数重命名</strong><span class="check-hint">用设置里的模板生成「名称 - 集数」；字幕会按目标集数自动改成与视频同名</span></span></label>
                </div>
                <div class="field">
                  <label class="field-label" for="h-voffset">视频集数偏移</label>
                  <input class="input" id="h-voffset" type="number" min="-999" max="999" step="1" value="0">
                  <div class="field-hint">下载是 01–12、目标是 13–24 → 填 +12</div>
                </div>
                <div class="field">
                  <label class="field-label" for="h-soffset">字幕集数偏移</label>
                  <input class="input" id="h-soffset" type="number" min="-999" max="999" step="1" value="0">
                  <div class="field-hint">字幕本身是 13–24 → 保持 0，会按目标集数和视频配对</div>
                </div>
              </div>
            </div>
            ${pathTemplatePanelHTML()}
            <label class="check"><input type="checkbox" id="x-paused"><span><strong>添加后暂停</strong><span class="check-hint">先不开始下载，之后可在 qBittorrent 里手动开始</span></span></label>
            <div class="btn-row">
              <button class="btn btn-primary" type="submit">${icon('magnet')}添加到 qBittorrent</button>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">硬链接设置</div>
            <div class="card-sub">补番下载完成后自动把匹配的文件硬链接到目标目录，源文件保留继续做种</div>
          </div>
        </div>
        <div class="card-body">
          <form id="hardlink-form" class="form" autocomplete="off">
            <div class="form-grid">
              <div class="field">
                <label class="field-label" for="hl-mode">链接内容</label>
                <select class="select" id="hl-mode">
                  <option value="season" ${hl.mode === 'mirror' ? '' : 'selected'}>正片 + 字幕（平铺到季目录）</option>
                  <option value="mirror" ${hl.mode === 'mirror' ? 'selected' : ''}>全部文件（保持种子内相对路径）</option>
                </select>
                <div class="field-hint">推荐「正片 + 字幕」：自动跳过 CDs、Scans、NCOP 等</div>
              </div>
              <div class="field">
                <label class="field-label" for="hl-default-dest">默认目标模板 <span class="tip">可选</span></label>
                <input class="input mono" id="hl-default-dest" value="${esc(hl.defaultDest)}" placeholder="/pathb/动画/${'${name}'}/Season ${'${season}'}" spellcheck="false">
                <div class="field-hint">新增补番时自动填到「硬链接到」，也可以直接选路径预设</div>
              </div>
              <div class="field">
                <label class="field-label" for="hl-video-exts">视频扩展名</label>
                <input class="input mono" id="hl-video-exts" value="${esc(hl.videoExts)}" placeholder="mkv,mp4,ts" spellcheck="false">
              </div>
              <div class="field">
                <label class="field-label" for="hl-sub-exts">字幕扩展名</label>
                <input class="input mono" id="hl-sub-exts" value="${esc(hl.subExts)}" placeholder="ass,srt,ssa" spellcheck="false">
                <div class="field-hint">同名字幕、或同集数字幕（含 subs/ 目录）会一起链接</div>
              </div>
              <div class="field">
                <label class="field-label" for="hl-rename-pattern">重命名模板 <span class="tip">勾选「按集数重命名」时使用</span></label>
                <input class="input mono" id="hl-rename-pattern" value="${esc(hl.renamePattern || '${name} - ${episode2}')}" placeholder="${'${name}'} - ${'${episode2}'}" spellcheck="false">
                <div class="field-hint">变量：<code>${'${name}'}</code>、<code>${'${episode}'}</code>（13）、<code>${'${episode2}'}</code>（补零两位）、<code>${'${season}'}</code>；扩展名会自动保留</div>
              </div>
              <div class="field full">
                <label class="field-label" for="hl-exclude-dirs">排除目录 <span class="tip">目录名整段匹配</span></label>
                <input class="input mono" id="hl-exclude-dirs" value="${esc(hl.excludeDirs)}" spellcheck="false">
              </div>
              <div class="field full">
                <label class="field-label" for="hl-exclude-tags">排除标签 <span class="tip">文件名方括号里的整词，如 NCOP / SP01</span></label>
                <input class="input mono" id="hl-exclude-tags" value="${esc(hl.excludeTags)}" spellcheck="false">
              </div>
              <div class="field full">
                <label class="check"><input type="checkbox" id="hl-fonts" ${hl.includeFonts ? 'checked' : ''}><span><strong>连同字体</strong><span class="check-hint">把种子里 fonts/ 下的字体链到「目标/fonts/」，字幕需要字体时勾选</span></span></label>
              </div>
              <div class="field full">
                <label class="check"><input type="checkbox" id="hl-strip" ${hl.stripRoot ? 'checked' : ''}><span><strong>「全部文件」模式去掉种子顶层目录</strong><span class="check-hint">仅当链接内容选「全部文件」时生效</span></span></label>
              </div>
              <div class="field full">
                <div class="field-hint">首次使用请到 fnOS「应用设置 → 访问权限」把 qBittorrent 的下载目录和这里的硬链接目录都加进来（选「读写」），两个目录要在同一存储空间，否则会提示没有权限或无法跨分区。</div>
              </div>
            </div>
            <div class="btn-row">
              <button class="btn" type="submit">${icon('check')}保存硬链接设置</button>
            </div>
          </form>
        </div>
      </div>

      <div class="section-head">
        <h2>补番记录</h2>
        <span class="small faint">共 ${extras.length} 条</span>
      </div>
      ${extras.length
        ? `<div class="extra-list">${extras.map(extraCardHTML).join('')}</div>`
        : '<div class="qb-empty">还没有补番记录。粘贴磁力链接或选择 .torrent 文件即可单次下载。</div>'}`;
  }

  function guessResultHTML() {
    const r = S.guessResult;
    if (!r) return '';
    if (!r.results || !r.results.length) return '<div class="qb-empty">没有可识别的文本</div>';
    return `<div class="guess-list">${r.results.map((x) => `
      <div class="guess-row">
        <span class="guess-label ${x.kind === 'single' ? 'ok' : (x.kind ? 'special' : 'none')}">${esc(x.label)}</span>
        <span class="guess-text" title="${esc(x.input)}">${esc(x.input)}</span>
        ${x.source ? `<span class="small faint guess-src">命中「${esc(x.source)}」</span>` : ''}
      </div>`).join('')}</div>`;
  }

  async function runGuess(form) {
    const text = $('#guess-text', form)?.value.trim() || '';
    if (!text) {
      toast('请粘贴文件名、种子名或磁力名', 'warn');
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      try {
        const r = await api('guess-episode', { method: 'POST', body: { text } });
        S.guessResult = r;
        const box = $('#guess-result');
        if (box) box.innerHTML = guessResultHTML();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /** 前端版硬链接目标渲染：${name} / ${season}，以及预设里的数字变量（1=名称，其余=季） */
  function renderHardlinkDest(dest, name, season) {
    const raw = String(dest || '').trim();
    if (!raw) return '';
    const seasonText = Number(season) > 0 ? String(Math.trunc(Number(season))) : '';
    const show = name || '';
    let index = 0;
    return raw
      .replace(/\$?\{\{\s*name\s*\}\}|\$\{\s*name\s*\}/gi, show)
      .replace(/\$?\{\{\s*season\s*\}\}|\$\{\s*season\s*\}/gi, seasonText)
      .replace(/\$?\{\{\s*(\d*)\s*\}\}|\$\{\s*(\d+)\s*\}/g, () => {
        index += 1;
        return index === 1 ? show : seasonText;
      });
  }

  function hardlinkFormValues() {
    const form = $('#extra-form');
    if (!form) return null;
    return {
      dest: ($('#h-dest', form)?.value || '').trim(),
      season: Math.max(0, Math.trunc(Number($('#h-season', form)?.value) || 0)),
      name: ($('#f-name', form)?.value || '').trim(),
      enabled: !!$('#h-enabled', form)?.checked,
      rename: !!$('#h-rename', form)?.checked,
      videoOffset: Math.max(-999, Math.min(999, Math.trunc(Number($('#h-voffset', form)?.value) || 0))),
      subOffset: Math.max(-999, Math.min(999, Math.trunc(Number($('#h-soffset', form)?.value) || 0))),
    };
  }

  function hardlinkPreviewState() {
    const form = $('#extra-form');
    let dest = '';
    let name = '';
    let season = 1;
    if (form) {
      dest = ($('#h-dest', form)?.value || '').trim();
      name = ($('#f-name', form)?.value || '').trim();
      season = Math.max(0, Math.trunc(Number($('#h-season', form)?.value) || 0));
    }
    if (!dest) {
      return {
        text: '留空 = 下载完成后不硬链接；可以选择上面的路径预设，或用 ${name}/${season} 拼模板。',
        bad: false,
      };
    }
    const filled = renderHardlinkDest(dest, name || '〈名称〉', season);
    const left = /\$\{/.test(filled);
    const absolute = filled.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filled);
    return {
      text: `最终目录：${filled}${left ? '（还有未替换的变量）' : ''}`,
      bad: left || !absolute,
    };
  }

  function updateHardlinkPreview() {
    const el = $('#h-dest-preview');
    if (!el) return;
    const state = hardlinkPreviewState();
    el.textContent = state.text;
    el.classList.toggle('bad', state.bad);
  }

  async function probeHardlinkDest() {
    const v = hardlinkFormValues();
    if (!v || !v.dest) {
      toast('先填写硬链接目标目录', 'warn');
      return;
    }
    const target = renderHardlinkDest(v.dest, v.name || 'x', v.season);
    const el = $('#h-dest-preview');
    try {
      const r = await api('hardlink/probe?path=' + encodeURIComponent(target));
      const p = (r && r.probe) || {};
      const text = p.message || '检查完成';
      if (el) {
        el.textContent = text;
        el.classList.toggle('bad', !p.writable);
      }
      toast(text, p.writable ? 'success' : 'warn', '目录检查');
    } catch (e) {
      if (el) {
        el.textContent = e.message;
        el.classList.add('bad');
      }
      toast(e.message, 'error', '目录检查');
    }
  }

  function initExtrasForm() {
    const select = $('#f-path-preset');
    const input = $('#f-savepath');
    if (!select || !input) return;
    const paths = S.data.paths || [];
    // 硬链接目标：默认用设置里的默认模板，并同步预设下拉
    const hSelect = $('#h-path-preset');
    const hInput = $('#h-dest');
    const hSeason = $('#h-season');
    if (hSeason && !String(hSeason.value || '').trim()) hSeason.value = '1';
    if (hSelect && hInput) {
      if (!hInput.value.trim()) {
        const def = String((S.data.hardlink && S.data.hardlink.defaultDest) || '');
        if (def) hInput.value = def;
      }
      const matched = paths.find((p) => p.path === hInput.value.trim());
      hSelect.value = matched ? matched.id : '';
    }
    updateHardlinkPreview();
    const def = paths.find((p) => p.isDefault) || null;
    // 补番是一次性任务：默认优先用不带变量的预设，避免每次都填模板变量
    const plain = paths.filter((p) => {
      const parsed = parsePathTemplate(p.path);
      return !parsed.count && !parsed.hasName;
    });
    const preferred = (def && !parsePathTemplate(def.path).count && !parsePathTemplate(def.path).hasName)
      ? def
      : (plain[0] || def || null);
    if (!preferred) return;
    const parsed = parsePathTemplate(preferred.path);
    if (parsed.count || parsed.hasName) {
      applyPathPreset(preferred.id);
    } else {
      clearPathTemplate(true);
      select.value = preferred.id;
      input.value = preferred.path;
    }
  }

  /** 重绘后把「套用中的路径模板」接回来：面板、变量输入框与拼出的路径。 */
  function resumeExtrasForm(root) {
    const t = S.subTemplate;
    if (!t) return;
    const input = $('#f-savepath', root);
    if (input) input.readOnly = true;
    renderPathTemplate(root);
    const select = $('#f-path-preset', root);
    if (select) select.value = t.id;
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]+,/, ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  function extraSavePathFromForm(form) {
    const name = $('#f-name', form)?.value.trim() || '';
    let savePath = $('#f-savepath', form)?.value.trim() || '';
    if (S.subTemplate) {
      const missing = S.subTemplate.parsed.indices.find((idx) => !String(S.subTemplate.values[idx] || '').trim());
      if (missing) throw new Error(`请填写存储路径模板「${S.subTemplate.name}」的第 ${missing} 个空`);
      if (S.subTemplate.parsed.hasName && !sanitizePathName(name)) {
        throw new Error('存储路径模板使用了 ${name}，请先填写名称');
      }
      savePath = composePathTemplate(S.subTemplate.parsed, S.subTemplate.values, name).trim();
      if (hasNamePlaceholder(savePath)) {
        throw new Error('存储路径里还有 ${name}，请先填写名称');
      }
    } else {
      savePath = substituteNameInPath(savePath, name).trim();
    }
    return savePath;
  }

  async function submitExtras(form) {
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      const magnets = ($('#x-magnets', form)?.value || '')
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const files = Array.from($('#x-files', form)?.files || []);
      if (!magnets.length && !files.length) {
        toast('请粘贴磁力链接，或选择 .torrent 文件', 'warn');
        return;
      }
      const name = $('#f-name', form)?.value.trim() || '';
      let savePath;
      try {
        savePath = extraSavePathFromForm(form);
      } catch (e) {
        toast(e.message, 'warn');
        return;
      }
      const payload = {
        savePath,
        hardlinkDest: ($('#h-dest', form)?.value || '').trim(),
        season: Math.max(0, Math.trunc(Number($('#h-season', form)?.value) || 0)),
        hardlinkEnabled: !!$('#h-enabled', form)?.checked,
        rename: !!$('#h-rename', form)?.checked,
        videoOffset: Math.max(-999, Math.min(999, Math.trunc(Number($('#h-voffset', form)?.value) || 0))),
        subOffset: Math.max(-999, Math.min(999, Math.trunc(Number($('#h-soffset', form)?.value) || 0))),
        category: $('#x-category', form)?.value.trim() || '',
        tags: $('#x-tags', form)?.value.trim() || '',
        paused: !!$('#x-paused', form)?.checked,
      };
      let ok = 0;
      const errors = [];
      for (const magnet of magnets) {
        try {
          await api('extras', { method: 'POST', body: { ...payload, magnet, name: magnets.length === 1 ? name : '' } });
          ok++;
        } catch (e) {
          errors.push(`${magnet.slice(0, 40)}…：${e.message}`);
        }
      }
      for (const file of files) {
        try {
          const fileBase64 = await readFileBase64(file);
          await api('extras/upload', { method: 'POST', body: { ...payload, fileBase64, fileName: file.name, name: files.length === 1 ? name : '' } });
          ok++;
        } catch (e) {
          errors.push(`${file.name}：${e.message}`);
        }
      }
      if (ok) toast(`已提交 ${ok} 个补番任务`, 'success');
      if (errors.length) toast(errors.slice(0, 2).join('；'), 'error', `有 ${errors.length} 个失败`);
      // 全部成功才清空草稿：有失败时保留已填内容，方便改完重试
      if (ok && !errors.length) {
        S.viewDirty = false;
        delete S.drafts.extras;
      }
      await refresh();
      if (ok) await refreshExtrasStatus(null, true);
    });
  }

  async function refreshExtrasStatus(btn, silent) {
    const run = async () => {
      try {
        const r = await api('extras/status', { method: 'POST', body: {} });
        if (r && Array.isArray(r.extras)) {
          S.data.extras = r.extras;
          renderChrome();
          if (S.view === 'extras') softRenderView();
        }
        if (!silent) toast(r && r.error ? `刷新失败：${r.error}` : '补番状态已刷新', r && r.error ? 'error' : 'success');
      } catch (e) {
        if (!silent) toast(e.message, 'error');
      }
    };
    if (btn) await withBusy(btn, run);
    else await run();
  }

  async function deleteExtra(id, withTorrent) {
    const x = (S.data.extras || []).find((e) => e.id === id);
    if (!x) return;
    const keptLinks = x.hardlink && x.hardlink.dest && (x.hardlink.linked || x.hardlink.existed)
      ? `（已硬链接到「${x.hardlink.dest}」的文件不会被删除，仍会保留）`
      : '';
    const confirmed = await askConfirm({
      title: withTorrent ? '删除 qB 任务' : '删除补番记录',
      message: withTorrent
        ? `确定删除「${x.name}」的 qBittorrent 任务（包含已下载文件）并移除记录吗？${keptLinks}`
        : `只删除「${x.name}」的补番记录，qBittorrent 里的任务会保留。${keptLinks}`,
      confirmText: withTorrent ? '删除任务和文件' : '删除记录',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`extras/${encodeURIComponent(id)}${withTorrent ? '?deleteTorrent=1&deleteFiles=1' : ''}`, { method: 'DELETE' });
      toast(withTorrent ? '已删除 qB 任务和记录' : '已删除补番记录', 'success');
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveHardlinkSettings(form) {
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      const payload = {
        mode: $('#hl-mode', form)?.value === 'mirror' ? 'mirror' : 'season',
        videoExts: ($('#hl-video-exts', form)?.value || '').trim(),
        subExts: ($('#hl-sub-exts', form)?.value || '').trim(),
        excludeDirs: ($('#hl-exclude-dirs', form)?.value || '').trim(),
        excludeTags: ($('#hl-exclude-tags', form)?.value || '').trim(),
        includeFonts: !!$('#hl-fonts', form)?.checked,
        stripRoot: !!$('#hl-strip', form)?.checked,
        renamePattern: ($('#hl-rename-pattern', form)?.value || '').trim(),
        defaultDest: ($('#hl-default-dest', form)?.value || '').trim(),
      };
      try {
        const r = await api('hardlink', { method: 'PUT', body: payload });
        if (r && r.hardlink) S.data.hardlink = r.hardlink;
        toast('硬链接设置已保存', 'success');
        await refresh();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function linkExtraNow(id) {
    const x = (S.data.extras || []).find((e) => e.id === id);
    try {
      const r = await api(`extras/${encodeURIComponent(id)}/hardlink`, { method: 'POST', body: {} });
      const res = (r && r.result) || {};
      const bits = [];
      if (res.linked) bits.push(`新建 ${res.linked} 个`);
      if (res.existed) bits.push(`${res.existed} 个已存在`);
      if (res.conflicts) bits.push(`${res.conflicts} 个被占用`);
      const text = bits.length ? `硬链接完成：${bits.join('，')}` : (res.note || res.error || '硬链接完成');
      toast(text, res.ok ? 'success' : 'warn', x ? x.name : '');
    } catch (e) {
      toast(e.message, 'error');
    }
    await refresh();
  }

  async function editExtraHardlink(id) {
    const x = (S.data.extras || []).find((e) => e.id === id);
    if (!x) return;
    const h = x.hardlink || {};
    const values = await askForm({
      title: '修改硬链接',
      message: '留空目标 = 不再硬链接这条补番；已经链接过去的文件不会被删除。支持 ${name} / ${season} 变量。',
      fields: [
        {
          key: 'dest',
          label: '目标目录',
          value: h.dest || '',
          placeholder: '/pathb/动画/${name}/Season ${season}',
          mono: true,
        },
        {
          key: 'season',
          label: '季',
          value: String(h.season || 1),
          type: 'number',
          hint: '模板里的 ${season} 和预设的第 2 个数字变量会用它填充',
        },
        {
          key: 'enabled',
          label: '启用硬链接',
          type: 'check',
          value: h.enabled !== false,
          hint: '关闭后不再自动巡检，但目标模板会保留',
        },
        {
          key: 'rename',
          label: '按集数重命名',
          type: 'check',
          value: !!h.rename,
          hint: '视频和字幕会改成「名称 - 目标集数」并互相同名',
        },
        {
          key: 'videoOffset',
          label: '视频集数偏移',
          type: 'number',
          value: String(h.videoOffset || 0),
          hint: '例如下载 01–12、目标是 13–24，填 12',
        },
        {
          key: 'subOffset',
          label: '字幕集数偏移',
          type: 'number',
          value: String(h.subOffset || 0),
          hint: '字幕本身是 13–24 就填 0，会按目标集数和视频配对',
        },
      ],
      confirmText: '保存',
    });
    if (!values || typeof values !== 'object') return;
    const season = Math.max(0, Math.trunc(Number(values.season) || 0));
    const offset = (v) => Math.max(-999, Math.min(999, Math.trunc(Number(v) || 0)));
    try {
      await api(`extras/${encodeURIComponent(id)}/hardlink`, {
        method: 'PUT',
        body: {
          dest: values.dest,
          season,
          enabled: !!values.enabled,
          rename: !!values.rename,
          videoOffset: offset(values.videoOffset),
          subOffset: offset(values.subOffset),
        },
      });
      toast('硬链接设置已更新', 'success');
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ============================================================
   * 搜索番剧（站点搜索 → 选发布组 → 预填追番）
   * ============================================================ */

  function searchResultsHTML() {
    if (S.searchLoading) {
      return `<div class="qb-empty"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> 正在搜索站点…</div>`;
    }
    if (S.searchError) {
      return `<div class="notice red">${icon('alert')}<div>${esc(S.searchError)}</div></div>`;
    }
    const r = S.searchResult;
    if (!r) {
      return `<div class="qb-empty">输入番剧名后点「搜索」。搜索会读取站点公开页面，不会创建追番。</div>`;
    }
    if (!r.results.length) {
      return `<div class="qb-empty">没有找到匹配的番剧，换个关键词或到站点确认名字。</div>`;
    }
    return `
      <div class="search-summary small faint">搜索「${esc(r.query)}」：${r.results.length} 部番剧 / ${r.totalEpisodes} 条单集 · ${esc(r.baseName || '')}</div>
      <div class="search-list">
        ${r.results.map((g) => `
          <article class="search-hit">
            ${g.cover ? `<img class="search-cover" src="${API}image?url=${encodeURIComponent(g.cover)}" alt="" loading="lazy" onerror="this.remove()">` : '<div class="search-cover search-cover-empty"></div>'}
            <div class="search-main">
              <div class="search-title-row">
                <span class="search-title">${esc(g.title || `番剧 ${g.bangumiId}`)}</span>
                ${g.airWeekday ? `<span class="chip">${icon('clock')}${esc(g.airWeekday)}</span>` : ''}
                ${g.episodeTotal ? `<span class="chip">全 ${g.episodeTotal} 话</span>` : (g.episodes ? `<span class="chip">全 ${esc(g.episodes)} 话</span>` : '')}
                <span class="chip accent">本次匹配 ${g.matched || g.hitCount || 0} 条</span>
              </div>
              <div class="search-sub small faint">${esc(g.homeUrl || '')}</div>
              <div class="subgroup-list">
                ${g.subgroups.map((s) => `
                  <button class="subgroup-chip ${s.matched ? 'hit' : ''}" type="button"
                    data-action="pick-subgroup"
                    data-base="${esc(r.baseId)}"
                    data-bangumi="${esc(g.bangumiId)}"
                    data-subgroup="${esc(s.id)}"
                    data-title="${esc(g.title || '')}"
                    title="${esc([
                      s.episodeText ? `收录：第 ${s.episodeText} 集` : '',
                      s.matched ? `本次搜索匹配 ${s.matched} 条` : '',
                      s.countSource === 'rss' ? '集数按字幕组 RSS 统计' : (s.countSource ? '集数按番组主页统计' : ''),
                      s.batch ? '含合集' : '',
                      s.sampleTitle || s.rssUrl || '',
                    ].filter(Boolean).join(' · '))}">
                    <strong>${esc(s.name)}</strong>
                    <span>${s.episodeCount ? `全 ${s.episodeCount} 集` : (s.matched ? `匹配 ${s.matched} 条` : '全部')}</span>
                  </button>`).join('')}
              </div>
            </div>
          </article>`).join('')}
      </div>`;
  }

  function renderSearchResults() {
    const box = $('#search-results');
    if (box) box.innerHTML = searchResultsHTML();
  }

  function openSearchModal() {
    const d = S.data;
    if (!d.bases.length) {
      toast('请先在「站点与路径」添加站点基础地址', 'warn');
      return;
    }
    S.searchResult = null;
    S.searchError = '';
    S.searchLoading = false;
    const preferred = d.bases.find((b) => /mikan/i.test(b.url)) || d.bases[0];
    openModal(`
      <div class="modal-backdrop" data-backdrop="modal">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <div>
              <div class="modal-title">搜索番剧</div>
              <div class="modal-sub">在配置好的站点里搜索，选中发布组后自动填好追番表单</div>
            </div>
            <button class="icon-btn modal-close" data-action="close-modal">${icon('x')}</button>
          </div>
          <div class="modal-body">
            <form id="search-form" class="form" autocomplete="off">
              <div class="form-grid">
                <div class="field">
                  <label class="field-label" for="search-base">站点</label>
                  <select class="select" id="search-base">
                    ${d.bases.map((b) => `<option value="${esc(b.id)}" ${b.id === preferred.id ? 'selected' : ''}>${esc(b.name)} — ${esc(b.url)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="search-q">番剧名</label>
                  <input class="input" id="search-q" placeholder="例如：久留美" maxlength="60">
                </div>
              </div>
              <div class="btn-row">
                <button class="btn btn-primary" type="submit">${icon('search')}搜索</button>
                <span class="small faint">站点搜索需要该站点支持 Mikan 式搜索接口</span>
              </div>
            </form>
            <div id="search-results">${searchResultsHTML()}</div>
          </div>
        </div>
      </div>`, 'search');
    setTimeout(() => { const el = $('#search-q'); if (el) el.focus(); }, 50);
  }

  async function runSearch(form) {
    const q = $('#search-q', form)?.value.trim() || '';
    const baseId = $('#search-base', form)?.value || '';
    if (!q) {
      toast('请输入番剧名', 'warn');
      return;
    }
    S.searchLoading = true;
    S.searchError = '';
    renderSearchResults();
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      try {
        const r = await api(`search?q=${encodeURIComponent(q)}&baseId=${encodeURIComponent(baseId)}`);
        S.searchResult = r;
        S.searchLoading = false;
        renderSearchResults();
      } catch (e) {
        S.searchLoading = false;
        S.searchError = e.message;
        renderSearchResults();
      }
    });
  }

  function pickSubgroup(el) {
    const baseId = el.dataset.base || '';
    const bangumiId = el.dataset.bangumi || '';
    const subgroupId = el.dataset.subgroup || '';
    const title = el.dataset.title || '';
    if (!bangumiId || !subgroupId) return;
    closeModal();
    openSubModal(null, {
      prefill: {
        baseId,
        path: `RSS/Bangumi?bangumiId=${bangumiId}&subgroupid=${subgroupId}`,
        name: title,
      },
    });
    toast('已填好站点、路径和名称，确认正则与存储路径后创建即可', 'info', '下一步');
  }

  function viewDownloads() {
    const d = S.data;
    const all = d.downloads || [];
    let list = all;
    if (S.downloadFilter === 'ok') list = all.filter((x) => x.status === 'ok');
    else if (S.downloadFilter === 'failed') list = all.filter((x) => x.status === 'failed');
    else if (S.downloadFilter === 'pending') list = all.filter((x) => x.status === 'pending');
    const failed = all.filter((x) => x.status === 'failed').length;

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">下载记录</h1>
          <p class="page-sub">「已提交」表示 qBittorrent 已接受任务，实际下载进度请在 qBittorrent 查看</p>
        </div>
        <div class="page-actions">
          ${all.length ? `<button class="btn btn-danger" data-action="clear-downloads">${icon('trash')}清空记录</button>` : ''}
        </div>
      </div>

      <div class="toolbar">
        <div class="filters">
          <button class="filter ${S.downloadFilter === 'all' ? 'active' : ''}" data-action="filter-download" data-filter="all">全部 <span class="faint">${all.length}</span></button>
          <button class="filter ${S.downloadFilter === 'ok' ? 'active' : ''}" data-action="filter-download" data-filter="ok">已提交</button>
          <button class="filter ${S.downloadFilter === 'failed' ? 'active' : ''}" data-action="filter-download" data-filter="failed">失败 ${failed ? `<span class="faint">${failed}</span>` : ''}</button>
          <button class="filter ${S.downloadFilter === 'pending' ? 'active' : ''}" data-action="filter-download" data-filter="pending">提交中</button>
        </div>
        <div class="small faint">今日 ${d.stats.downloadsToday} 条 · 累计 ${d.stats.downloadsTotal} 条成功</div>
      </div>

      ${all.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">${icon('download', 30)}</div>
          <h3>还没有下载记录</h3>
          <p>追番检查到新匹配条目并成功提交后，会在这里留下记录。失败的条目可以手动重试。</p>
          <div class="empty-actions"><a class="btn btn-primary" href="#/subs">${icon('rss')}去管理追番</a></div>
        </div>` : list.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">${icon('search', 28)}</div>
          <h3>没有符合筛选的记录</h3>
          <p>换一个状态筛选看看。</p>
          <div class="empty-actions"><button class="btn" data-action="filter-download" data-filter="all">查看全部</button></div>
        </div>` : `
        <div class="card">
          <div class="card-body" style="padding:4px 0 0">
            <div class="table-wrap download-table">
              <table class="table">
                <thead><tr><th>条目</th><th>追番</th><th>存储路径</th><th>时间</th><th>状态</th><th class="t-actions">操作</th></tr></thead>
                <tbody>${list.map((x) => `
                  <tr data-key="${esc(x.id)}">
                    <td>
                      <div class="t-title" title="${esc(x.title)}">${x.episodeLabel ? `<span class="chip accent t-ep">${esc(x.episodeLabel)}</span> ` : ''}${esc(x.title)}</div>
                      ${x.error ? `<div class="t-sub" style="color:#e79aa5;max-width:420px">${esc(x.error)}</div>` : `<div class="t-sub">${esc(x.mode === 'magnet' ? '磁力链接' : x.mode === 'url' ? 'URL 提交' : '种子文件')}</div>`}
                    </td>
                    <td><span class="small muted">${esc(x.subName || '—')}</span></td>
                    <td><div class="cell-path" title="${esc(x.savePath || '')}">${esc(x.savePath || 'qB 默认')}</div></td>
                    <td class="t-time">${fmtDate(x.createdAt)}</td>
                    <td>${downloadBadge(x.status)}</td>
                    <td class="t-actions">
                      ${x.status === 'failed' ? `<button class="btn btn-sm" data-action="retry-download" data-id="${esc(x.id)}">${icon('refresh', 13)}重试</button>` : ''}
                      ${(x.status === 'ok' || x.status === 'duplicate') && x.dedupe !== false ? `<button class="btn btn-sm btn-ghost" data-action="allow-redownload" data-id="${esc(x.id)}" title="qB 里删掉任务后，点这里让该条目可以重新下载">${icon('refresh', 13)}允许重下</button>` : ''}
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="download-cards">${list.map(downloadCardHTML).join('')}</div>
          </div>
        </div>`}`;
  }

  function downloadCardHTML(x) {
    return `
      <div class="download-card" data-key="${esc(x.id)}">
        <div class="dc-head">
          ${downloadBadge(x.status)}
          <span class="dc-time">${fmtDate(x.createdAt)}</span>
        </div>
        <div class="dc-title">${esc(x.title)}</div>
        <div class="dc-meta">
          <span>${icon('rss', 11)}${esc(x.subName || '—')}</span>
          <span class="dc-path">${icon('folder', 11)}${esc(x.savePath || 'qB 默认路径')}</span>
        </div>
        ${x.error ? `<div class="dc-error">${esc(x.error)}</div>` : ''}
        <div class="dc-foot">
          <span class="faint">${esc(x.mode === 'magnet' ? '磁力链接' : x.mode === 'url' ? 'URL 提交' : '种子文件')}</span>
          ${x.status === 'failed' ? `<button class="btn btn-sm" data-action="retry-download" data-id="${esc(x.id)}">${icon('refresh')}重试</button>` : ''}
          ${(x.status === 'ok' || x.status === 'duplicate') && x.dedupe !== false ? `<button class="btn btn-sm btn-ghost" data-action="allow-redownload" data-id="${esc(x.id)}">${icon('refresh')}允许重下</button>` : ''}
        </div>
      </div>`;
  }

  /* ============================================================
   * 站点与路径
   * ============================================================ */

  function viewLibrary() {
    const d = S.data;
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">站点与路径</h1>
          <p class="page-sub">站点负责拼接 URL，路径负责保存位置；两者都可以在追番里现场覆盖</p>
        </div>
      </div>

      <div class="notice" style="margin-bottom:16px">
        ${icon('info')}
        <div>
          追番地址 = <strong>站点基础地址</strong> + <strong>路径</strong>。例如
          <code>https://mikanime.tv</code> + <code>RSS/Bangumi?bangumiId=3870&amp;subgroupid=203</code>
          <button class="btn btn-sm" style="margin-left:8px" data-action="copy" data-copy="https://mikanime.tv/RSS/Bangumi?bangumiId=3870&amp;subgroupid=203">${icon('copy')}复制示例</button>
        </div>
      </div>

      <div class="library-grid">
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">站点基础地址</div>
              <div class="card-sub">新增追番时直接选择，路径单独填写</div>
            </div>
            <button class="btn btn-sm" data-action="open-base">${icon('plus')}新增</button>
          </div>
          <div class="card-body" style="padding-top:12px">
            ${d.bases.length ? `<div class="preset-list">${d.bases.map((b) => {
              const used = d.subs.filter((s) => s.baseId === b.id).length;
              return `
                <div class="preset-item">
                  <span class="preset-icon">${icon('server', 15)}</span>
                  <div class="preset-main">
                    <div class="preset-name">${esc(b.name)} ${used ? `<span class="chip accent">${used} 个追番</span>` : ''}</div>
                    <div class="preset-value" title="${esc(b.url)}">${esc(b.url)}</div>
                    ${b.note ? `<div class="preset-meta">${esc(b.note)}</div>` : ''}
                  </div>
                  <div class="preset-actions">
                    <button class="icon-btn" data-action="edit-base" data-id="${esc(b.id)}" title="编辑">${icon('edit')}</button>
                    <button class="icon-btn danger" data-action="delete-base" data-id="${esc(b.id)}" title="删除">${icon('trash')}</button>
                  </div>
                </div>`;
            }).join('')}</div>` : `
              <div class="qb-empty">还没有站点基础地址<br><button class="btn btn-sm" style="margin-top:10px" data-action="open-base">${icon('plus')}添加第一个</button></div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">存储路径预设</div>
              <div class="card-sub">选择预设会填入追番，也可在追番里继续修改</div>
            </div>
            <button class="btn btn-sm" data-action="open-path">${icon('plus')}新增</button>
          </div>
          <div class="card-body" style="padding-top:12px">
            ${d.paths.length ? `<div class="preset-list">${d.paths.map((p) => {
              const used = d.subs.filter((s) => s.savePath === p.path).length;
              const tpl = parsePathTemplate(p.path);
              return `
                <div class="preset-item">
                  <span class="preset-icon green">${icon('folder', 15)}</span>
                  <div class="preset-main">
                    <div class="preset-name">${esc(p.name)} ${p.isDefault ? '<span class="preset-default">默认</span>' : ''} ${tpl.count ? `<span class="chip purple">${tpl.count} 个变量</span>` : ''} ${used ? `<span class="chip green">${used} 个追番</span>` : ''}</div>
                    <div class="preset-value" title="${esc(p.path)}">${esc(p.path)}</div>
                  </div>
                  <div class="preset-actions">
                    ${p.isDefault ? '' : `<button class="icon-btn" data-action="set-default-path" data-id="${esc(p.id)}" title="设为默认">${icon('bookmark')}</button>`}
                    <button class="icon-btn" data-action="edit-path" data-id="${esc(p.id)}" title="编辑">${icon('edit')}</button>
                    <button class="icon-btn danger" data-action="delete-path" data-id="${esc(p.id)}" title="删除">${icon('trash')}</button>
                  </div>
                </div>`;
            }).join('')}</div>` : `
              <div class="qb-empty">还没有存储路径预设<br><button class="btn btn-sm" style="margin-top:10px" data-action="open-path">${icon('plus')}添加第一个</button></div>`}
            <div class="field-hint" style="margin-top:12px">路径是传给 qBittorrent 的 <code>savepath</code>。支持模板变量：<code>${'$'}{{1}}</code>、<code>${'$'}{{}}</code>，套用时逐项填空。</div>
          </div>
        </div>
      </div>`;
  }

  /* ============================================================
   * 连接设置
   * ============================================================ */

  function viewConnection() {
    const d = S.data;
    const qb = d.qb;
    const proxy = d.proxy || { enabled: false, type: 'http', host: '', port: 0, username: '', hasPassword: false, noProxy: '', skipTlsVerify: false };
    const resultHTML = connResultHTML();
    const proxyResultHTML = proxyResultBlock();
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">连接设置</h1>
          <p class="page-sub">连接到本机或局域网内的 qBittorrent WebUI</p>
        </div>
      </div>

      <div class="conn-grid">
        <div class="card conn-card">
          <div class="card-head">
            <div>
              <div class="card-title">qBittorrent WebUI</div>
              <div class="card-sub">地址、账号和 TLS 选项保存在本机数据文件中</div>
            </div>
            <span class="status-pill" style="height:28px;font-size:10.5px">
              <span class="dot ${qb.verifiedAt ? 'green' : 'amber'}"></span>${qb.verifiedAt ? '已验证' : '未验证'}
            </span>
          </div>
          <div class="card-body">
            <form id="conn-form" class="form" autocomplete="off">
              <div class="form-grid">
                <div class="field full">
                  <label class="field-label" for="qb-base">WebUI 地址 <span class="req">*</span></label>
                  <input class="input mono" id="qb-base" value="${esc(qb.baseUrl || '')}" placeholder="http://127.0.0.1:8080" spellcheck="false">
                  <div class="field-hint">可以只填 <code>127.0.0.1:8080</code>，会自动补 <code>http://</code>。应用与 qBittorrent 在同一台机器时用 127.0.0.1；不在同一台时填局域网 IP。</div>
                </div>
                <div class="field">
                  <label class="field-label" for="qb-user">用户名</label>
                  <input class="input" id="qb-user" value="${esc(qb.username || '')}" placeholder="admin" autocomplete="username">
                </div>
                <div class="field">
                  <label class="field-label" for="qb-pass">密码</label>
                  <div class="input-group">
                    <input class="input" id="qb-pass" type="password" placeholder="${qb.hasPassword ? '已保存，留空则不修改' : '没有密码可留空'}" autocomplete="current-password">
                    <button class="btn" type="button" data-action="toggle-password" style="flex:0 0 auto">显示</button>
                  </div>
                </div>
              </div>

              <label class="check"><input type="checkbox" id="qb-skip" ${qb.skipTlsVerify ? 'checked' : ''}><span><strong>忽略 HTTPS 证书校验</strong><span class="check-hint">仅在使用自签名证书的 qBittorrent WebUI 时启用</span></span></label>
              ${qb.hasPassword ? `<label class="check"><input type="checkbox" id="qb-clear"><span><strong>清除已保存的密码</strong><span class="check-hint">勾选并保存后，将使用空密码连接</span></span></label>` : ''}

              <div class="btn-row" style="margin-top:2px">
                <button class="btn btn-primary" type="submit">${icon('check')}保存并测试</button>
                <button class="btn" type="button" data-action="test-qb">${icon('plug')}仅测试连接</button>
                ${qb.baseUrl ? `<a class="btn btn-ghost" href="${esc(safeUrl(qb.baseUrl))}" target="_blank" rel="noopener">${icon('external')}打开 WebUI</a>` : ''}
              </div>
            </form>
            <div id="conn-test-result">${resultHTML}</div>
          </div>
        </div>

        <div class="card conn-card">
          <div class="card-head">
            <div>
              <div class="card-title">网络代理</div>
              <div class="card-sub">RSS、种子、封面等应用出站请求走代理；qBittorrent 连接不受影响</div>
            </div>
            <span class="status-pill" style="height:28px;font-size:10.5px">
              <span class="dot ${proxy.enabled && proxy.configured ? 'green' : 'amber'}"></span>${proxy.enabled && proxy.configured ? esc(proxy.label || '已启用') : '未启用'}
            </span>
          </div>
          <div class="card-body">
            <form id="proxy-form" class="form" autocomplete="off">
              <label class="check"><input type="checkbox" id="proxy-enabled" ${proxy.enabled ? 'checked' : ''}><span><strong>启用网络代理</strong><span class="check-hint">支持 HTTP / HTTPS / SOCKS5；qBittorrent WebAPI 请求不经过代理</span></span></label>
              <div class="form-grid" style="margin-top:12px">
                <div class="field">
                  <label class="field-label" for="proxy-type">类型</label>
                  <select class="select" id="proxy-type">
                    <option value="http" ${proxy.type === 'http' ? 'selected' : ''}>HTTP</option>
                    <option value="https" ${proxy.type === 'https' ? 'selected' : ''}>HTTPS</option>
                    <option value="socks5" ${proxy.type === 'socks5' ? 'selected' : ''}>SOCKS5</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="proxy-host">代理地址</label>
                  <input class="input mono" id="proxy-host" value="${esc(proxy.host || '')}" placeholder="127.0.0.1 或 proxy.example.com" spellcheck="false">
                </div>
                <div class="field">
                  <label class="field-label" for="proxy-port">端口</label>
                  <input class="input" id="proxy-port" type="number" min="1" max="65535" value="${proxy.port || ''}" placeholder="7890">
                </div>
                <div class="field">
                  <label class="field-label" for="proxy-user">用户名 <span class="tip">可选</span></label>
                  <input class="input" id="proxy-user" value="${esc(proxy.username || '')}" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field-label" for="proxy-pass">密码 <span class="tip">可选</span></label>
                  <input class="input" id="proxy-pass" type="password" placeholder="${proxy.hasPassword ? '已保存，留空不修改' : '没有密码可留空'}" autocomplete="new-password">
                </div>
                <div class="field full">
                  <label class="field-label" for="proxy-noproxy">不走代理 <span class="tip">逗号或换行分隔</span></label>
                  <input class="input mono" id="proxy-noproxy" value="${esc(proxy.noProxy || '')}" placeholder="localhost, 127.0.0.1, .lan" spellcheck="false">
                </div>
              </div>
              <label class="check"><input type="checkbox" id="proxy-skip" ${proxy.skipTlsVerify ? 'checked' : ''}><span><strong>忽略代理 HTTPS 证书校验</strong><span class="check-hint">仅在代理使用自签名证书时启用</span></span></label>
              ${proxy.hasPassword ? `<label class="check"><input type="checkbox" id="proxy-clear"><span><strong>清除已保存的代理密码</strong><span class="check-hint">勾选并保存后，将使用空密码</span></span></label>` : ''}
              <div class="btn-row" style="margin-top:2px">
                <button class="btn btn-primary" type="submit">${icon('check')}保存代理设置</button>
                <button class="btn" type="button" data-action="test-proxy">${icon('shield')}测试代理</button>
              </div>
            </form>
            <div id="proxy-test-result">${proxyResultHTML}</div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">如何开启 WebUI</div>
                <div class="card-sub">qBittorrent 默认端口 8080</div>
              </div>
            </div>
            <div class="card-body" style="padding-top:12px">
              <div class="help-list">
                <div class="help-step"><span class="help-num">1</span><div><strong>打开 qBittorrent 设置</strong><p>工具 → 选项 → Web UI（macOS：qBittorrent → 偏好设置）。</p></div></div>
                <div class="help-step"><span class="help-num">2</span><div><strong>启用 Web 用户界面</strong><p>勾选「Web 用户界面」，记下端口，例如 <code>8080</code>。需要账号密码时一并填写。</p></div></div>
                <div class="help-step"><span class="help-num">3</span><div><strong>填上面的地址</strong><p>本机：<code>http://127.0.0.1:8080</code>；NAS 或另一台电脑：<code>http://192.168.x.x:8080</code>。</p></div></div>
                <div class="help-step"><span class="help-num">4</span><div><strong>保存并测试</strong><p>验证成功后会显示 qBittorrent 版本与默认保存路径。</p></div></div>
              </div>
              <div class="notice amber" style="margin-top:14px">${icon('alert')}<div>如果提示 IP 被封禁，请在 qBittorrent 的 Web UI 设置里关闭「失败登录封禁」或等待解封。多次输错密码会触发临时封禁。</div></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">数据与日志</div>
                <div class="card-sub">配置保存在应用私有数据目录</div>
              </div>
              <div class="row-actions">
                <a class="btn btn-sm" href="${API}export">${icon('download')}导出配置</a>
                <button class="btn btn-sm btn-ghost" type="button" data-action="import-config">${icon('upload')}导入配置</button>
                <input type="file" id="import-file" accept="application/json,.json" class="hidden">
              </div>
            </div>
            <div class="card-body" style="padding-top:12px">
              <div class="kv-row"><span>数据目录</span><span>${esc(d.app.dataDir || '—')}</span></div>
              <div class="kv-row"><span>追番 / 下载</span><span>${d.stats.subs} / ${d.stats.downloadsTotal}</span></div>
              <details class="logs-details" style="margin-top:14px">
                <summary>查看运行日志（最近 ${Math.min(d.logs.length, 30)} 条）</summary>
                <div class="log-list">
                  ${(d.logs || []).slice(0, 30).map((l) => `
                    <div class="log-row">
                      <span class="log-time">${fmtClock(l.at)}</span>
                      <span class="log-level ${l.level}">${l.level}</span>
                      <span class="log-msg">${esc(l.msg)}</span>
                    </div>`).join('') || '<div class="qb-empty">暂无日志</div>'}
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>`;
  }

  function connResultHTML() {
    const result = S.testResult || (S.data && S.data.qb.lastTest);
    if (!result) {
      return `<div class="conn-result"><div class="conn-result-head">${icon('info', 14)} 尚未测试连接</div><p>保存设置后会自动测试一次；也可以点「仅测试连接」使用当前表单值验证。</p></div>`;
    }
    if (result.ok) {
      const defaultPath = result.defaultSavePath || '';
      const exists = S.data && S.data.paths.some((p) => p.path === defaultPath);
      return `
        <div class="conn-result ok">
          <div class="conn-result-head">${icon('check', 14)} 连接成功</div>
          <div class="kv">
            <div class="kv-row"><span>qBittorrent</span><span>${esc(result.version || '—')}</span></div>
            <div class="kv-row"><span>WebAPI</span><span>${esc(result.webapi || '—')}</span></div>
            ${defaultPath ? `<div class="kv-row"><span>默认保存路径</span><span>${esc(defaultPath)}</span></div>` : ''}
            <div class="kv-row"><span>测试时间</span><span>${result.at ? fmtDate(result.at) : '刚刚'}</span></div>
          </div>
          ${defaultPath && !exists ? `<button class="btn btn-sm" style="margin-top:10px" data-action="add-default-path" data-path="${esc(defaultPath)}">${icon('plus')}把默认路径加为预设</button>` : ''}
        </div>`;
    }
    return `
      <div class="conn-result err">
        <div class="conn-result-head">${icon('alert', 14)} 连接失败</div>
        <p>${esc(result.error || '未知错误')}</p>
      </div>`;
  }

  function renderConnectionResult() {
    const el = $('#conn-test-result');
    if (el) el.innerHTML = connResultHTML();
    renderProxyResult();
  }

  function proxyResultBlock() {
    const r = S.proxyTestResult;
    if (!r) {
      return `<div class="conn-result"><div class="conn-result-head">${icon('info', 14)} 尚未测试代理</div><p>保存后可点「测试代理」，默认请求 <code>https://mikanime.tv/</code>。</p></div>`;
    }
    if (r.ok) {
      return `
        <div class="conn-result ok">
          <div class="conn-result-head">${icon('check', 14)} 代理可用</div>
          <div class="kv">
            <div class="kv-row"><span>测试地址</span><span>${esc(r.url || '')}</span></div>
            <div class="kv-row"><span>HTTP 状态</span><span>${esc(String(r.status || ''))}</span></div>
            <div class="kv-row"><span>大小 / 耗时</span><span>${fmtBytes(r.bytes || 0)} / ${Math.round((r.durationMs || 0))} ms</span></div>
            <div class="kv-row"><span>代理</span><span>${esc((r.proxy && r.proxy.label) || '—')}</span></div>
          </div>
        </div>`;
    }
    return `
      <div class="conn-result err">
        <div class="conn-result-head">${icon('alert', 14)} 代理测试失败</div>
        <p>${esc(r.error || '未知错误')}</p>
      </div>`;
  }

  function renderProxyResult() {
    const el = $('#proxy-test-result');
    if (el) el.innerHTML = proxyResultBlock();
  }

  function readProxyForm() {
    const enabled = !!$('#proxy-enabled')?.checked;
    const type = $('#proxy-type')?.value || 'http';
    const host = $('#proxy-host')?.value.trim() || '';
    const port = Number($('#proxy-port')?.value) || 0;
    const username = $('#proxy-user')?.value.trim() || '';
    const password = $('#proxy-pass')?.value || '';
    const noProxy = $('#proxy-noproxy')?.value.trim() || '';
    const skipTlsVerify = !!$('#proxy-skip')?.checked;
    const clearPassword = !!$('#proxy-clear')?.checked;
    if (enabled && (!host || !port)) throw new Error('启用代理时请填写代理地址和端口');
    return { enabled, type, host, port, username, password, noProxy, skipTlsVerify, clearPassword };
  }

  function proxyPayload(form) {
    const body = { ...form };
    if (!form.password) delete body.password;
    return body;
  }

  async function performProxyTest(body) {
    try {
      const r = await api('proxy/test', { method: 'POST', body: { ...body, url: 'https://mikanime.tv/' } });
      S.proxyTestResult = r;
      renderProxyResult();
      toast(r.ok ? `代理可用（HTTP ${r.status}，${Math.round(r.durationMs)} ms）` : `代理测试失败：${r.error}`, r.ok ? 'success' : 'error');
    } catch (e) {
      S.proxyTestResult = { ok: false, error: e.message };
      renderProxyResult();
      toast(e.message, 'error');
    }
  }

  async function runProxyTest(body, btn) {
    await withBusy(btn, () => performProxyTest(body));
  }

  async function importConfigFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (e) {
      toast('不是有效的 JSON 文件：' + e.message, 'error');
      return;
    }
    const ok = await askConfirm({
      title: '导入配置',
      message: `会用「${file.name}」里的内容覆盖当前的站点、存储路径、追番和补番记录（${S.data.subs.length} 个追番 → 导入文件的条数）。\nqBittorrent 与代理的密码不会从文件读取，导入后需要重新填写。建议先导出当前的配置作为备份。`,
      confirmText: '覆盖导入',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api('import', { method: 'POST', body: payload });
      const t = r.totals || {};
      toast(`已导入：站点 ${t.bases || 0}、路径 ${t.paths || 0}、追番 ${t.subs || 0}、补番 ${t.extras || 0}`, 'success', '导入完成');
      await refresh();
      await loadQbStatus(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveProxySettings(btn) {
    await withBusy(btn, async () => {
      let form;
      try { form = readProxyForm(); } catch (e) { toast(e.message, 'warn'); return; }
      const body = proxyPayload(form);
      try {
        await api('proxy', { method: 'PUT', body });
        S.formDirty = false;
        S.viewDirty = false;
        await refresh();
        toast('代理设置已保存', 'success');
        await performProxyTest(body);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function testProxySettings(btn) {
    let form;
    try { form = readProxyForm(); } catch (e) { toast(e.message, 'warn'); return; }
    if (!form.enabled) { toast('请先勾选「启用网络代理」', 'warn'); return; }
    await runProxyTest(proxyPayload(form), btn);
  }

  /* ============================================================
   * 数据刷新 / qB 状态
   * ============================================================ */

  /** 用户正在 #view 的文本框里输入（含输入法组字）时，别重绘打断。 */
  function isEditingView() {
    const el = document.activeElement;
    if (!el || !el.tagName) return false;
    const view = $('#view');
    if (!view || !view.contains(el)) return false;
    return draftKind(el) === 'text';
  }

  async function refresh(options) {
    if (S.refreshing) return;
    S.refreshing = true;
    try {
      const data = await apiCached('state');
      if (data === null) return; // 304：数据没变，跳过重建与重绘
      S.data = data;
      S.loadError = '';
      if (S.offlineNotified) {
        S.offlineNotified = false;
        toast('应用服务已恢复连接', 'success');
      }
      renderChrome();
      if (options && options.soft) softRenderView();
      else renderView();
    } catch (e) {
      S.loadError = e.message;
      if (!S.data) {
        renderFatal();
      } else {
        const wasOffline = S.offlineNotified;
        S.offlineNotified = true;
        renderChrome();
        if (!wasOffline) toast(e.message, 'error');
      }
    } finally {
      S.refreshing = false;
    }
  }

  async function loadQbStatus(force) {
    if (!S.data || !S.data.qb.baseUrl || S.qbLoading) return;
    if (!S.data.qb.verifiedAt && !S.data.qb.lastTest) return;
    S.qbLoading = true;
    try {
      const st = await api('qb/status' + (force ? '?force=1' : ''));
      S.qbStatus = st;
      if (S.view === 'overview') softRenderView();
    } catch (e) {
      S.qbStatus = { ok: false, error: e.message, at: Date.now() };
      if (S.view === 'overview') softRenderView();
    } finally {
      S.qbLoading = false;
      updateConnectionChrome();
    }
  }

  /* ============================================================
   * 事件分发
   * ============================================================ */

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (['open-sub', 'edit-sub', 'preview-form', 'save-sub', 'open-base', 'edit-base', 'open-path', 'edit-path', 'copy'].includes(action)) {
      if (el.tagName === 'A') e.preventDefault();
    }
    handleAction(action, el, e).catch((err) => {
      if (err && err.message) toast(err.message, 'error');
    });
  });

  async function handleAction(action, el) {
    const id = el.dataset.id;
    switch (action) {
      case 'refresh':
        await refresh();
        await loadQbStatus(true);
        break;

      case 'toggle-theme':
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true);
        break;

      case 'toast-close':
        el.closest('.toast')?.remove();
        break;

      case 'copy': {
        const ok = await copyText(el.dataset.copy || '');
        toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择复制', ok ? 'success' : 'error');
        break;
      }

      case 'open-sub':
        openSubModal(null);
        break;
      case 'open-search':
        openSearchModal();
        break;
      case 'pick-subgroup':
        pickSubgroup(el);
        break;
      case 'extras-status':
        await refreshExtrasStatus(el);
        break;
      case 'extra-delete':
        await deleteExtra(id, false);
        break;
      case 'extra-hardlink':
        await linkExtraNow(id);
        break;
      case 'extra-hardlink-edit':
        await editExtraHardlink(id);
        break;
      case 'hardlink-probe':
        await probeHardlinkDest();
        break;
      case 'prompt-yes':
        resolveConfirm($('#prompt-input') ? $('#prompt-input').value.trim() : '');
        break;
      case 'prompt-no':
        resolveConfirm(false);
        break;
      case 'ask-yes': {
        const values = {};
        $$('[data-field]').forEach((el) => {
          if (el.type === 'checkbox') values[el.dataset.field] = !!el.checked;
          else values[el.dataset.field] = el.value.trim();
        });
        resolveConfirm(values);
        break;
      }
      case 'ask-no':
        resolveConfirm(false);
        break;
      case 'extra-delete-torrent':
        await deleteExtra(id, true);
        break;
      case 'extra-copy': {
        const x = (S.data.extras || []).find((e) => e.id === id);
        const text = x && x.magnet ? x.magnet : (x ? `magnet:?xt=urn:btih:${x.hash}` : '');
        const ok = await copyText(text || '');
        toast(ok ? '已复制磁力链接' : '复制失败，请手动复制', ok ? 'success' : 'error');
        break;
      }
      case 'open-example':
        openSubModal(null, { example: true });
        break;
      case 'open-connection':
        location.hash = '#/connection';
        break;
      case 'edit-sub':
        openSubModal(id);
        break;
      case 'delete-sub': {
        const sub = S.data.subs.find((s) => s.id === id);
        if (!sub) break;
        const ok = await askConfirm({
          title: '删除追番',
          message: `确定删除「${sub.name}」吗？已下载记录和 qBittorrent 中的任务不会被删除。`,
          confirmText: '删除追番',
          danger: true,
        });
        if (!ok) break;
        await withBusy(el, async () => {
          await api('subs/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('追番已删除', 'success');
          await refresh();
        });
        break;
      }
      case 'check-sub': {
        await withBusy(el, async () => {
          const r = await api(`subs/${encodeURIComponent(id)}/check`, { method: 'POST', body: {} });
          toastCheckResult(r);
          await refresh();
          await loadQbStatus(true);
          if (S.drawer && S.drawer.id === id) await refreshDrawer();
        });
        break;
      }
      case 'download-existing': {
        const sub = S.data.subs.find((s) => s.id === id);
        if (!sub) break;
        const ok = await askConfirm({
          title: '补下现有匹配',
          message: `会清空「${sub.name}」的已见记录和该追番的下载去重记录，然后立即检查并下载当前 RSS 中匹配的现有条目；qBittorrent 里已经存在同种子的仍会跳过。`,
          confirmText: '开始补下',
        });
        if (!ok) break;
        await withBusy(el, async () => {
          const r = await api(`subs/${encodeURIComponent(id)}/download-existing`, { method: 'POST', body: {} });
          toast(
            r.downloaded
              ? `已补下 ${r.downloaded} 条现有匹配${r.failed ? `，失败 ${r.failed} 条` : ''}`
              : (r.failed ? `补下失败 ${r.failed} 条` : '没有可补下的现有匹配'),
            r.failed ? 'error' : 'success'
          );
          await refresh();
          await loadQbStatus(true);
          if (S.drawer && S.drawer.id === id) await refreshDrawer();
        });
        break;
      }
      case 'preview-sub':
        openDrawer(id);
        break;
      case 'toggle-sub': {
        const sub = S.data.subs.find((s) => s.id === id);
        if (!sub) break;
        await withBusy(el, async () => {
          await api(`subs/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled: !sub.enabled } });
          toast(sub.enabled ? '已暂停自动检查' : '已启用自动检查', 'info');
          await refresh();
        });
        break;
      }
      case 'filter-sub':
        S.subFilter = el.dataset.filter || 'all';
        renderView();
        break;
      case 'sub-view': {
        S.subView = el.dataset.view === 'grid' ? 'grid' : 'list';
        try { localStorage.setItem('anirss-subview', S.subView); } catch { /* ignore */ }
        renderView();
        break;
      }
      case 'filter-download':
        S.downloadFilter = el.dataset.filter || 'all';
        renderView();
        break;
      case 'check-all':
        await withBusy(el, async () => {
          const r = await api('check-all', { method: 'POST', body: {} });
          if (r.started > 0) toast(`已开始检查 ${r.started} 个追番，后台执行中`, 'success', '检查已排队');
          else if (r.total === 0) toast('没有启用的追番', 'warn');
          else toast('所有追番都在检查队列中', 'info');
          setTimeout(refresh, 1200);
          setTimeout(refresh, 6000);
          setTimeout(() => loadQbStatus(true), 6500);
        });
        break;

      case 'open-base':
        openBaseModal(null);
        break;
      case 'edit-base':
        openBaseModal(id);
        break;
      case 'delete-base': {
        const base = S.data.bases.find((b) => b.id === id);
        if (!base) break;
        const used = S.data.subs.filter((s) => s.baseId === id).length;
        if (used > 0) {
          toast(`有 ${used} 个追番正在使用该站点，请先修改或删除这些追番`, 'warn');
          break;
        }
        const ok = await askConfirm({
          title: '删除站点',
          message: `确定删除站点「${base.name}」吗？这不会影响已经创建的追番。`,
          confirmText: '删除站点',
          danger: true,
        });
        if (!ok) break;
        await withBusy(el, async () => {
          await api('bases/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('站点已删除', 'success');
          await refresh();
        });
        break;
      }
      case 'open-path':
        openPathModal(null);
        break;
      case 'edit-path':
        openPathModal(null, id);
        break;
      case 'add-default-path':
        openPathModal({ name: 'qB 默认', path: el.dataset.path || '', isDefault: !S.data.paths.some((p) => p.isDefault) });
        break;
      case 'delete-path': {
        const p = S.data.paths.find((x) => x.id === id);
        if (!p) break;
        const ok = await askConfirm({
          title: '删除存储路径',
          message: `确定删除预设「${p.name}」吗？已有追番保存的路径不会被修改。`,
          confirmText: '删除预设',
          danger: true,
        });
        if (!ok) break;
        await withBusy(el, async () => {
          await api('paths/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('已删除路径预设', 'success');
          await refresh();
        });
        break;
      }
      case 'set-default-path': {
        const p = S.data.paths.find((x) => x.id === id);
        if (!p) break;
        await withBusy(el, async () => {
          await api('paths/' + encodeURIComponent(id), { method: 'PUT', body: { name: p.name, path: p.path, isDefault: true } });
          toast('已设为默认存储路径', 'success');
          await refresh();
        });
        break;
      }

      case 'test-qb':
        await testConnection(el);
        break;
      case 'test-proxy':
        await testProxySettings(el);
        break;
      case 'refresh-meta': {
        await withBusy(el, async () => {
          try {
            await api(`subs/${encodeURIComponent(id)}/meta`, { method: 'POST', body: {} });
            toast('封面/番组信息已刷新', 'success');
            await refresh();
            if (S.drawer && S.drawer.id === id) await refreshDrawer();
          } catch (e) {
            toast(e.message, 'error');
          }
        });
        break;
      }
      case 'toggle-password': {
        const input = $('#qb-pass');
        if (!input) break;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        el.textContent = show ? '隐藏' : '显示';
        break;
      }

      case 'close-modal':
        closeModal();
        break;
      case 'close-drawer':
        closeDrawer();
        break;
      case 'sub-mode':
        setSubMode(el.dataset.mode);
        break;
      case 'fill-example':
        fillSubExample();
        break;
      case 'path-template-custom':
        clearPathTemplate(true);
        toast('已改为自定义路径，可直接编辑存储路径', 'info');
        $('#f-savepath')?.focus();
        break;
      case 'insert-regex': {
        const target = el.dataset.target === 'exclude' ? '#f-exclude' : '#f-include';
        const area = $(target);
        if (!area) break;
        const value = el.dataset.value || '';
        area.value = area.value && !area.value.endsWith('\n') ? area.value + '\n' + value : area.value + value;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        area.focus();
        area.selectionStart = area.selectionEnd = area.value.length;
        break;
      }
      case 'preview-form':
        await previewSubForm(el);
        break;
      case 'download-item':
        await downloadFromDrawer(el, el.dataset.key);
        break;
      case 'drawer-check': {
        if (!S.drawer) break;
        await withBusy(el, async () => {
          const r = await api(`subs/${encodeURIComponent(S.drawer.id)}/check`, { method: 'POST', body: {} });
          toastCheckResult(r);
          await refresh();
          await refreshDrawer();
          await loadQbStatus(true);
        });
        break;
      }
      case 'drawer-refresh':
        await refreshDrawer();
        break;
      case 'retry-download':
        await withBusy(el, async () => {
          const r = await api(`downloads/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} });
          if (r.ok) toast('已重新提交到 qBittorrent', 'success');
          else toast(r.record?.error || '重试失败', 'error');
          await refresh();
        });
        break;
      case 'allow-redownload':        await withBusy(el, async () => {
          try {
            await api(`downloads/${encodeURIComponent(id)}/allow-redownload`, { method: 'POST', body: {} });
            toast('已允许重新下载该条目（下次检查会重新提交）', 'success');
            await refresh();
            if (S.drawer) await refreshDrawer();
          } catch (e) {
            toast(e.message, 'error');
          }
        });
        break;
      case 'import-config': {
        const input = $('#import-file');
        if (input) input.click();
        break;
      }
      case 'clear-downloads': {
        const ok = await askConfirm({
          title: '清空下载记录',
          message: '只会清空本应用的历史记录，不会删除 qBittorrent 中的任务；清空后这些条目不再参与去重，可以重新下载。',
          confirmText: '清空记录',
          danger: true,
        });
        if (!ok) break;
        await withBusy(el, async () => {
          await api('downloads', { method: 'DELETE' });
          toast('下载记录已清空', 'success');
          await refresh();
        });
        break;
      }
      case 'confirm-yes':
        resolveConfirm(true);
        break;
      case 'confirm-no':
        resolveConfirm(false);
        break;
      default:
        break;
    }
  }

  function toastCheckResult(r) {
    if (!r) return;
    if (r.seedOnly) {
      toast(`已记录 ${r.newCount} 条现有条目；之后只处理新增条目`, 'info', '初始化完成');
    } else {
      const extra = r.failed ? `，失败 ${r.failed} 条` : '';
      toast(`新增 ${r.newCount} 条，提交 ${r.downloaded} 条${extra}`, r.failed ? 'warn' : 'success', '检查完成');
    }
  }

  /* ============================================================
   * 子模态：基础地址 / 路径 / 追番
   * ============================================================ */

  function syncLock() {
    const locked = !!($('#modal-root')?.children.length || $('#drawer-root')?.children.length);
    document.body.classList.toggle('locked', locked);
  }

  function openModal(html, type) {
    const root = $('#modal-root');
    if (!root) return;
    S.modal = { type: type || 'modal' };
    root.innerHTML = html;
    syncLock();
    setTimeout(() => {
      const focus = root.querySelector('input:not([type=checkbox]), textarea');
      if (focus) focus.focus();
    }, 40);
  }

  function closeModal() {
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
    S.modal = null;
    S.subTemplate = null;
    S.modalDirty = false;
    syncLock();
  }

  function closeDrawer() {
    const root = $('#drawer-root');
    if (root) root.innerHTML = '';
    S.drawer = null;
    syncLock();
  }

  function closeLayers() {
    if (S.confirmResolve) {
      S.confirmResolve(false);
      S.confirmResolve = null;
    }
    closeModal();
    closeDrawer();
  }

  function askConfirm(opts) {
    return new Promise((resolve) => {
      S.confirmResolve = resolve;
      const root = $('#modal-root');
      if (!root) return resolve(false);
      root.innerHTML = `
        <div class="modal-backdrop" data-backdrop="modal">
          <div class="modal sm" role="dialog" aria-modal="true">
            <div class="modal-head">
              <div>
                <div class="modal-title">${esc(opts.title || '确认操作')}</div>
                <div class="modal-sub">${esc(opts.message || '')}</div>
              </div>
              <button class="icon-btn modal-close" data-action="confirm-no">${icon('x')}</button>
            </div>
            <div class="modal-foot">
              <button class="btn" data-action="confirm-no">取消</button>
              <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm-yes">${esc(opts.confirmText || '确认')}</button>
            </div>
          </div>
        </div>`;
      syncLock();
      setTimeout(() => root.querySelector('[data-action="confirm-yes"]')?.focus(), 40);
    });
  }

  function resolveConfirm(value) {
    const fn = S.confirmResolve;
    S.confirmResolve = null;
    closeModal();
    if (fn) fn(value);
  }

  /** 单行输入弹窗：返回字符串（可能是空串），取消返回 false */
  function askPrompt(opts) {
    return new Promise((resolve) => {
      S.confirmResolve = resolve;
      const root = $('#modal-root');
      if (!root) return resolve(false);
      root.innerHTML = `
        <div class="modal-backdrop" data-backdrop="modal">
          <div class="modal sm" role="dialog" aria-modal="true">
            <div class="modal-head">
              <div>
                <div class="modal-title">${esc(opts.title || '编辑')}</div>
                <div class="modal-sub">${esc(opts.message || '')}</div>
              </div>
              <button class="icon-btn modal-close" type="button" data-action="prompt-no">${icon('x')}</button>
            </div>
            <div class="modal-body">
              <input class="input mono" id="prompt-input" value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}" spellcheck="false">
            </div>
            <div class="modal-foot">
              <button class="btn" type="button" data-action="prompt-no">取消</button>
              <button class="btn btn-primary" type="button" data-action="prompt-yes">${esc(opts.confirmText || '确定')}</button>
            </div>
          </div>
        </div>`;
      syncLock();
      setTimeout(() => {
        const input = $('#prompt-input');
        if (!input) return;
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            resolveConfirm(input.value.trim());
          }
        });
      }, 40);
    });
  }

  /** 多字段弹窗：返回 { key: value }，取消返回 false */
  function askForm(opts) {
    return new Promise((resolve) => {
      S.confirmResolve = resolve;
      const root = $('#modal-root');
      if (!root) return resolve(false);
      const fields = Array.isArray(opts.fields) ? opts.fields : [];
      const readValues = (root) => {
        const values = {};
        $$('[data-field]', root).forEach((el) => {
          if (el.type === 'checkbox') values[el.dataset.field] = !!el.checked;
          else values[el.dataset.field] = el.value.trim();
        });
        return values;
      };
      const html = fields.map((f, i) => {
        const id = `ask-field-${i}`;
        if (f.type === 'check') {
          return `
          <div class="field">
            <label class="check"><input type="checkbox" id="${id}" data-field="${esc(f.key)}" ${f.value ? 'checked' : ''}><span><strong>${esc(f.label || '')}</strong>${f.hint ? `<span class="check-hint">${esc(f.hint)}</span>` : ''}</span></label>
          </div>`;
        }
        const type = f.type === 'number' ? 'number' : 'text';
        return `
          <div class="field">
            <label class="field-label" for="${id}">${esc(f.label || '')}</label>
            <input class="input${f.mono === false ? '' : ' mono'}" id="${id}" data-field="${esc(f.key)}" type="${type}"
              value="${esc(f.value == null ? '' : f.value)}" placeholder="${esc(f.placeholder || '')}"
              ${type === 'number' ? 'min="-999" max="999" step="1"' : ''} spellcheck="false">
            ${f.hint ? `<div class="field-hint">${esc(f.hint)}</div>` : ''}
          </div>`;
      }).join('');
      root.innerHTML = `
        <div class="modal-backdrop" data-backdrop="modal">
          <div class="modal sm" role="dialog" aria-modal="true">
            <div class="modal-head">
              <div>
                <div class="modal-title">${esc(opts.title || '编辑')}</div>
                <div class="modal-sub">${esc(opts.message || '')}</div>
              </div>
              <button class="icon-btn modal-close" type="button" data-action="ask-no">${icon('x')}</button>
            </div>
            <div class="modal-body"><div class="form" id="ask-form">${html}</div></div>
            <div class="modal-foot">
              <button class="btn" type="button" data-action="ask-no">取消</button>
              <button class="btn btn-primary" type="button" data-action="ask-yes">${esc(opts.confirmText || '保存')}</button>
            </div>
          </div>
        </div>`;
      syncLock();
      setTimeout(() => {
        const first = $('[data-field]:not([type=checkbox])', root);
        if (first) {
          first.focus();
          first.select();
        }
        $$('[data-field]', root).forEach((el) => {
          el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            resolveConfirm(readValues(root));
          });
        });
      }, 40);
    });
  }

  function openBaseModal(id) {
    const d = S.data;
    const base = id ? d.bases.find((b) => b.id === id) : null;
    const used = base ? d.subs.filter((s) => s.baseId === base.id).length : 0;
    openModal(`
      <div class="modal-backdrop" data-backdrop="modal">
        <form class="modal" id="base-form" data-id="${base ? esc(base.id) : ''}">
          <div class="modal-head">
            <div>
              <div class="modal-title">${base ? '编辑站点' : '新增站点'}</div>
              <div class="modal-sub">只填到站点根目录，追番路径在新增追番时拼接${base && used ? `。修改地址会同步 ${used} 个追番` : ''}</div>
            </div>
            <button class="icon-btn modal-close" type="button" data-action="close-modal">${icon('x')}</button>
          </div>
          <div class="modal-body">
            <div class="form">
              <div class="field">
                <label class="field-label" for="base-name">名称 <span class="req">*</span></label>
                <input class="input" id="base-name" value="${esc(base ? base.name : '')}" placeholder="例如：Mikan" maxlength="60">
              </div>
              <div class="field">
                <label class="field-label" for="base-url">基础地址 <span class="req">*</span></label>
                <input class="input mono" id="base-url" value="${esc(base ? base.url : '')}" placeholder="https://mikanime.tv" spellcheck="false">
                <div class="field-hint">只到域名（可带子路径），不要包含具体的 RSS 路径。例如 <code>https://mikanime.tv</code>。</div>
              </div>
              <div class="field">
                <label class="field-label" for="base-note">备注</label>
                <input class="input" id="base-note" value="${esc(base ? base.note : '')}" placeholder="可选，例如：蜜柑计划" maxlength="120">
              </div>
              ${base && used ? `<div class="notice amber">${icon('alert')}<div>修改基础地址会影响 <strong>${used}</strong> 个使用该站点的追番。保存后这些追番会重新拼接地址，并在下次检查时只记录现有条目。</div></div>` : ''}
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" type="button" data-action="close-modal">取消</button>
            <button class="btn btn-primary" type="submit">${base ? '保存修改' : '添加站点'}</button>
          </div>
        </form>
      </div>`, 'base');
  }

  function openPathModal(prefill, id) {
    const d = S.data;
    const path = id ? d.paths.find((p) => p.id === id) : null;
    const value = path || prefill || {};
    openModal(`
      <div class="modal-backdrop" data-backdrop="modal">
        <form class="modal sm" id="path-form" data-id="${path ? esc(path.id) : ''}">
          <div class="modal-head">
            <div>
              <div class="modal-title">${path ? '编辑存储路径' : '新增存储路径'}</div>
              <div class="modal-sub">作为追番的默认保存位置，可在追番里继续修改</div>
            </div>
            <button class="icon-btn modal-close" type="button" data-action="close-modal">${icon('x')}</button>
          </div>
          <div class="modal-body">
            <div class="form">
              <div class="field">
                <label class="field-label" for="path-name">名称 <span class="req">*</span></label>
                <input class="input" id="path-name" value="${esc(value.name || '')}" placeholder="例如：番剧" maxlength="60">
              </div>
              <div class="field">
                <label class="field-label" for="path-value">路径 / 模板 <span class="req">*</span></label>
                <input class="input mono" id="path-value" value="${esc(value.path || '')}" placeholder="/vol2/1000/media/动画/${'$'}{{1}}/Season ${'$'}{{}}" spellcheck="false">
                <div class="field-hint">传给 qBittorrent 的 <code>savepath</code>。Docker 版请填容器内路径。可把变化的部分写成变量，例如 <code>/vol2/1000/media/动画/${'$'}{{1}}/Season ${'$'}{{}}</code>，使用时只需填两个空。</div>
                <div class="field-hint" id="path-template-hint"></div>
              </div>
              <label class="check"><input type="checkbox" id="path-default" ${value.isDefault ? 'checked' : ''}><span><strong>设为默认路径</strong><span class="check-hint">新增追番时自动套用（含变量的模板会要求填写变量）</span></span></label>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" type="button" data-action="close-modal">取消</button>
            <button class="btn btn-primary" type="submit">${path ? '保存修改' : '添加路径'}</button>
          </div>
        </form>
      </div>`, 'path');
    updatePathTemplateHint();
  }

  function updatePathTemplateHint() {
    const input = $('#path-value');
    const box = $('#path-template-hint');
    if (!input || !box) return;
    const parsed = parsePathTemplate(input.value);
    if (parsed.count) {
      const names = parsed.indices.map((idx) => '${' + idx + '}').join('、');
      box.innerHTML = `已识别 <strong>${parsed.count}</strong> 个变量：<code>${esc(names)}</code>。套用这个预设时，会显示 ${parsed.count} 个输入框。`;
    } else {
      box.innerHTML = '没有变量时，会作为固定路径直接套用。变量写法：'
        + '<code>${1}</code>、<code>${2}</code>，也兼容 <code>${{1}}</code>、<code>${{}}</code>。';
    }
  }

  function subFormHTML(v, mode, isEdit) {
    const d = S.data;
    const bases = d.bases;
    const paths = d.paths;
    const base = bases.find((b) => b.id === v.baseId) || bases[0] || null;
    const pathPresetOptions = [
      '<option value="">套用预设…</option>',
      '<option value="__empty">qBittorrent 默认（留空）</option>',
      ...paths.map((p) => {
        const tpl = parsePathTemplate(p.path);
        return `<option value="${esc(p.id)}">${esc(p.name)}${tpl.count ? `（${tpl.count} 个变量）` : ''} · ${esc(p.path)}</option>`;
      }),
    ].join('');
    return `
      <div class="modal-backdrop" data-backdrop="modal">
        <form class="modal lg" id="sub-form" data-id="${isEdit ? esc(v.id) : ''}" data-mode="${mode}">
          <div class="modal-head">
            <div>
              <div class="modal-title">${isEdit ? '编辑追番' : '新增追番'}</div>
              <div class="modal-sub">${isEdit ? '修改地址后首次检查只记录现有条目，不会批量补下历史内容' : '创建时默认只记录现有条目，之后自动下载新增匹配项'}</div>
            </div>
            <button class="icon-btn modal-close" type="button" data-action="close-modal">${icon('x')}</button>
          </div>
          <div class="modal-body">
            <div class="form">
              <div class="form-grid">
                <div class="field full">
                  <label class="field-label" for="f-name">追番名称 <span class="req">*</span></label>
                  <input class="input" id="f-name" value="${esc(v.name)}" placeholder="填写追番地址后自动获取，也可以自己改" maxlength="80">
                  <div class="field-hint" id="f-name-hint">填写追番地址后会自动获取名称，也可以自己修改</div>
                </div>

                <div class="field full">
                  <div class="field-label">追番地址 <span class="tip">基础地址 + 路径，或直接粘贴完整 URL</span></div>
                  <div class="seg">
                    <button class="seg-btn ${mode === 'base' ? 'active' : ''}" type="button" data-action="sub-mode" data-mode="base">站点预设 + 路径</button>
                    <button class="seg-btn ${mode === 'full' ? 'active' : ''}" type="button" data-action="sub-mode" data-mode="full">完整 URL</button>
                  </div>
                </div>

                <div class="field full sub-pane ${mode === 'base' ? '' : 'hidden'}" data-pane="base">
                  <div class="form-grid" style="gap:12px">
                    <div class="field">
                      <label class="field-label" for="f-base">站点基础地址</label>
                      <select class="select" id="f-base">
                        ${bases.length ? bases.map((b) => `<option value="${esc(b.id)}" ${base && b.id === base.id ? 'selected' : ''}>${esc(b.name)} — ${esc(hostOf(b.url))}</option>`).join('') : '<option value="">（没有站点，请先添加）</option>'}
                      </select>
                      <div class="field-hint" id="base-hint">${base ? esc(base.url) : '请先在「站点与路径」添加基础地址'}</div>
                    </div>
                    <div class="field">
                      <label class="field-label" for="f-path">追番路径 <span class="req">*</span></label>
                      <input class="input mono" id="f-path" value="${esc(v.path || '')}" placeholder="RSS/Bangumi?bangumiId=3870&subgroupid=203" spellcheck="false">
                    </div>
                  </div>
                </div>

                <div class="field full sub-pane ${mode === 'full' ? '' : 'hidden'}" data-pane="full">
                  <label class="field-label" for="f-url">完整 RSS / Atom 地址</label>
                  <input class="input mono" id="f-url" value="${esc(v.url || '')}" placeholder="https://mikanime.tv/RSS/Bangumi?bangumiId=3870&subgroupid=203" spellcheck="false">
                </div>

                <div class="field full">
                  <div class="url-preview" id="url-preview"><span class="label">最终地址</span><code></code></div>
                </div>

                <div class="field">
                  <label class="field-label">包含正则 <span class="tip">每行一条，留空 = 全收</span></label>
                  <textarea class="textarea" id="f-include" placeholder="1080p&#10;简日|繁日" spellcheck="false">${esc(v.include)}</textarea>
                  <div class="field-hint">任意一条命中即匹配；点击下方常用表达式可快速追加。</div>
                </div>
                <div class="field">
                  <label class="field-label">排除正则 <span class="tip">每行一条</span></label>
                  <textarea class="textarea" id="f-exclude" placeholder="合集&#10;SP|OVA" spellcheck="false">${esc(v.exclude)}</textarea>
                  <div class="field-hint">任意一条命中即跳过，优先级高于包含。</div>
                </div>
                <div class="field full">
                  <div class="regex-suggest">
                    <div class="regex-suggest-row">
                      <span class="regex-suggest-label">常用包含</span>
                      <div class="regex-chips">
                        ${[
                          ['1080p', '1080p'],
                          ['720p', '720p'],
                          ['简日|繁日', '简日|繁日'],
                          ['简体|繁体', '简体|繁体'],
                          ['Baha|WEB-DL', 'Baha|WEB-DL'],
                          ['\\d{1,3}', '\\d{1,3}'],
                        ].map(([label, value]) => `<button type="button" class="regex-chip" data-action="insert-regex" data-target="include" data-value="${esc(value)}">${esc(label)}</button>`).join('')}
                      </div>
                    </div>
                    <div class="regex-suggest-row">
                      <span class="regex-suggest-label">常用排除</span>
                      <div class="regex-chips">
                        ${[
                          ['合集|SP|OVA', '合集|SP|OVA'],
                          ['预告|PV', '预告|PV'],
                          ['NCOP|NCED', 'NCOP|NCED'],
                          ['\\d{1,3}-\\d{1,3}', '\\d{1,3}-\\d{1,3}'],
                        ].map(([label, value]) => `<button type="button" class="regex-chip" data-action="insert-regex" data-target="exclude" data-value="${esc(value)}">${esc(label)}</button>`).join('')}
                      </div>
                    </div>
                  </div>
                  <label class="check" style="margin-top:2px"><input type="checkbox" id="f-ignorecase" ${v.ignoreCase ? 'checked' : ''}><span><strong>忽略大小写</strong><span class="check-hint">正则默认带 i 标志</span></span></label>
                  <div class="field-error" id="regex-error"></div>
                </div>

                <div class="field full"><div class="divider" style="margin:0"></div></div>

                <div class="field full">
                  <label class="field-label" for="f-savepath">存储路径 <span class="tip">预设可套用，也可现场修改</span></label>
                  <div class="input-group">
                    <select class="select path-preset-select" id="f-path-preset">${pathPresetOptions}</select>
                    <input class="input mono" id="f-savepath" value="${esc(v.savePath || '')}" placeholder="留空 = qBittorrent 默认路径" spellcheck="false">
                  </div>
                  <div class="field-hint">会作为 <code>savepath</code> 传给 qBittorrent；Docker 版请填容器内路径。路径模板支持 <code>${'${1}'}</code> / <code>${'${{1}}'}</code> 变量，以及 <code>${'${name}'}</code> 追番名称。</div>
                  <div class="path-template hidden" id="path-template">
                    <div class="path-template-head">
                      <span class="chip purple">模板</span>
                      <strong id="path-template-name"></strong>
                      <span class="spacer"></span>
                      <button class="btn btn-sm btn-ghost" type="button" data-action="path-template-custom">改为自定义</button>
                    </div>
                    <div class="field-hint" id="path-template-raw"></div>
                    <div class="template-vars" id="path-template-vars"></div>
                  </div>
                </div>
                <div class="field">
                  <label class="field-label" for="f-category">分类 <span class="tip">可选</span></label>
                  <input class="input" id="f-category" value="${esc(v.category || '')}" placeholder="例如：anime" maxlength="80">
                </div>
                <div class="field">
                  <label class="field-label" for="f-tags">标签 <span class="tip">可选，逗号分隔</span></label>
                  <input class="input" id="f-tags" value="${esc(v.tags || '')}" placeholder="rss,1080p" maxlength="120">
                </div>
                <div class="field">
                  <label class="field-label" for="f-interval">检查间隔（分钟）</label>
                  <input class="input" id="f-interval" type="number" min="1" max="1440" value="${Number(v.intervalMin) || 10}">
                </div>
                <div class="field">
                  <label class="field-label" for="f-max">单次最多提交 <span class="tip">防止刷屏</span></label>
                  <input class="input" id="f-max" type="number" min="1" max="50" value="${Number(v.maxPerCheck) || 5}">
                </div>

                <div class="field full">
                  <label class="check"><input type="checkbox" id="f-enabled" ${v.enabled ? 'checked' : ''}><span><strong>启用自动检查</strong><span class="check-hint">应用运行期间按间隔自动拉取并下载新增匹配条目</span></span></label>
                  ${isEdit ? `
                    <label class="check" style="margin-top:8px"><input type="checkbox" id="f-reset"><span><strong>清空已见记录</strong><span class="check-hint">下次检查会把历史条目重新当作新条目；历史下载记录也不再参与去重，方便在 qB 里删掉任务后重新下载</span></span></label>` : `
                    <label class="check" style="margin-top:8px"><input type="checkbox" id="f-existing"><span><strong>立即下载当前匹配的现有条目</strong><span class="check-hint">不勾选则只记录现有条目，以后只下载新增内容</span></span></label>`}
                </div>
              </div>

              <div class="preview-box" id="sub-preview-result">
                <div class="preview-empty">填写地址和正则后，可先「预览匹配」确认效果；预览不会产生下载。</div>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <div class="foot-left"><button class="btn btn-ghost btn-sm" type="button" data-action="fill-example">${icon('zap')}填入 Mikan 示例</button></div>
            <button class="btn" type="button" data-action="close-modal">取消</button>
            <button class="btn" type="button" data-action="preview-form">${icon('eye')}预览匹配</button>
            <button class="btn btn-primary" type="submit">${isEdit ? '保存修改' : '创建追番'}</button>
          </div>
        </form>
      </div>`;
  }

  function openSubModal(id, options) {
    const d = S.data;
    if (!d) return;
    const sub = id ? d.subs.find((s) => s.id === id) : null;
    const opts = options || {};
    const prefill = opts.prefill || null;
    const draft = opts.draft || null;
    let baseId = sub ? sub.baseId : (prefill && prefill.baseId ? prefill.baseId : (d.bases[0] ? d.bases[0].id : ''));
    if (baseId && !d.bases.some((b) => b.id === baseId)) baseId = '';
    const defaultPreset = d.paths.find((p) => p.isDefault) || null;
    const defaultTemplate = defaultPreset ? parsePathTemplate(defaultPreset.path) : null;
    const useDefaultTemplate = !sub && !draft && !!defaultTemplate && (defaultTemplate.count > 0 || defaultTemplate.hasName);
    const defaultPath = useDefaultTemplate ? '' : (defaultPreset ? defaultPreset.path : '');
    const values = sub ? { ...sub } : {
      name: (prefill && prefill.name) || '',
      baseId,
      path: (prefill && prefill.path) || '',
      url: '',
      include: '',
      exclude: '',
      ignoreCase: true,
      savePath: defaultPath,
      category: '',
      tags: '',
      intervalMin: 10,
      maxPerCheck: 5,
      enabled: true,
    };
    if (draft) Object.assign(values, draft.values || {});
    if (opts.example && !values.name) values.name = 'Mikan 示例追番';
    let mode = sub
      ? (sub.baseId && d.bases.some((b) => b.id === sub.baseId) ? 'base' : 'full')
      : (baseId ? 'base' : 'full');
    if (draft && (draft.mode === 'base' || draft.mode === 'full')) mode = draft.mode;
    if (mode === 'base' && !d.bases.length) mode = 'full';
    S.subTemplate = null;
    S.nameTouched = draft ? !!draft.nameTouched : (!!sub && !prefill);
    S.nameToken = (S.nameToken || 0) + 1;
    S.lastResolveUrl = '';
    S.modalDirty = !!draft;
    clearTimeout(S.nameTimer);
    openModal(subFormHTML(values, mode, !!sub), 'sub');
    if (draft) {
      if (draft.subTemplate && draft.subTemplate.id) {
        const preset = d.paths.find((p) => p.id === draft.subTemplate.id);
        if (preset) {
          S.subTemplate = {
            id: preset.id,
            name: preset.name,
            template: preset.path,
            parsed: parsePathTemplate(preset.path),
            values: { ...(draft.subTemplate.values || {}) },
          };
          const input = $('#f-savepath');
          if (input) input.readOnly = true;
          renderPathTemplate();
          const presetSelect = $('#f-path-preset');
          if (presetSelect) presetSelect.value = preset.id;
        }
      }
      updateSubUrlPreview();
      if (S.nameTouched) setNameHint('使用自定义名称');
    } else if (useDefaultTemplate) {
      activatePathTemplateById(defaultPreset.id);
    } else if (!sub && defaultPreset) {
      const presetSelect = $('#f-path-preset');
      if (presetSelect) presetSelect.value = defaultPreset.id;
    }
    updateSubUrlPreview();
    if (opts.example) fillSubExample(true);
  }

  function activatePathTemplateById(id) {
    const preset = (S.data.paths || []).find((p) => p.id === id);
    if (!preset) return;
    const parsed = parsePathTemplate(preset.path);
    const input = $('#f-savepath');
    if (!parsed.count && !parsed.hasName) {
      clearPathTemplate(false);
      if (input) {
        input.readOnly = false;
        input.value = preset.path;
      }
      return;
    }
    S.subTemplate = {
      id: preset.id,
      name: preset.name,
      template: preset.path,
      parsed,
      values: {},
    };
    const presetSelect = $('#f-path-preset');
    if (presetSelect) presetSelect.value = preset.id;
    if (input) {
      input.readOnly = true;
      input.value = composePathTemplate(parsed, {}, $('#f-name') ? $('#f-name').value : '');
    }
    renderPathTemplate();
  }

  function renderPathTemplate(root) {
    const scope = root || document;
    const t = S.subTemplate;
    const panel = $('#path-template', scope);
    if (!t || !panel) return;
    panel.classList.remove('hidden');
    const name = $('#path-template-name', scope);
    if (name) name.textContent = t.name;
    const raw = $('#path-template-raw', scope);
    if (raw) {
      const bits = [];
      if (t.parsed.count) bits.push(`共 ${t.parsed.count} 个空`);
      if (t.parsed.hasName) bits.push('<code>${name}</code> 使用追番名称');
      bits.push('变量里也可以写 <code>${name}</code>');
      raw.innerHTML = `模板 <code>${esc(t.template)}</code> · ${bits.join(' · ')}`;
    }
    const vars = $('#path-template-vars', scope);
    if (vars) {
      vars.innerHTML = t.parsed.indices.map((idx) => `
        <label class="template-var">
          <span>变量 ${idx}</span>
          <input class="input" type="text" data-template-var="${idx}" value="${esc(t.values[idx] || '')}" placeholder="填写第 ${idx} 个空" autocomplete="off" spellcheck="false">
        </label>`).join('');
    }
    composePathFromTemplate(scope);
  }

  function composePathFromTemplate(root) {
    const scope = root || document;
    const t = S.subTemplate;
    const input = $('#f-savepath', scope);
    if (!t || !input) return;
    const nameInput = $('#f-name', scope);
    const name = nameInput ? nameInput.value : '';
    const composed = composePathTemplate(t.parsed, t.values, name);
    input.value = composed;
    const pendingVars = t.parsed.indices.some((idx) => !String(t.values[idx] || '').trim());
    const pendingName = hasNamePlaceholder(composed) || (t.parsed.hasName && !sanitizePathName(name));
    input.classList.toggle('template-pending', pendingVars || pendingName);
  }

  function clearPathTemplate(keepValue) {
    S.subTemplate = null;
    const panel = $('#path-template');
    if (panel) panel.classList.add('hidden');
    const name = $('#path-template-name');
    if (name) name.textContent = '';
    const raw = $('#path-template-raw');
    if (raw) raw.innerHTML = '';
    const vars = $('#path-template-vars');
    if (vars) vars.innerHTML = '';
    const input = $('#f-savepath');
    if (input) {
      input.readOnly = false;
      input.classList.remove('template-pending');
      if (!keepValue) input.value = '';
    }
    const presetSelect = $('#f-path-preset');
    if (presetSelect) presetSelect.value = '';
  }

  function applyPathPreset(id) {
    if (!id) return;
    if (id === '__empty') {
      clearPathTemplate(false);
      const input = $('#f-savepath');
      if (input) { input.value = ''; input.focus(); }
      const presetSelect = $('#f-path-preset');
      if (presetSelect) presetSelect.value = '__empty';
      return;
    }
    const preset = (S.data.paths || []).find((p) => p.id === id);
    if (!preset) return;
    const parsed = parsePathTemplate(preset.path);
    if (parsed.count || parsed.hasName) {
      activatePathTemplateById(preset.id);
      return;
    }
    clearPathTemplate(false);
    const input = $('#f-savepath');
    if (input) {
      input.value = preset.path;
      input.readOnly = false;
    }
    const presetSelect = $('#f-path-preset');
    if (presetSelect) presetSelect.value = preset.id;
  }

  function setSubMode(mode) {
    const form = $('#sub-form');
    if (!form) return;
    form.dataset.mode = mode;
    $$('.seg-btn', form).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $$('.sub-pane', form).forEach((pane) => pane.classList.toggle('hidden', pane.dataset.pane !== mode));
    if (mode === 'full') {
      const urlInput = $('#f-url', form);
      const pathInput = $('#f-path', form);
      const baseSelect = $('#f-base', form);
      if (urlInput && !urlInput.value.trim()) {
        const base = S.data.bases.find((b) => b.id === (baseSelect ? baseSelect.value : ''));
        urlInput.value = composeClientUrl(base ? base.url : '', pathInput ? pathInput.value : '');
      }
    }
    updateSubUrlPreview();
  }

  function updateSubUrlPreview() {
    const form = $('#sub-form');
    if (!form) return;
    const box = $('#url-preview', form);
    if (!box) return;
    const code = box.querySelector('code');
    const mode = form.dataset.mode || 'base';
    let url = '';
    if (mode === 'base') {
      const baseSelect = $('#f-base', form);
      const base = S.data.bases.find((b) => b.id === (baseSelect ? baseSelect.value : ''));
      const path = $('#f-path', form)?.value.trim() || '';
      url = composeClientUrl(base ? base.url : '', path);
      const hint = $('#base-hint', form);
      if (hint) hint.textContent = base ? base.url : '请先在「站点与路径」添加基础地址';
    } else {
      url = $('#f-url', form)?.value.trim() || '';
    }
    if (code) code.textContent = url || '（尚未填写）';
    box.classList.toggle('invalid', !!url && !isHttp(url));
    scheduleResolveName();
  }

  function currentSubFormUrl() {
    const form = $('#sub-form');
    if (!form) return '';
    const mode = form.dataset.mode || 'base';
    if (mode === 'full') return $('#f-url', form)?.value.trim() || '';
    const baseId = $('#f-base', form)?.value || '';
    const base = S.data.bases.find((b) => b.id === baseId);
    const path = $('#f-path', form)?.value.trim() || '';
    return composeClientUrl(base ? base.url : '', path);
  }

  function setNameHint(text, kind) {
    const el = $('#f-name-hint');
    if (!el) return;
    el.textContent = text;
    el.className = 'field-hint' + (kind ? ` hint-${kind}` : '');
  }

  function scheduleResolveName() {
    clearTimeout(S.nameTimer);
    if (!S.modal || S.modal.type !== 'sub' || S.nameTouched) return;
    const url = currentSubFormUrl();
    if (!url || !isHttp(url)) {
      setNameHint('填写追番地址后会自动获取名称，也可以自己修改');
      return;
    }
    let parsed = null;
    try { parsed = new URL(url); } catch { /* ignore */ }
    if (parsed && (parsed.pathname === '/' || parsed.pathname === '') && !parsed.search) {
      setNameHint('填写追番路径后会自动获取名称，也可以自己修改');
      return;
    }
    if (S.lastResolveUrl === url) return;
    S.lastResolveUrl = url;
    setNameHint('正在从追番地址获取名称…', 'loading');
    S.nameTimer = setTimeout(() => resolveSubName(url), 550);
  }

  async function resolveSubName(url) {
    if (S.nameTouched) return;
    const token = ++S.nameToken;
    try {
      const r = await api('resolve', { method: 'POST', body: { url } });
      if (token !== S.nameToken || S.nameTouched) return;
      const input = $('#f-name');
      if (input && r.name) input.value = r.name;
      setNameHint(r.name ? `已从追番地址获取：${r.name}` : '没有获取到名称，请手动填写', r.name ? 'ok' : 'warn');
      composePathFromTemplate();
    } catch (e) {
      if (token !== S.nameToken) return;
      setNameHint(`自动获取名称失败：${e.message}`, 'warn');
    }
  }

  function validateSubRegex() {
    const form = $('#sub-form');
    if (!form) return '';
    const include = $('#f-include', form)?.value || '';
    const exclude = $('#f-exclude', form)?.value || '';
    const err = regexErrorOf(include) || regexErrorOf(exclude);
    const box = $('#regex-error', form);
    if (box) box.textContent = err;
    return err;
  }

  function collectSubForm() {
    const form = $('#sub-form');
    if (!form) throw new Error('表单不存在');
    const mode = form.dataset.mode || 'base';
    const name = $('#f-name', form).value.trim();
    if (!name) throw new Error('请填写追番名称');
    const regexErr = validateSubRegex();
    if (regexErr) throw new Error(regexErr);

    let savePath = $('#f-savepath', form).value.trim();
    if (S.subTemplate) {
      const missing = S.subTemplate.parsed.indices.find((idx) => !String(S.subTemplate.values[idx] || '').trim());
      if (missing) throw new Error(`请填写存储路径模板「${S.subTemplate.name}」的第 ${missing} 个空`);
      if (S.subTemplate.parsed.hasName && !sanitizePathName(name)) {
        throw new Error('存储路径模板使用了 ${name}，请先填写追番名称');
      }
      savePath = composePathTemplate(S.subTemplate.parsed, S.subTemplate.values, name).trim();
      if (hasNamePlaceholder(savePath)) {
        throw new Error('存储路径里还有 ${name}，请先填写追番名称');
      }
    } else {
      savePath = substituteNameInPath(savePath, name).trim();
    }

    let payload = {
      name,
      include: $('#f-include', form).value,
      exclude: $('#f-exclude', form).value,
      ignoreCase: $('#f-ignorecase', form).checked,
      savePath,
      category: $('#f-category', form).value.trim(),
      tags: $('#f-tags', form).value.trim(),
      intervalMin: Number($('#f-interval', form).value) || 10,
      maxPerCheck: Number($('#f-max', form).value) || 5,
      enabled: $('#f-enabled', form).checked,
    };

    if (mode === 'base') {
      const baseId = $('#f-base', form).value;
      const path = $('#f-path', form).value.trim();
      if (!baseId) throw new Error('请选择站点基础地址，或先到「站点与路径」添加');
      if (!path) throw new Error('请填写追番路径');
      payload.baseId = baseId;
      payload.path = path;
      payload.url = '';
    } else {
      const url = $('#f-url', form).value.trim();
      if (!url) throw new Error('请填写完整 RSS 地址');
      if (!isHttp(url)) throw new Error('RSS 地址必须是 http / https 链接');
      payload.url = url;
      payload.baseId = '';
      payload.path = '';
    }

    if (!payload.ignoreCase) payload.ignoreCase = false;
    payload.downloadExisting = !!(form.querySelector('#f-existing')?.checked);
    payload.resetSeen = !!(form.querySelector('#f-reset')?.checked);
    return payload;
  }

  function fillSubExample(silent) {
    const form = $('#sub-form');
    if (!form) return;
    const nameInput = $('#f-name', form);
    const mikan = S.data.bases.find((b) => /mikan/i.test(b.name) || /mikan/i.test(b.url));
    const examplePath = 'RSS/Bangumi?bangumiId=3870&subgroupid=203';
    if (!nameInput.value.trim()) {
      nameInput.value = '';
      S.nameTouched = false;
    }
    if (mikan) {
      setSubMode('base');
      const baseSelect = $('#f-base', form);
      if (baseSelect) baseSelect.value = mikan.id;
      const pathInput = $('#f-path', form);
      if (pathInput) pathInput.value = examplePath;
    } else {
      setSubMode('full');
      const urlInput = $('#f-url', form);
      if (urlInput) urlInput.value = 'https://mikanime.tv/' + examplePath;
      if (!silent) toast('没有 Mikan 站点预设，已填入完整地址；可到「站点与路径」补一个基础地址', 'info');
    }
    const include = $('#f-include', form);
    if (include && !include.value.trim()) include.value = '1080p';
    const exclude = $('#f-exclude', form);
    if (exclude && !exclude.value.trim()) exclude.value = '合集|SP';
    updateSubUrlPreview();
    validateSubRegex();
    if (!silent) toast('已填入示例，可继续修改后预览或保存', 'info');
  }

  async function previewSubForm(btn) {
    await withBusy(btn, async () => {
      let payload;
      try { payload = collectSubForm(); } catch (e) { toast(e.message, 'error'); return; }
      const box = $('#sub-preview-result');
      if (box) box.innerHTML = '<div class="preview-empty"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> 正在拉取 RSS…</div>';
      try {
        const data = await api('preview', { method: 'POST', body: payload });
        if (box) {
          box.innerHTML = previewResultHTML(data);
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (e) {
        if (box) {
          box.innerHTML = `<div class="preview-empty" style="color:#ff9dab">${esc(e.message)}</div>`;
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        toast(e.message, 'error');
      }
    });
  }

  function previewResultHTML(data) {
    const items = (data.items || []).slice(0, 10);
    return `
      <div class="preview-head">
        <strong>${esc(data.feedTitle || 'RSS')}</strong>
        <small>${data.total} 条 · 匹配 ${data.matched} 条${data.truncated ? ' · 仅显示前 150 条' : ''}</small>
      </div>
      <div class="preview-list">
        ${items.length ? items.map((it) => `
          <div class="preview-row">
            <span class="badge ${it.matched ? 'green' : it.reason === 'exclude' ? 'red' : 'gray'}">${it.matched ? '匹配' : it.reason === 'exclude' ? '排除' : it.reason === 'include' ? '未命中' : '跳过'}</span>
            <div class="preview-title">${esc(it.title)}<small>${it.pubDate ? fmtDate(it.pubDate) : '无日期'}${it.size ? ' · ' + fmtBytes(it.size) : ''}${it.downloadable ? '' : ' · 无种子链接'}</small></div>
          </div>`).join('') : '<div class="preview-empty">该 RSS 没有条目</div>'}
      </div>
      ${data.total > items.length ? `<div class="preview-empty">还有 ${data.total - items.length} 条未显示</div>` : ''}`;
  }

  /* ============================================================
   * 抽屉：追番预览
   * ============================================================ */

  function openDrawer(id) {
    const sub = S.data.subs.find((s) => s.id === id);
    if (!sub) return;
    S.drawer = { id, sub, loading: true, data: null, error: '' };
    renderDrawer();
    loadDrawer();
  }

  async function loadDrawer() {
    if (!S.drawer) return;
    const current = S.drawer;
    try {
      const data = await api(`subs/${encodeURIComponent(current.id)}/preview`, { method: 'POST', body: {} });
      if (!S.drawer || S.drawer.id !== current.id) return;
      S.drawer.data = data;
      S.drawer.sub = data.sub || S.drawer.sub;
      S.drawer.loading = false;
      S.drawer.error = '';
    } catch (e) {
      if (!S.drawer || S.drawer.id !== current.id) return;
      S.drawer.loading = false;
      S.drawer.error = e.message;
    }
    renderDrawer();
  }

  async function refreshDrawer() {
    if (!S.drawer) return;
    S.drawer.loading = true;
    S.drawer.error = '';
    renderDrawer();
    await loadDrawer();
  }

  function renderDrawer() {
    const root = $('#drawer-root');
    if (!root || !S.drawer) return;
    const d = S.drawer;
    const sub = d.sub || {};
    const data = d.data;
    const meta = sub.meta || {};
    const items = data ? data.items || [] : [];
    // 刷新后条目列表重建，把滚动位置带回原处（单条下载后不打断浏览）
    const prevBody = root.querySelector('.drawer-body');
    const bodyScroll = prevBody ? prevBody.scrollTop : 0;
    const stats = data ? `
      <div class="drawer-stats">
        <div class="drawer-stat"><strong>${data.total}</strong><small>总条目</small></div>
        <div class="drawer-stat"><strong>${data.matched}</strong><small>匹配</small></div>
        <div class="drawer-stat"><strong>${data.newCount}</strong><small>新条目</small></div>
        <div class="drawer-stat"><strong>${data.items.filter((x) => x.downloaded).length}</strong><small>已提交</small></div>
      </div>` : '';

    root.innerHTML = `
      <div class="drawer-backdrop" data-backdrop="drawer">
        <aside class="drawer" role="dialog" aria-modal="true">
          <div class="drawer-head">
            <div class="drawer-title-row">
              ${meta.hasCover ? `<img class="drawer-cover" src="${API}cover/${encodeURIComponent(sub.id)}" alt="" onerror="this.remove()">` : ''}
              <div style="flex:1;min-width:0">
                <div class="drawer-title">${esc(sub.name || '追番预览')}</div>
                <div class="drawer-sub">${esc(sub.url || '')}</div>
                ${(meta.homeUrl || meta.bgmUrl) ? `<div class="drawer-links">
                  ${meta.homeUrl ? `<a href="${esc(safeUrl(meta.homeUrl))}" target="_blank" rel="noopener">${icon('globe', 12)}番组主页</a>` : ''}
                  ${meta.bgmUrl ? `<a href="${esc(safeUrl(meta.bgmUrl))}" target="_blank" rel="noopener">${icon('external', 12)}Bangumi</a>` : ''}
                  ${meta.officialSite ? `<a href="${esc(safeUrl(meta.officialSite))}" target="_blank" rel="noopener">${icon('external', 12)}官网</a>` : ''}
                </div>` : ''}
              </div>
              <button class="icon-btn" data-action="close-drawer" title="关闭">${icon('x')}</button>
            </div>
            ${stats}
            ${data ? `<div class="small faint" style="margin-top:8px">${esc(data.feedTitle || '')} · 拉取于 ${relTime(data.fetchedAt)}${d.loading ? ' · 刷新中…' : ''}</div>` : ''}
          </div>
          <div class="drawer-body">
            ${d.loading && !data ? `<div class="qb-empty"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> 正在拉取 RSS…</div>` : ''}
            ${d.error ? `<div class="notice red">${icon('alert')}<div>${esc(d.error)}<br><button class="btn btn-sm" style="margin-top:8px" data-action="drawer-refresh">重试</button></div></div>` : ''}
            ${!d.loading && !d.error && data && items.length === 0 ? '<div class="qb-empty">RSS 中没有条目</div>' : ''}
            ${items.length ? `<div class="item-list">${items.map((it) => feedItemHTML(sub, it)).join('')}</div>` : ''}
            ${data && data.truncated ? `<div class="qb-empty">仅显示前 150 条</div>` : ''}
          </div>
          <div class="drawer-foot">
            <button class="btn btn-primary" data-action="drawer-check">${icon('refresh')}立即检查并下载</button>
            <button class="btn" data-action="drawer-refresh">${icon('eye')}重新预览</button>
            <span class="spacer"></span>
            <span class="small faint">预览不产生下载</span>
          </div>
        </aside>
      </div>`;
    const body = root.querySelector('.drawer-body');
    if (body && bodyScroll) body.scrollTop = bodyScroll;
    syncLock();
  }

  function feedItemHTML(sub, it) {
    let badge;
    if (it.downloaded) badge = '<span class="badge green">已提交</span>';
    else if (it.matched && !it.downloadable) badge = '<span class="badge amber">匹配 · 无种子</span>';
    else if (it.matched) badge = '<span class="badge blue">匹配</span>';
    else if (it.reason === 'exclude') badge = '<span class="badge red">排除</span>';
    else if (it.reason === 'include') badge = '<span class="badge gray">未命中</span>';
    else badge = '<span class="badge gray">跳过</span>';
    const seen = it.seen ? '<span class="chip muted">已见</span>' : '<span class="chip green">新</span>';
    const canDownload = it.downloadable && !it.downloaded;
    const canRedownload = it.downloadable && !!it.downloaded;
    const btnLabel = canRedownload
      ? `${icon('refresh', 13)}重新下载`
      : canDownload ? `${icon('download', 13)}下载` : '无种子';
    return `
      <div class="feed-item" data-key="${esc(it.key)}">
        <div class="feed-main">
          <div class="feed-title">${it.link ? `<a href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</div>
          <div class="feed-meta">
            <span>${it.pubDate ? fmtDate(it.pubDate) : '无日期'}</span>
            ${it.size ? `<span>${fmtBytes(it.size)}</span>` : ''}
            ${it.torrentUrl ? `<span>${/^magnet:/i.test(it.torrentUrl) ? '磁力' : '种子'}</span>` : ''}
          </div>
          <div class="feed-badges">${it.episodeLabel ? `<span class="chip accent">${esc(it.episodeLabel)}</span>` : ''}${badge}${seen}</div>
        </div>
        <div class="feed-action">
          <button class="btn btn-sm ${canDownload || canRedownload ? '' : 'btn-ghost'}" data-action="download-item" data-key="${esc(it.key)}" data-force="${canRedownload ? '1' : '0'}" title="${canRedownload ? '忽略本应用的下载记录，再提交一次' : ''}" ${canDownload || canRedownload ? '' : 'disabled'}>
            ${btnLabel}
          </button>
        </div>
      </div>`;
  }

  async function downloadFromDrawer(btn, key) {
    if (!S.drawer) return;
    const force = btn?.dataset?.force === '1';
    await withBusy(btn, async () => {
      try {
        const r = await api(`subs/${encodeURIComponent(S.drawer.id)}/download`, { method: 'POST', body: { key, force } });
        if (r.record?.status === 'ok') toast(force ? '已忽略下载记录，重新提交到 qBittorrent' : '已提交到 qBittorrent', 'success');
        else if (r.record?.status === 'duplicate') toast('相同地址已经提交过，已跳过', 'info');
        else toast(r.record?.error || '下载失败', 'error');
        await refresh();
        await refreshDrawer();
        await loadQbStatus(true);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /* ============================================================
   * 表单提交：连接 / 站点 / 路径 / 追番
   * ============================================================ */

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.id === 'conn-form') {
      e.preventDefault();
      saveConnection(form);
    } else if (form.id === 'proxy-form') {
      e.preventDefault();
      saveProxySettings(form);
    } else if (form.id === 'extra-form') {
      e.preventDefault();
      submitExtras(form);
    } else if (form.id === 'hardlink-form') {
      e.preventDefault();
      saveHardlinkSettings(form);
    } else if (form.id === 'guess-form') {
      e.preventDefault();
      runGuess(form);
    } else if (form.id === 'search-form') {
      e.preventDefault();
      runSearch(form);
    } else if (form.id === 'sub-form') {
      e.preventDefault();
      saveSub(form);
    } else if (form.id === 'base-form') {
      e.preventDefault();
      saveBase(form);
    } else if (form.id === 'path-form') {
      e.preventDefault();
      savePath(form);
    }
  });

  function readConnForm() {
    const base = $('#qb-base')?.value.trim() || '';
    const username = $('#qb-user')?.value.trim() || '';
    const password = $('#qb-pass')?.value || '';
    const skipTlsVerify = !!$('#qb-skip')?.checked;
    const clearPassword = !!$('#qb-clear')?.checked;
    if (!base) throw new Error('请填写 qBittorrent WebUI 地址');
    return { base, username, password, skipTlsVerify, clearPassword };
  }

  async function testConnection(btn) {
    await withBusy(btn, async () => {
      let form;
      try { form = readConnForm(); } catch (e) { toast(e.message, 'warn'); return; }
      const payload = {
        baseUrl: form.base,
        username: form.username,
        skipTlsVerify: form.skipTlsVerify,
      };
      if (form.password) payload.password = form.password;
      try {
        const r = await api('qb/test', { method: 'POST', body: payload });
        S.testResult = { ok: true, ...r };
        renderConnectionResult();
        toast(`连接成功：qBittorrent ${r.version || ''}`, 'success');
      } catch (e) {
        S.testResult = { ok: false, error: e.message, baseUrl: form.base };
        renderConnectionResult();
        toast(e.message, 'error');
      }
      await refresh();
      await loadQbStatus(true);
    });
  }

  async function saveConnection(form) {
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      let values;
      try { values = readConnForm(); } catch (e) { toast(e.message, 'warn'); return; }
      const payload = {
        baseUrl: values.base,
        username: values.username,
        skipTlsVerify: values.skipTlsVerify,
        clearPassword: values.clearPassword,
      };
      if (values.password) payload.password = values.password;
      await api('qb/config', { method: 'PUT', body: payload });
      S.formDirty = false;
      S.viewDirty = false;
      delete S.drafts.connection;
      toast('qBittorrent 设置已保存', 'success');
      try {
        const r = await api('qb/test', {
          method: 'POST',
          body: { baseUrl: values.base, username: values.username, skipTlsVerify: values.skipTlsVerify },
        });
        S.testResult = { ok: true, ...r };
        toast(`连接验证成功：${r.version || 'qBittorrent'}`, 'success');
      } catch (e) {
        S.testResult = { ok: false, error: e.message, baseUrl: values.base };
        toast('设置已保存，但连接测试失败：' + e.message, 'warn');
      }
      await refresh();
      await loadQbStatus(true);
    });
  }

  async function saveBase(form) {
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      const id = form.dataset.id || '';
      const name = $('#base-name', form).value.trim();
      const url = $('#base-url', form).value.trim();
      const note = $('#base-note', form).value.trim();
      if (!name) throw new Error('请填写站点名称');
      if (!url) throw new Error('请填写基础地址');
      if (id) {
        const r = await api('bases/' + encodeURIComponent(id), { method: 'PUT', body: { name, url, note } });
        toast(r.affected ? `站点已保存，同步更新了 ${r.affected} 个追番地址` : '站点已保存', 'success');
      } else {
        await api('bases', { method: 'POST', body: { name, url, note } });
        toast('站点已添加', 'success');
      }
      closeModal();
      await refresh();
    });
  }

  async function savePath(form) {
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      const id = form.dataset.id || '';
      const name = $('#path-name', form).value.trim();
      const path = $('#path-value', form).value.trim();
      const isDefault = !!$('#path-default', form).checked;
      if (!name) throw new Error('请填写名称');
      if (!path) throw new Error('请填写路径');
      if (id) {
        await api('paths/' + encodeURIComponent(id), { method: 'PUT', body: { name, path, isDefault } });
        toast('存储路径已保存', 'success');
      } else {
        await api('paths', { method: 'POST', body: { name, path, isDefault } });
        toast('存储路径已添加', 'success');
      }
      closeModal();
      await refresh();
    });
  }

  async function saveSub(form) {
    const btn = form.querySelector('button[type="submit"]');
    await withBusy(btn, async () => {
      let payload;
      try { payload = collectSubForm(); } catch (e) { toast(e.message, 'warn'); return; }
      const id = form.dataset.id || '';
      try {
        if (id) {
          await api('subs/' + encodeURIComponent(id), { method: 'PUT', body: payload });
          toast(payload.resetSeen ? '追番已保存，已清空已见并允许重新下载历史条目' : '追番已保存', 'success');
        } else {
          const r = await api('subs', { method: 'POST', body: payload });
          if (r.warning) {
            toast(`追番已创建，但首次检查失败：${r.warning}`, 'warn', '需要关注');
          } else if (r.check) {
            toastCheckResult(r.check);
          } else {
            toast('追番已创建', 'success');
          }
        }
        delete S.drafts.subs;
        S.viewDirty = false;
        S.subModalDraft = null;
        closeModal();
        await refresh();
        await loadQbStatus(true);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /* ============================================================
   * 表单联动 / 快捷键 / 初始化
   * ============================================================ */

  // #view 里只要有过输入，就说明有没提交的草稿：重绘时要暂存/还原
  ['input', 'change'].forEach((type) => {
    document.addEventListener(type, (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#view')) S.viewDirty = true;
      if (t.closest('#sub-form')) S.modalDirty = true;
    }, true);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.closest('#conn-form')) S.formDirty = true;
    if (t.closest('#proxy-form')) S.formDirty = true;
    if (t.id === 'f-base' || t.id === 'f-path' || t.id === 'f-url') updateSubUrlPreview();
    if (t.id === 'f-name') {
      // 名称提示只属于追番表单，补番页有同 id 的输入框
      if (t.closest('#sub-form')) {
        S.nameTouched = !!t.value.trim();
        S.nameToken++;
        clearTimeout(S.nameTimer);
        setNameHint(S.nameTouched ? '使用自定义名称' : '填写追番地址后会自动获取名称');
      }
      composePathFromTemplate(t.closest('form') || document);
      if (t.closest('#extra-form')) updateHardlinkPreview();
    }
    if (t.id === 'f-include' || t.id === 'f-exclude') validateSubRegex();
    if (t.id === 'f-savepath' && !S.subTemplate && !t.readOnly) {
      const presetSelect = $('#f-path-preset', t.closest('form') || document);
      if (presetSelect) presetSelect.value = '';
    }
    if (t.dataset && t.dataset.templateVar && S.subTemplate) {
      S.subTemplate.values[Number(t.dataset.templateVar)] = t.value;
      composePathFromTemplate(t.closest('form') || document);
    }
    if (t.id === 'path-value') updatePathTemplateHint();
    if (t.id === 'h-dest' || t.id === 'h-season') {
      // 手动改了目录就不再对应预设
      if (t.id === 'h-dest') {
        const hSelect = $('#h-path-preset');
        const opt = hSelect && hSelect.selectedOptions ? hSelect.selectedOptions[0] : null;
        if (opt && opt.dataset && opt.dataset.path && opt.dataset.path !== t.value.trim()) hSelect.value = '';
      }
      updateHardlinkPreview();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'import-file') {
      importConfigFile(t);
      return;
    }
    if (t.closest('#conn-form')) S.formDirty = true;
    if (t.closest('#proxy-form')) S.formDirty = true;
    if (t.id === 'f-base') updateSubUrlPreview();
    if (t.id === 'h-path-preset') {
      const opt = t.selectedOptions ? t.selectedOptions[0] : null;
      const input = $('#h-dest');
      if (input) input.value = opt && opt.dataset ? (opt.dataset.path || '') : '';
      updateHardlinkPreview();
    }
    if (t.id === 'f-path-preset') {
      const value = t.value;
      if (!value) {
        clearPathTemplate(false);
        const input = $('#f-savepath');
        if (input) input.value = '';
      } else {
        t.value = '';
        applyPathPreset(value);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.confirmResolve) { resolveConfirm(false); return; }
    if (S.modal) { closeModal(); return; }
    if (S.drawer) { closeDrawer(); return; }
  });

  document.addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.backdrop === 'modal') {
      if (S.confirmResolve) resolveConfirm(false);
      else closeModal();
    }
    if (e.target.dataset && e.target.dataset.backdrop === 'drawer') closeDrawer();
  });

  let clockEl = null;
  function tickClock() {
    if (!clockEl || !clockEl.isConnected) clockEl = $('#live-time');
    if (clockEl) clockEl.textContent = fmtClock(Date.now());
  }

  async function boot() {
    applyTheme(document.documentElement.getAttribute('data-theme') || 'light', false);
    $$('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon, 18);
    });
    tickClock();
    setInterval(tickClock, 1000);
    if (!location.hash) history.replaceState(null, '', '#/overview');
    S.view = readRoute();
    renderChrome();
    renderView();
    await refresh();
    if (S.view === 'overview') await loadQbStatus();
    S.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh({ soft: true });
    }, 12000);
    setInterval(() => {
      if (document.visibilityState === 'visible' && S.view === 'overview' && S.data) loadQbStatus();
    }, 30000);
    window.addEventListener('hashchange', onRoute);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refresh({ soft: true });
        loadQbStatus();
      }
    });
  }

  boot();
})();
