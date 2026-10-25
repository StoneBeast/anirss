'use strict';

/**
 * 补番硬链接：下载完成后，从种子里挑出「正片 + 对应字幕」，平铺到目标季目录。
 *
 * 目标目录与下载目录必须在同一文件系统（硬链接的前提），所以这里只做
 * 选择、规划与逐个 link，不做复制；跨分区/权限问题会转成可读的错误文本。
 *
 * 两种模式：
 *   season（默认）——识别正片/字幕，平铺到 destRoot（一般是 …/Season n/）；
 *   mirror        ——旧行为，按扩展名筛选并保持种子内相对路径。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { guessEpisode } = require('./util');

const DEFAULT_EXTENSIONS = 'mkv,mp4,ts,m2ts,avi,wmv,flv,mov,rmvb,webm,iso,m4v';
const DEFAULT_SUB_EXTENSIONS = 'ass,srt,ssa,vtt,sup';
// 目录名整段匹配（小写）：CDs、Scans、SP、特典等都不属于正片
const DEFAULT_EXCLUDE_DIRS = 'cds,scans,sp,sps,specials,extras,ncop,nced,menu,pv,cm,trailer,trailers,preview,previews,bonus,ost,soundtrack,booklets,booklet,特典,映像特典,映像特典,menu';
// 文件名里的方括号标签整词匹配：NCOP / NCED / PV / CM / SP01 / OVA …
const DEFAULT_EXCLUDE_TAGS = 'ncop,nced,pv,cm,menu,trailer,preview,sp,ova,oad,special,特典,映像特典';
const DEFAULT_FONT_EXTENSIONS = 'ttf,otf,ttc,otc,woff,woff2';
// 字幕可能单独放在这些目录里
const SUBTITLE_DIR_HINTS = new Set(['subs', 'sub', 'subtitles', 'subtitle', 'ass', 'chs', 'cht', 'sc', 'tc', '字幕']);
const MAX_FILES = 5000;

/** 解析扩展名列表："mkv, mp4、.ts" 都可以，统一成不带点的小写集合 */
function parseExtensions(text) {
  const set = new Set();
  for (const part of String(text == null ? '' : text).split(/[\s,，、;；]+/)) {
    const ext = part.trim().toLowerCase().replace(/^\.+/, '');
    if (!ext || !/^[a-z0-9]{1,10}$/.test(ext)) continue;
    set.add(ext);
  }
  return set;
}

/** 解析目录名/标签集合（逗号、空白分隔，统一小写） */
function parseNameSet(text) {
  const set = new Set();
  for (const part of String(text == null ? '' : text).split(/[\s,，、;；]+/)) {
    const name = part.trim().toLowerCase();
    if (name) set.add(name);
  }
  return set;
}

/** 取文件扩展名（小写、不带点）；没有扩展名返回空串 */
function extensionOf(name) {
  const base = String(name == null ? '' : name).replace(/\\/g, '/').split('/').pop();
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

/** 相对路径安全化：去掉空段、. 与 ..，防止种子里的名字越出目标目录 */
function safeRelPath(rel) {
  return String(rel == null ? '' : rel)
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

function dirOf(rel) {
  return safeRelPath(rel).split('/').slice(0, -1).join('/');
}

function baseOf(rel) {
  return safeRelPath(rel).split('/').pop();
}

function stemOf(rel) {
  return baseOf(rel).replace(/\.[^.]+$/, '');
}

function dirSegments(rel) {
  return dirOf(rel).split('/').filter(Boolean).map((s) => s.toLowerCase());
}

/** qB 文件是否已经完整下载（未下载/未完成/空文件都不要） */
function isReadyFile(item) {
  if (!item || typeof item !== 'object') return false;
  const size = Number(item.size) || 0;
  const progress = item.progress === undefined ? 1 : Number(item.progress);
  if (Number(item.priority) === 0) return false;
  if (!Number.isFinite(progress) || progress < 1) return false;
  return size > 0;
}

/** 文件名里的方括号/圆括号标签，例如 [VCB-Studio] [01] [Ma10p_1080p] */
function tagsOf(rel) {
  const base = baseOf(rel);
  const tags = [];
  const re = /[[(（【]\s*([^\])）】]{1,40}?)\s*[\])）】]/g;
  let m;
  while ((m = re.exec(base))) {
    const raw = m[1].trim().toLowerCase().replace(/[\s_]+/g, ' ');
    if (raw) tags.push(raw);
  }
  return tags;
}

/** 标签是否命中排除词：支持 [NCOP] [NCOP2] [SP01] [PV1] 这类带数字的写法 */
function hasExcludedTag(rel, excludeTags) {
  if (!excludeTags || !excludeTags.size) return false;
  for (const tag of tagsOf(rel)) {
    if (excludeTags.has(tag)) return true;
    const head = tag.split(/[\s\-_.:]+/)[0];
    if (head && excludeTags.has(head)) return true;
    if (head && /^[a-z]{2,6}\d{1,2}$/.test(head) && excludeTags.has(head.replace(/\d+$/, ''))) return true;
  }
  return false;
}

function hasExcludedDir(rel, excludeDirs) {
  if (!excludeDirs || !excludeDirs.size) return false;
  return dirSegments(rel).some((seg) => excludeDirs.has(seg));
}

function inSubtitleDir(rel) {
  return dirSegments(rel).some((seg) => SUBTITLE_DIR_HINTS.has(seg));
}

/** 所有文件是否共用一个顶层目录；是则返回该目录名（多文件种子的种子文件夹） */
function detectContentRoot(files) {
  const firsts = new Set();
  let rootFiles = 0;
  for (const item of Array.isArray(files) ? files : []) {
    const segs = safeRelPath(item && item.name).split('/').filter(Boolean);
    if (segs.length > 1) firsts.add(segs[0]);
    else if (segs.length === 1) rootFiles++;
  }
  if (rootFiles === 0 && firsts.size === 1) return [...firsts][0];
  return '';
}

function toOffset(value) {
  const n = Math.trunc(Number(value) || 0);
  return Math.max(-999, Math.min(999, n));
}

function cleanComponent(text) {
  return String(text == null ? '' : text)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 160);
}

/** 按模板生成重命名后的文件名（不含扩展名） */
function renderEpisodeName(pattern, name, episode, season) {
  const ep = Math.max(0, Math.trunc(Number(episode) || 0));
  const padded = String(ep).padStart(2, '0');
  const tpl = String(pattern || '${name} - ${episode2}');
  let out = tpl
    .replace(/\$?\{\{\s*name\s*\}\}|\$\{\s*name\s*\}/gi, String(name || ''))
    .replace(/\$?\{\{\s*episode2\s*\}\}|\$\{\s*episode2\s*\}/gi, padded)
    .replace(/\$?\{\{\s*episode\s*\}\}|\$\{\s*episode\s*\}/gi, String(ep))
    .replace(/\$?\{\{\s*season\s*\}\}|\$\{\s*season\s*\}/gi, season ? String(season) : '');
  out = cleanComponent(out);
  if (!out) out = cleanComponent(`${name || ''} - ${padded}`);
  return out || padded;
}

/** 多份字幕时用语言后缀区分，避免同名冲突 */
function subtitleTag(base) {
  const t = String(base || '').toLowerCase();
  if (/cht|zh[-_]?(tw|hant|hk)|\btc\b|繁/.test(t)) return 'zh-Hant';
  if (/chs|zh[-_]?(cn|hans|sg)|\bsc\b|简/.test(t)) return 'zh';
  if (/jpn|japanese|日文|日语/.test(t)) return 'ja';
  return '';
}

/**
 * 季目录模式：挑正片和字幕，平铺到目标目录。
 * 返回 { files: [{src,dest,size,kind}], mains, subs, fonts, stats, ... }
 */
function planSeason(input) {
  const opts = input || {};
  const files = Array.isArray(opts.files) ? opts.files : [];
  const videoOffset = toOffset(opts.videoOffset);
  const subOffset = toOffset(opts.subOffset);
  const rename = !!opts.rename;
  const renamePattern = String(opts.renamePattern || '${name} - ${episode2}');
  const showName = String(opts.name || '');
  const seasonNo = Math.trunc(Number(opts.season) || 0);
  const videoExts = opts.videoExts instanceof Set ? opts.videoExts
    : parseExtensions(opts.videoExts === undefined ? DEFAULT_EXTENSIONS : opts.videoExts);
  const subExts = opts.subExts instanceof Set ? opts.subExts
    : parseExtensions(opts.subExts === undefined ? DEFAULT_SUB_EXTENSIONS : opts.subExts);
  const fontExts = parseExtensions(DEFAULT_FONT_EXTENSIONS);
  const excludeDirs = opts.excludeDirs instanceof Set ? opts.excludeDirs : parseNameSet(opts.excludeDirs == null ? DEFAULT_EXCLUDE_DIRS : opts.excludeDirs);
  const excludeTags = opts.excludeTags instanceof Set ? opts.excludeTags : parseNameSet(opts.excludeTags == null ? DEFAULT_EXCLUDE_TAGS : opts.excludeTags);
  const stats = {
    total: files.length,
    notReady: 0,
    notVideo: 0,
    excludedDir: 0,
    excludedTag: 0,
    special: 0,
    range: 0,
    noEpisode: 0,
    duplicate: 0,
    subtitle: 0,
    subtitleUnmatched: 0,
    font: 0,
    conflict: 0,
    renamed: 0,
  };

  const videos = [];
  for (const item of files) {
    const rel = safeRelPath(item && item.name);
    if (!rel) continue;
    if (!isReadyFile(item)) {
      stats.notReady++;
      continue;
    }
    if (!videoExts.has(extensionOf(rel))) {
      stats.notVideo++;
      continue;
    }
    if (hasExcludedDir(rel, excludeDirs)) {
      stats.excludedDir++;
      continue;
    }
    if (hasExcludedTag(rel, excludeTags)) {
      stats.excludedTag++;
      continue;
    }
    const base = baseOf(rel);
    const guess = guessEpisode(base);
    if (guess && guess.kind === 'special') {
      stats.special++;
      continue;
    }
    if (guess && guess.kind === 'range') {
      stats.range++;
      continue;
    }
    const size = Number(item.size) || 0;
    videos.push({
      rel,
      base,
      size,
      depth: rel.split('/').length,
      episode: guess && guess.kind === 'single' ? guess.episode : null,
      abs: typeof item.abs === 'string' ? item.abs : '',
      allowCopy: !!item.allowCopy,
    });
    if (!guess) stats.noEpisode++;
  }

  const mains = [];
  const episodes = [];
  const byEpisode = new Map();
  const episodeVideos = videos.filter((v) => v.episode != null);
  if (episodeVideos.length) {
    // 同一集有多个版本时，保留路径最浅、体积最大的那个
    episodeVideos
      .sort((a, b) => a.depth - b.depth || b.size - a.size || a.base.localeCompare(b.base))
      .forEach((v) => {
        if (byEpisode.has(v.episode)) {
          stats.duplicate++;
          return;
        }
        byEpisode.set(v.episode, v);
        mains.push(v);
      });
    mains.sort((a, b) => a.episode - b.episode || a.base.localeCompare(b.base));
    mains.forEach((v) => {
      v.target = Math.max(0, v.episode + videoOffset);
      episodes.push(v.target);
    });
    mains.sort((a, b) => (a.target || 0) - (b.target || 0) || a.base.localeCompare(b.base));
  } else if (videos.length) {
    // 没有集数：当剧场版处理，取最浅一层的视频
    const minDepth = Math.min(...videos.map((v) => v.depth));
    videos
      .filter((v) => v.depth === minDepth)
      .sort((a, b) => a.base.localeCompare(b.base))
      .forEach((v) => {
        v.target = null;
        mains.push(v);
      });
  }

  const videoByStem = new Map();
  const videoByTarget = new Map();
  for (const v of mains) {
    videoByStem.set(`${dirOf(v.rel)}|${stemOf(v.rel)}`.toLowerCase(), v);
    if (v.target != null) videoByTarget.set(v.target, v);
  }

  const subs = [];
  if (subExts.size) {
    for (const item of files) {
      const rel = safeRelPath(item && item.name);
      if (!rel || !isReadyFile(item)) continue;
      if (!subExts.has(extensionOf(rel))) continue;
      if (hasExcludedDir(rel, excludeDirs)) continue;
      if (hasExcludedTag(rel, excludeTags)) continue;
      const dir = dirOf(rel);
      const base = baseOf(rel);
      let target = videoByStem.get(`${dir}|${stemOf(rel)}`.toLowerCase()) || null;
      if (!target) {
        const guess = guessEpisode(base);
        if (guess && guess.kind === 'single') {
          // 先按目标集数配对：视频 01 + 偏移 12 = 字幕 13 + 偏移 0
          const wanted = Math.max(0, guess.episode + subOffset);
          const sameDir = mains.find((v) => v.target === wanted && dirOf(v.rel) === dir);
          target = sameDir || videoByTarget.get(wanted) || null;
        }
      }
      if (!target) {
        stats.subtitleUnmatched++;
        continue;
      }
      subs.push({
        rel, base, size: Number(item.size) || 0, episode: target.target, video: target,
        abs: typeof item.abs === 'string' ? item.abs : '',
        allowCopy: !!item.allowCopy,
      });
      stats.subtitle++;
    }
  }

  const fonts = [];
  if (opts.includeFonts) {
    for (const item of files) {
      const rel = safeRelPath(item && item.name);
      if (!rel || !isReadyFile(item)) continue;
      if (!fontExts.has(extensionOf(rel))) continue;
      if (!dirSegments(rel).includes('fonts')) continue;
      fonts.push({
        rel, base: baseOf(rel), size: Number(item.size) || 0,
        abs: typeof item.abs === 'string' ? item.abs : '',
        allowCopy: !!item.allowCopy,
      });
      stats.font++;
    }
  }

  const renameStem = (v) => (rename && v && v.target != null
    ? renderEpisodeName(renamePattern, showName, v.target, seasonNo)
    : null);
  const subCount = new Map();
  for (const s of subs) subCount.set(s.episode, (subCount.get(s.episode) || 0) + 1);
  const subSeen = new Map();
  const tagSeen = new Map();

  // 平铺：正片/字幕放到 destRoot，字体放到 destRoot/fonts
  const planned = [];
  const used = new Map();
  const push = (item, dest, kind) => {
    const key = dest.toLowerCase();
    const prev = used.get(key);
    if (prev) {
      stats.conflict++;
      return;
    }
    used.set(key, item.rel);
    planned.push({
      src: item.rel, dest, size: item.size, kind,
      abs: typeof item.abs === 'string' ? item.abs : '',
      allowCopy: !!item.allowCopy,
    });
  };
  for (const v of mains) {
    const stem = renameStem(v);
    const dest = stem ? `${stem}.${extensionOf(v.rel)}` : v.base;
    if (dest !== v.base) stats.renamed++;
    push(v, dest, 'video');
  }
  for (const s of subs) {
    const stem = renameStem(s.video);
    let dest = s.base;
    if (stem) {
      const ext = extensionOf(s.rel);
      const total = subCount.get(s.episode) || 1;
      const n = (subSeen.get(s.episode) || 0) + 1;
      subSeen.set(s.episode, n);
      let tag = subtitleTag(s.base);
      if (total > 1) {
        if (!tag) tag = `sub${n}`;
        const tagKey = `${s.episode}|${tag}`;
        const dup = (tagSeen.get(tagKey) || 0) + 1;
        tagSeen.set(tagKey, dup);
        if (dup > 1) tag = `${tag}${dup}`;
        dest = `${stem}.${tag}.${ext}`;
      } else {
        dest = `${stem}.${ext}`;
      }
      if (dest !== s.base) stats.renamed++;
    }
    push(s, dest, 'sub');
  }
  for (const f of fonts) push(f, `fonts/${f.base}`, 'font');

  let truncated = 0;
  if (planned.length > MAX_FILES) {
    truncated = planned.length - MAX_FILES;
    planned.length = MAX_FILES;
  }

  return {
    mode: 'season',
    contentRoot: detectContentRoot(files),
    files: planned,
    mains: mains.length,
    subs: subs.length,
    fonts: fonts.length,
    episodes,
    rename,
    videoOffset,
    subOffset,
    truncated,
    stats,
    skipped: stats.notReady + stats.notVideo + stats.excludedDir + stats.excludedTag
      + stats.special + stats.range + stats.duplicate + stats.conflict + stats.subtitleUnmatched
      + (episodeVideos.length ? stats.noEpisode : 0),
  };
}

/**
 * 镜像模式（旧行为）：按扩展名筛选，保持种子内相对路径。
 * stripRoot 会把所有文件共有的顶层目录去掉。
 */
function planMirror(input) {
  const opts = input || {};
  const exts = opts.extensions instanceof Set ? opts.extensions : parseExtensions(opts.extensions);
  const picked = [];
  const stats = { total: Array.isArray(opts.files) ? opts.files.length : 0, notReady: 0, notMatch: 0 };
  for (const item of Array.isArray(opts.files) ? opts.files : []) {
    const rel = safeRelPath(item && item.name);
    if (!rel) continue;
    if (!isReadyFile(item)) {
      stats.notReady++;
      continue;
    }
    if (exts.size && !exts.has(extensionOf(rel))) {
      stats.notMatch++;
      continue;
    }
    picked.push({ rel, size: Number(item.size) || 0, abs: typeof item.abs === 'string' ? item.abs : '', allowCopy: !!item.allowCopy });
  }

  let prefix = '';
  if (opts.stripRoot && picked.length) {
    const parts = picked.map((p) => p.rel.split('/'));
    if (parts.every((seg) => seg.length > 1) && new Set(parts.map((seg) => seg[0])).size === 1) {
      prefix = parts[0][0];
    }
  }

  let list = picked;
  let truncated = 0;
  if (list.length > MAX_FILES) {
    truncated = list.length - MAX_FILES;
    list = list.slice(0, MAX_FILES);
  }
  const files = list.map((p) => ({
    src: p.rel,
    dest: prefix && p.rel.startsWith(prefix + '/') ? p.rel.slice(prefix.length + 1) : p.rel,
    size: p.size,
    kind: 'file',
    abs: p.abs || '',
    allowCopy: !!p.allowCopy,
  }));
  return {
    mode: 'mirror',
    contentRoot: detectContentRoot(opts.files),
    prefix,
    files,
    truncated,
    stats,
    skipped: stats.notReady + stats.notMatch,
  };
}

function errorText(err, rel) {
  const code = err && err.code ? String(err.code) : '';
  if (code === 'EXDEV') return `跨文件系统无法硬链接：${rel}（目标目录与下载目录要在同一存储空间）`;
  if (code === 'EACCES' || code === 'EPERM') {
    return `没有权限写入：${rel}（在 fnOS「应用设置 → 访问权限」里给目标目录授「读写」）`;
  }
  if (code === 'EEXIST') return `目标已存在：${rel}`;
  if (code === 'ENOSPC') return `目标磁盘空间不足：${rel}`;
  if (code === 'ENOTDIR' || code === 'EISDIR' || code === 'ENOTEMPTY') return `目标路径冲突：${rel}`;
  if (code === 'EMLINK') return `硬链接数量达到上限：${rel}`;
  return `${rel}：${(err && err.message) || '未知错误'}`;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** 找到最近的、真实存在的上级目录（用于解释 mkdir 失败） */
function nearestExisting(p) {
  let cur = path.resolve(p);
  for (;;) {
    const st = statOrNull(cur);
    if (st) return { path: cur, stat: st };
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function modeText(mode) {
  return `0${(mode & 0o7777).toString(8).padStart(3, '0')}`;
}

/**
 * 目录权限诊断：告诉用户「哪个父目录挡住的、它是什么权限、应用以什么身份运行」。
 * 只在出错或主动检查时调用，不做任何写操作。
 */
function probePath(target) {
  const abs = path.resolve(String(target || ''));
  const found = nearestExisting(abs);
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : -1;
  const egid = typeof process.getegid === 'function' ? process.getegid() : -1;
  if (!found) {
    return {
      path: abs,
      exists: false,
      nearest: '',
      writable: false,
      message: `路径 ${abs} 没有可访问的上级目录`,
    };
  }
  let writable = false;
  try {
    fs.accessSync(found.path, fs.constants.W_OK | fs.constants.X_OK);
    writable = true;
  } catch {
    writable = false;
  }
  const st = found.stat;
  const owner = `${st.uid}:${st.gid}`;
  let user = '';
  try { user = os.userInfo().username; } catch { user = ''; }
  const who = user ? `${user}（uid ${euid}/${egid}）` : (euid >= 0 ? `uid ${euid}/${egid}` : '当前运行用户');
  // fnOS 的「访问权限」写在 system.trim_acl 里：子目录一旦有自己的条目，
  // 父目录的授权就不会自动套用到它（这是最常见的「明明授权了还是 EACCES」）。
  let ownAcl = false;
  try {
    if (typeof fs.getxattrSync === 'function') {
      fs.getxattrSync(found.path, 'system.trim_acl');
      ownAcl = true;
    }
  } catch { ownAcl = false; }
  let message = writable
    ? `最近的上级目录 ${found.path} 可写（${modeText(st.mode)}，属主 ${owner}，${who}）`
    : `最近的上级目录 ${found.path} 不可写（${modeText(st.mode)}，属主 ${owner}，${who}）；请在 fnOS「应用设置 → 访问权限」里给这个目录授「读写」，或先在文件管理里建好目标目录再授权`;
  if (!writable && ownAcl) {
    message += '；这个目录有独立的 fnOS 权限条目（system.trim_acl），父目录的授权不会自动套用到它，请对它本身授权';
  }
  return {
    path: abs,
    exists: abs === found.path,
    nearest: found.path,
    mode: modeText(st.mode),
    owner,
    euid,
    egid,
    ownAcl,
    writable,
    message,
  };
}

/** 汇总一句话，给日志/界面用 */
function describeResult(summary) {
  if (!summary) return '';
  if (!summary.ok) return summary.error || '硬链接失败';
  const bits = [];
  if (summary.linked) bits.push(`新建 ${summary.linked} 个`);
  if (summary.existed) bits.push(`${summary.existed} 个已存在`);
  if (summary.conflicts) bits.push(`${summary.conflicts} 个目标被占用`);
  return bits.join('，') || '没有需要新建的硬链接';
}

/**
 * 执行硬链接。
 * 参数：savePath、destRoot、files、mode（season|mirror）、dryRun，
 *       season 模式：videoExts / subExts / excludeDirs / excludeTags / includeFonts，
 *       mirror 模式：extensions / stripRoot。
 */
async function runHardlink(input) {
  const opts = input || {};
  const startedAt = Date.now();
  const mode = opts.mode === 'mirror' ? 'mirror' : 'season';
  const plan = mode === 'mirror' ? planMirror(opts) : planSeason(opts);
  const summary = {
    ok: false,
    empty: false,
    dryRun: !!opts.dryRun,
    mode,
    error: '',
    note: '',
    savePath: String(opts.savePath || ''),
    destRoot: String(opts.destRoot || ''),
    contentRoot: plan.contentRoot || '',
    prefix: plan.prefix || '',
    files: plan.files.length,
    videos: plan.mains || 0,
    subs: plan.subs || 0,
    fonts: plan.fonts || 0,
    episodes: plan.episodes || [],
    rename: !!plan.rename,
    videoOffset: plan.videoOffset || 0,
    subOffset: plan.subOffset || 0,
    renamed: (plan.stats && plan.stats.renamed) || 0,
    linked: 0,
    copied: 0,
    existed: 0,
    conflicts: 0,
    missing: 0,
    failed: 0,
    bytes: 0,
    skipped: plan.skipped || 0,
    stats: plan.stats || {},
    truncated: plan.truncated || 0,
    samples: [],
    startedAt,
    durationMs: 0,
  };

  const wantPath = String(opts.savePath || '').trim();
  const destPath = String(opts.destRoot || '').trim();
  if (!wantPath || !path.isAbsolute(wantPath)) {
    summary.error = 'qBittorrent 没有给出可用的保存路径，无法定位下载文件';
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }
  if (!destPath || !path.isAbsolute(destPath)) {
    summary.error = '硬链接目标目录必须是绝对路径';
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }
  const savePath = path.resolve(wantPath);
  const destRoot = path.resolve(destPath);
  summary.savePath = savePath;
  summary.destRoot = destRoot;

  if (!plan.files.length) {
    summary.empty = true;
    summary.error = mode === 'season'
      ? '没有找到可链接的正片或字幕（检查扩展名/排除目录，或种子还没下载完）'
      : (plan.stats && plan.stats.notMatch
        ? `没有扩展名匹配的文件（已跳过 ${plan.stats.notMatch} 个）`
        : '种子里没有可链接的已完成文件');
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  if (opts.dryRun) {
    summary.ok = true;
    summary.note = '预览模式，没有创建硬链接';
    summary.samples = plan.files.slice(0, 20).map((f) => f.dest);
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const saveStat = statOrNull(savePath);
  if (!saveStat || !saveStat.isDirectory()) {
    summary.fatal = true;
    summary.error = `下载目录在本机不存在或应用没有访问权限：${savePath}（在 fnOS「应用设置 → 访问权限」里添加这个目录并选「读写」；Docker 版 qBittorrent 还要保证容器内路径映射到本机同一路径）`;
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  try {
    fs.mkdirSync(destRoot, { recursive: true });
  } catch (e) {
    summary.fatal = true;
    const probe = probePath(destRoot);
    summary.permission = probe;
    summary.error = `无法创建硬链接目标目录：${destRoot}（${(e && e.message) || '未知错误'}）。${probe.message}`;
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const destPrefix = destRoot.endsWith(path.sep) ? destRoot : destRoot + path.sep;
  for (const file of plan.files) {
    // abs：字幕库里的外挂字幕等自带绝对源路径，不来自 savePath
    const src = file.abs && path.isAbsolute(file.abs)
      ? file.abs
      : path.join(savePath, ...file.src.split('/'));
    const target = path.join(destRoot, ...file.dest.split('/'));
    if (!target.startsWith(destPrefix)) {
      summary.failed++;
      if (summary.samples.length < 5) summary.samples.push(`跳过越界路径：${file.dest}`);
      continue;
    }
    const srcStat = statOrNull(src);
    if (!srcStat || !srcStat.isFile()) {
      summary.missing++;
      if (summary.samples.length < 5) summary.samples.push(`源文件不存在或没有访问权限：${file.src}`);
      continue;
    }
    const existing = statOrNull(target);
    if (existing) {
      if (existing.isFile() && existing.dev === srcStat.dev && existing.ino === srcStat.ino) {
        summary.existed++;
      } else {
        summary.conflicts++;
        if (summary.samples.length < 5) summary.samples.push(`目标已存在（未覆盖）：${file.dest}`);
      }
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.linkSync(src, target);
        summary.linked++;
      } catch (e) {
        // 外挂字幕存在应用数据目录，可能和媒体库不在同一分区：小文件直接复制兜底
        if (file.allowCopy && (e.code === 'EXDEV' || e.code === 'EACCES' || e.code === 'EPERM')) {
          fs.copyFileSync(src, target);
          summary.copied++;
        } else {
          throw e;
        }
      }
      summary.bytes += srcStat.size || file.size || 0;
    } catch (e) {
      summary.failed++;
      if (summary.samples.length < 5) summary.samples.push(errorText(e, file.dest));
    }
  }

  summary.durationMs = Date.now() - startedAt;
  if (summary.failed || summary.missing) {
    summary.ok = false;
    summary.error = `部分文件失败：${summary.failed} 个错误、${summary.missing} 个源文件缺失${summary.samples[0] ? `（${summary.samples[0]}）` : ''}`;
  } else {
    summary.ok = true;
    const bits = [];
    if (summary.linked) bits.push(`新建 ${summary.linked} 个硬链接`);
    if (summary.copied) bits.push(`复制 ${summary.copied} 个（不同分区的小文件）`);
    if (summary.existed) bits.push(`${summary.existed} 个已存在`);
    if (summary.conflicts) bits.push(`${summary.conflicts} 个目标被占用已跳过`);
    summary.note = bits.join('，') || '没有需要新建的硬链接';
  }
  return summary;
}

module.exports = {
  DEFAULT_EXTENSIONS,
  DEFAULT_SUB_EXTENSIONS,
  DEFAULT_EXCLUDE_DIRS,
  DEFAULT_EXCLUDE_TAGS,
  MAX_FILES,
  parseExtensions,
  parseNameSet,
  extensionOf,
  safeRelPath,
  detectContentRoot,
  probePath,
  planSeason,
  planMirror,
  runHardlink,
  describeResult,
};
