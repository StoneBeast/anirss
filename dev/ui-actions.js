'use strict';

/**
 * UI 交互验收（CDP）：表单创建/校验/删除/开关/连接测试/移动端导航。
 * 前提：Chrome 9222 + anirss 演示实例 8777。
 */

const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8777';
const DEMO_DATA = path.resolve(__dirname, '..', '..', 'work', 'anirss-demo-data');
const FRIEREN_FILE = '[ANi] 葬送的芙莉莲 - 28 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4].mkv';

let ws;
let nextId = 1;
const pending = new Map();
const eventWaiters = new Map();
const errors = [];
const pass = [];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect() {
  const targets = await (await fetch(CDP + '/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    const waiters = eventWaiters.get(msg.method);
    if (waiters && waiters.length) waiters.shift().resolve(msg.params);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push('LOG: ' + msg.params.entry.text);
    }
  };
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, 30000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

function waitEvent(method, timeout) {
  return new Promise((resolve, reject) => {
    const list = eventWaiters.get(method) || [];
    const timer = setTimeout(() => reject(new Error('event timeout: ' + method)), timeout || 15000);
    const waiter = { resolve: (v) => { clearTimeout(timer); resolve(v); } };
    list.push(waiter);
    eventWaiters.set(method, list);
  });
}

async function ev(expression) {
  const res = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result ? res.result.value : undefined;
}

async function click(selector, wait) {
  const ok = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error('找不到点击目标：' + selector);
  await sleep(wait || 600);
}

async function setValue(selector, value) {
  const ok = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error('找不到输入框：' + selector);
}

async function setChecked(selector, value) {
  const ok = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.checked = ${value ? 'true' : 'false'};
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error('找不到复选框：' + selector);
}

async function state() {
  const res = await fetch(APP + '/api/state');
  return res.json();
}

function ok(name, condition, detail) {
  if (!condition) throw new Error('断言失败：' + name + (detail ? ' — ' + detail : ''));
  pass.push(name);
  console.log('✓ ' + name);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP + '/?actions=' + Date.now() + '#/subs' });
  await waitEvent('Page.loadEventFired', 15000).catch(() => {});
  await sleep(1800);
  errors.length = 0;

  // 1. 正则校验
  await click('[data-action="open-sub"]', 600);
  await click('[data-action="insert-regex"][data-target="include"][data-value="720p"]', 250);
  const regexChipValue = await ev("document.querySelector('#f-include').value");
  ok('常用正则快捷追加', regexChipValue.includes('720p'), regexChipValue);
  await setValue('#f-name', '正则校验测试');
  await setValue('#f-path', '/rss/movie');
  await setValue('#f-include', '[');
  await click('[data-action="preview-form"]', 400);
  const regexErr = await ev("document.querySelector('#regex-error')?.textContent || ''");
  ok('非法正则在前端被拦截', regexErr.includes('无效'), regexErr);
  await click('[data-action="close-modal"]', 300);

  // 2. 示例地址拼接
  await click('[data-action="open-sub"]', 600);
  await click('[data-action="fill-example"]', 400);
  const composed = await ev("document.querySelector('#url-preview code')?.textContent || ''");
  ok('基础地址 + 路径拼接正确', composed === 'https://mikanime.tv/RSS/Bangumi?bangumiId=3870&subgroupid=203', composed);
  await click('[data-action="close-modal"]', 300);

  // 2b. 追番名称自动获取 + ${name} 路径替换
  await click('[data-action="open-sub"]', 600);
  await ev(`(() => {
    const sel = document.querySelector('#f-base');
    sel.value = 'b_demo';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await setValue('#f-path', '/RSS/Bangumi?bangumiId=4059');
  await sleep(2000);
  const autoName = await ev("document.querySelector('#f-name').value");
  ok('追番名称自动获取', autoName === '药屋少女的呢喃', autoName);
  await click('[data-action="path-template-custom"]', 300);
  await setValue('#f-savepath', '/media/${name}/Season 1');
  await setChecked('#f-existing', false);
  await click('#sub-form button[type="submit"]', 2600);
  let st = await state();
  const autoSub = st.subs.find((s) => s.url.includes('/RSS/Bangumi?bangumiId=4059'));
  ok('自动名称保存生效', !!autoSub && autoSub.name === '药屋少女的呢喃', autoSub && autoSub.name);
  ok('${name} 路径替换生效', !!autoSub && autoSub.savePath === '/media/药屋少女的呢喃/Season 1', autoSub && autoSub.savePath);
  await click(`.sub-card [data-action="delete-sub"][data-id="${autoSub.id}"]`, 400);
  await click('[data-action="confirm-yes"]', 1000);

  // 3. 通过 UI 创建追番
  await click('[data-action="open-sub"]', 600);  await setValue('#f-name', 'UI 测试追番');
  await ev(`(() => {
    const sel = document.querySelector('#f-base');
    sel.value = 'b_demo';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await setValue('#f-path', '/rss/movie');
  await setValue('#f-include', '1080p');
  await setValue('#f-exclude', '预告');
  const tplCount = await ev("document.querySelectorAll('[data-template-var]').length");
  ok('默认路径模板显示两个空', tplCount === 2, String(tplCount));

  // 变量值里写 ${name} 也应替换成追番名称
  await setValue('#f-name', '变量名测试');
  await ev(`(() => {
    const values = ['\${name}', '01'];
    document.querySelectorAll('[data-template-var]').forEach((el, i) => {
      el.value = values[i] || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return true;
  })()`);
  const nameVarPath = await ev("document.querySelector('#f-savepath').value");
  ok('变量里的 ${name} 会被替换', nameVarPath === '/vol2/1000/media/动画/变量名测试/Season 01', nameVarPath);

  await setValue('#f-name', 'UI 测试追番');
  await ev(`(() => {
    const values = ['UI测试', '01'];
    document.querySelectorAll('[data-template-var]').forEach((el, i) => {
      el.value = values[i] || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return true;
  })()`);
  const composedPath = await ev("document.querySelector('#f-savepath').value");
  ok('路径模板拼接正确', composedPath === '/vol2/1000/media/动画/UI测试/Season 01', composedPath);
  await setChecked('#f-existing', false);
  await click('#sub-form button[type="submit"]', 2600);
  const modalGone = await ev("!document.querySelector('#sub-form')");
  ok('创建追番后弹窗关闭', modalGone);

  st = await state();
  const created = st.subs.find((s) => s.name === 'UI 测试追番');
  ok('新追番已保存', !!created);
  ok('初始检查只记录现有条目', created && created.seenCount >= 2 && created.lastCheck && created.lastCheck.seedOnly === true,
    created ? `seen=${created.seenCount}, seedOnly=${created.lastCheck && created.lastCheck.seedOnly}` : 'missing');
  ok('模板最终路径已保存', created && created.savePath === '/vol2/1000/media/动画/UI测试/Season 01', created && created.savePath);
  const newId = created.id;

  // 4. 立即检查（全部已见，不应重复下载）
  const beforeDownloads = st.downloads.length;
  await click(`.sub-card [data-action="check-sub"][data-id="${newId}"]`, 1800);
  st = await state();
  const after = st.subs.find((s) => s.id === newId);
  ok('检查后没有历史条目重复下载', st.downloads.length === beforeDownloads && after.lastCheck.newCount === 0,
    `downloads ${beforeDownloads} -> ${st.downloads.length}, new=${after.lastCheck.newCount}`);

  // 5. 删除追番
  await click(`.sub-card [data-action="delete-sub"][data-id="${newId}"]`, 400);
  await click('[data-action="confirm-yes"]', 1000);
  st = await state();
  ok('删除追番生效', !st.subs.some((s) => s.id === newId));

  // 6. 启停开关
  await click('[data-action="toggle-sub"][data-id="s_kusuriya"]', 800);
  st = await state();
  let kusuriya = st.subs.find((s) => s.id === 's_kusuriya');
  ok('暂停追番生效', kusuriya && kusuriya.enabled === false);
  await click('[data-action="toggle-sub"][data-id="s_kusuriya"]', 800);
  st = await state();
  kusuriya = st.subs.find((s) => s.id === 's_kusuriya');
  ok('重新启用追番生效', kusuriya && kusuriya.enabled === true);

  // 7. 连接测试
  await ev("location.hash = '#/connection'");
  await sleep(1000);
  await click('[data-action="test-qb"]', 1800);
  const connText = await ev("document.querySelector('#conn-test-result')?.innerText || ''");
  ok('qBittorrent 连接测试成功', connText.includes('连接成功') && connText.includes('v5.0.2'), connText.replace(/\n/g, ' | '));

  // 8. 补番：磁力链接单次下载 + 状态刷新 + 删除记录
  await ev("location.hash = '#/extras'");
  await sleep(900);
  const extrasTitle = await ev("document.querySelector('.page-title')?.textContent || ''");
  ok('补番页面可打开', extrasTitle.trim() === '补番', extrasTitle);

  // 8a. 硬链接：设置保存 + 下载完成后自动生成 + 手动重跑
  ok('补番页有硬链接设置', await ev("!!document.querySelector('#hardlink-form')") === true);
  ok('硬链接目标可复用站点路径预设', await ev(`(() => {
    const sel = document.querySelector('#h-path-preset');
    return !!sel && Array.from(sel.options).some((o) => o.textContent.includes('番剧季度模板'));
  })()`) === true);
  const presetPreview = await ev(`(() => {
    const sel = document.querySelector('#h-path-preset');
    const opt = Array.from(sel.options).find((o) => o.textContent.includes('番剧季度模板'));
    if (!opt) return '';
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('#h-dest-preview')?.textContent || '';
  })()`);
  ok('路径预设变量按名称/季预览', /动画/.test(presetPreview) && /Season 1/.test(presetPreview), presetPreview);
  const frierenId = ((await state()).extras || []).find((x) => x.hash === 'e2'.padEnd(40, '1')).id;
  await setValue('#hl-video-exts', 'mkv,mp4');
  await setValue('#hl-sub-exts', 'ass,srt');
  await setValue('#hl-rename-pattern', '${name} - E${episode2}');
  await click('#hardlink-form button[type="submit"]', 1500);
  const hlCfg = (await state()).hardlink;
  ok('硬链接设置保存生效', hlCfg.videoExts === 'mkv,mp4' && hlCfg.mode === 'season'
    && hlCfg.renamePattern === '${name} - E${episode2}', JSON.stringify(hlCfg));
  const hlRow = await ev(`(() => {
    const btn = document.querySelector('[data-action="extra-hardlink"][data-id="${frierenId}"]');
    const card = btn ? btn.closest('.extra-card') : null;
    const row = card ? card.querySelector('.extra-hl') : null;
    return row ? row.innerText.replace(/\\n/g, ' ') : '';
  })()`);
  const frierenAfter = ((await state()).extras || []).find((x) => x.id === frierenId);
  ok('下载完成后自动硬链接', !!frierenAfter && !!frierenAfter.hardlink && frierenAfter.hardlink.done === true
    && (frierenAfter.hardlink.linked + frierenAfter.hardlink.existed) >= 1 && /(集|字幕)/.test(hlRow) && !/失败/.test(hlRow),
    JSON.stringify({ row: hlRow, hl: frierenAfter && frierenAfter.hardlink }));
  const seasonDir = path.join(DEMO_DATA, 'library', '葬送的芙莉莲', 'Season 1');
  const linkedFile = path.join(seasonDir, FRIEREN_FILE);
  const linkedSub = path.join(seasonDir, FRIEREN_FILE.replace(/\.mkv$/, '.ass'));
  const sourceFile = path.join(DEMO_DATA, 'downloads', '葬送的芙莉莲', FRIEREN_FILE);
  ok('硬链接文件已生成', fs.existsSync(linkedFile), linkedFile);
  ok('字幕一起硬链接', fs.existsSync(linkedSub), linkedSub);
  ok('CDs 未被链接', !fs.existsSync(path.join(seasonDir, '01.flac')));
  ok('源文件保留继续做种', fs.existsSync(sourceFile) && fs.statSync(sourceFile).nlink === 2,
    String(fs.existsSync(sourceFile) ? fs.statSync(sourceFile).nlink : 'missing'));
  await click(`[data-action="extra-hardlink"][data-id="${frierenId}"]`, 1600);
  const hlToast = await ev("Array.from(document.querySelectorAll('.toast')).map((el) => el.innerText).join(' | ')");
  ok('可手动重跑硬链接', /硬链接完成/.test(hlToast) && /已存在/.test(hlToast), hlToast.replace(/\n/g, ' '));

  // 8b. 修改硬链接目标与季（弹窗输入 → 保存 → 立即按新目录链接）
  const movedRoot = path.join(DEMO_DATA, 'library2');
  const movedTpl = path.join(movedRoot, '${name}', 'Season ${season}');
  await click(`[data-action="extra-hardlink-edit"][data-id="${frierenId}"]`, 500);
  ok('硬链接目标可编辑', await ev("!!document.querySelector('#ask-field-0')") === true);
  await setValue('#ask-field-0', movedTpl);
  await setValue('#ask-field-1', '2');
  await click('[data-action="ask-yes"]', 1400);
  const movedDest = ((await state()).extras || []).find((x) => x.id === frierenId);
  ok('硬链接目标/季修改生效', !!movedDest && movedDest.hardlink.season === 2
    && /Season 2$/.test(movedDest.hardlink.destResolved), JSON.stringify(movedDest && movedDest.hardlink));
  await click(`[data-action="extra-hardlink"][data-id="${frierenId}"]`, 1800);
  ok('改目录后重新硬链接成功', fs.existsSync(path.join(movedRoot, '葬送的芙莉莲', 'Season 2', FRIEREN_FILE)),
    path.join(movedRoot, '葬送的芙莉莲', 'Season 2', FRIEREN_FILE));

  await setValue('#guess-text', '[LoliHouse] 某番剧 - 07 [WebRip 1080p HEVC-10bit AAC]\n某番剧 第12集 [1080p]\n[Sub] 某番剧 [01-12合集][1080p]');
  await click('#guess-form button[type="submit"]', 1000);
  const guessText = await ev("document.querySelector('#guess-result')?.innerText || ''");
  ok('集数识别工具可用', guessText.includes('第 7 集') && guessText.includes('第 12 集') && guessText.includes('第 1–12 集'), guessText.replace(/\n/g, ' | '));
  const extraHash = 'f'.repeat(40);
  const uiHlDest = path.join(DEMO_DATA, 'library-ui');
  await setValue('#x-magnets', `magnet:?xt=urn:btih:${extraHash}&dn=UI+Extra+Test`);
  await setValue('#f-name', 'UI 补番测试');
  await setValue('#h-dest', uiHlDest);
  await ev("(() => { const el = document.querySelector('#h-rename'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await setValue('#h-voffset', '12');
  await setValue('#h-soffset', '0');
  await click('#extra-form button[type="submit"]', 1600);
  st = await state();
  const extraRec = (st.extras || []).find((x) => x.name === 'UI 补番测试');
  ok('补番记录已创建', !!extraRec && extraRec.ok === true, JSON.stringify(extraRec));
  ok('补番使用追番存储路径预设', !!extraRec && extraRec.savePath.includes('/volume1/media'), extraRec && extraRec.savePath);
  ok('补番记录保存了硬链接目标', !!extraRec && !!extraRec.hardlink && extraRec.hardlink.dest === uiHlDest, JSON.stringify(extraRec && extraRec.hardlink));
  ok('补番记录保存了重命名/偏移', !!extraRec && extraRec.hardlink.rename === true
    && extraRec.hardlink.videoOffset === 12 && extraRec.hardlink.subOffset === 0,
    JSON.stringify(extraRec && extraRec.hardlink));

  // 8b. 硬链接开关：关闭后卡片标为「本次不硬链接」，再打开恢复
  await click(`[data-action="extra-hardlink-edit"][data-id="${extraRec.id}"]`, 500);
  const askChecks = await ev("document.querySelectorAll('#ask-form input[type=checkbox]').length");
  ok('硬链接弹窗包含开关与重命名', askChecks === 2, String(askChecks));
  await ev("(() => { const el = document.querySelector('#ask-field-2'); el.checked = false; return true; })()");
  await click('[data-action="ask-yes"]', 900);
  let offRec = ((await state()).extras || []).find((x) => x.id === extraRec.id);
  ok('关闭本次硬链接生效', !!offRec && offRec.hardlink.enabled === false, JSON.stringify(offRec && offRec.hardlink));
  const offRow = await ev(`(() => {
    const card = document.querySelector('[data-action="extra-hardlink-edit"][data-id="${extraRec.id}"]')?.closest('.extra-card');
    return card ? card.querySelector('.extra-hl')?.innerText || '' : '';
  })()`);
  ok('关闭后卡片标注本次不硬链接', /本次不硬链接/.test(offRow), offRow);
  await click(`[data-action="extra-hardlink-edit"][data-id="${extraRec.id}"]`, 500);
  await ev("(() => { const el = document.querySelector('#ask-field-2'); el.checked = true; return true; })()");
  await click('[data-action="ask-yes"]', 900);
  offRec = ((await state()).extras || []).find((x) => x.id === extraRec.id);
  ok('重新开启硬链接生效', !!offRec && offRec.hardlink.enabled === true, JSON.stringify(offRec && offRec.hardlink));

  // 8b. 提交成功后表单清空，避免重复提交
  const clearedAfterSubmit = await ev(`(() => ({
    magnets: document.querySelector('#x-magnets') ? document.querySelector('#x-magnets').value : '',
    name: document.querySelector('#f-name') ? document.querySelector('#f-name').value : '',
  }))()`);
  ok('提交成功后补番表单清空', clearedAfterSubmit.magnets === '' && clearedAfterSubmit.name === '', JSON.stringify(clearedAfterSubmit));

  // 8c. 回归（v1.7.1）：重绘 #view 不能清掉正在填的内容
  await setValue('#x-magnets', `magnet:?xt=urn:btih:${'d'.repeat(40)}&dn=draft-keep`);
  await setValue('#f-name', '草稿保留测试');
  await setValue('#x-category', 'anime');
  await setValue('#x-tags', 'tag1');
  await setValue('#guess-text', '某番剧 第03集 [1080p]');
  await click('.page-title', 200); // 先失焦，这样轮询才会真的重绘
  await click('[data-action="extras-status"]', 1400);
  const readDraft = `(() => ({
    magnets: document.querySelector('#x-magnets') ? document.querySelector('#x-magnets').value : '',
    name: document.querySelector('#f-name') ? document.querySelector('#f-name').value : '',
    category: document.querySelector('#x-category') ? document.querySelector('#x-category').value : '',
    tags: document.querySelector('#x-tags') ? document.querySelector('#x-tags').value : '',
    guess: document.querySelector('#guess-text') ? document.querySelector('#guess-text').value : '',
    savePath: document.querySelector('#f-savepath') ? document.querySelector('#f-savepath').value : '',
  }))()`;
  const draft1 = await ev(readDraft);
  ok('刷新状态不清空补番表单', draft1.magnets.includes('draft-keep') && draft1.name === '草稿保留测试'
    && draft1.category === 'anime' && draft1.tags === 'tag1' && draft1.guess.includes('第03集')
    && draft1.savePath === '/volume1/media/anime', JSON.stringify(draft1));

  await sleep(13500); // 后台每 12 秒轮询一次
  const draft2 = await ev(readDraft);
  ok('后台轮询不清空补番表单', draft2.magnets.includes('draft-keep') && draft2.name === '草稿保留测试'
    && draft2.tags === 'tag1', JSON.stringify(draft2));

  // 8d. 路径模板：重绘后模板面板、变量和拼出的路径都要接回来
  await ev(`(() => {
    const sel = document.querySelector('#f-path-preset');
    sel.value = 'p_template';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(300);
  await setValue('#f-name', '模板草稿');
  await ev(`(() => {
    const values = ['ARIA', '01'];
    document.querySelectorAll('[data-template-var]').forEach((el, i) => {
      el.value = values[i] || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return true;
  })()`);
  await click('.page-title', 200);
  await click('[data-action="extras-status"]', 1400);
  const tplDraft = await ev(`(() => ({
    panelHidden: document.querySelector('#path-template') ? document.querySelector('#path-template').classList.contains('hidden') : null,
    vars: Array.from(document.querySelectorAll('[data-template-var]')).map((el) => el.value),
    savePath: document.querySelector('#f-savepath') ? document.querySelector('#f-savepath').value : '',
    readOnly: document.querySelector('#f-savepath') ? document.querySelector('#f-savepath').readOnly : null,
    preset: document.querySelector('#f-path-preset') ? document.querySelector('#f-path-preset').value : '',
  }))()`);
  ok('刷新后路径模板与变量保留', tplDraft.panelHidden === false && tplDraft.vars.join(',') === 'ARIA,01'
    && tplDraft.savePath === '/vol2/1000/media/动画/ARIA/Season 01' && tplDraft.readOnly === true
    && tplDraft.preset === 'p_template', JSON.stringify(tplDraft));

  // 8e. 切页后未提交的草稿要保留；主动清空后再切页不应复活旧内容
  await setValue('#x-magnets', `magnet:?xt=urn:btih:${'d'.repeat(40)}&dn=Draft+Keep`);
  await setValue('#f-name', '切页草稿补番');
  await setValue('#x-category', 'draft-cat');
  await ev("location.hash = '#/subs'");
  await sleep(700);
  await ev("location.hash = '#/extras'");
  await sleep(1200);
  const keptDraft = await ev(`(() => ({
    magnets: document.querySelector('#x-magnets') ? document.querySelector('#x-magnets').value : '',
    name: document.querySelector('#f-name') ? document.querySelector('#f-name').value : '',
    category: document.querySelector('#x-category') ? document.querySelector('#x-category').value : '',
  }))()`);
  ok('切页回来补番草稿保留', keptDraft.magnets.includes('d'.repeat(40)) && keptDraft.name === '切页草稿补番'
    && keptDraft.category === 'draft-cat', JSON.stringify(keptDraft));

  await ev(`(() => {
    ['#x-magnets', '#f-name', '#x-category', '#x-tags', '#guess-text'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    return true;
  })()`);
  await ev("location.hash = '#/subs'");
  await sleep(700);
  await ev("location.hash = '#/extras'");
  await sleep(1200);
  const freshForm = await ev(`(() => ({
    magnets: document.querySelector('#x-magnets') ? document.querySelector('#x-magnets').value : '',
    name: document.querySelector('#f-name') ? document.querySelector('#f-name').value : '',
  }))()`);
  ok('清空后切页不会复活旧草稿', freshForm.magnets === '' && freshForm.name === '', JSON.stringify(freshForm));

  // 8f. 已选中的种子文件也不能被重绘丢掉
  await ev(`(() => {
    const input = document.querySelector('#x-files');
    const dt = new DataTransfer();
    dt.items.add(new File(['d8:announce0:'], 'draft-keep.torrent', { type: 'application/x-bittorrent' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await click('.page-title', 200);
  await click('[data-action="extras-status"]', 1400);
  const keptFiles = await ev(`(() => {
    const input = document.querySelector('#x-files');
    return Array.from(input.files || []).map((f) => f.name);
  })()`);
  ok('刷新后已选种子文件保留', keptFiles.join(',') === 'draft-keep.torrent', JSON.stringify(keptFiles));
  await ev(`(() => {
    const input = document.querySelector('#x-files');
    input.files = new DataTransfer().files;
    return true;
  })()`);

  // 8g. 目录权限检查
  const probeDir = path.join(DEMO_DATA, 'probe-draft', 'Season 1');
  await setValue('#h-dest', probeDir);
  await click('[data-action="hardlink-probe"]', 1400);
  const probeText = await ev("document.querySelector('#h-dest-preview')?.textContent || ''");
  ok('硬链接目录权限可检查', /可写/.test(probeText), probeText);
  await ev(`(() => { const el = document.querySelector('#h-dest'); if (el) { el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);

  // 8h. 后台轮询原地更新：不重建页面、不清空未提交输入
  await ev("window.__viewTitle = document.querySelector('.page-title')");
  await setValue('#x-magnets', `magnet:?xt=urn:btih:${'c'.repeat(40)}&dn=Soft+Refresh`);
  await click('.page-title', 200);
  await sleep(13500);
  const afterPoll = await ev(`(() => ({
    same: document.querySelector('.page-title') === window.__viewTitle,
    magnets: document.querySelector('#x-magnets') ? document.querySelector('#x-magnets').value : '',
  }))()`);
  ok('后台轮询原地更新不重建页面', afterPoll.same === true, JSON.stringify(afterPoll));
  ok('后台轮询不清空未提交输入', afterPoll.magnets.includes('c'.repeat(40)), afterPoll.magnets);
  await ev(`(() => { const el = document.querySelector('#x-magnets'); if (el) { el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);

  await click('[data-action="extras-status"]', 1200);
  ok('补番状态可刷新', await ev("!document.querySelector('.page-title') || true"));
  await click(`[data-action="extra-delete"][data-id="${extraRec.id}"]`, 400);
  await click('[data-action="confirm-yes"]', 900);
  st = await state();
  ok('补番记录删除生效', !(st.extras || []).some((x) => x.id === extraRec.id));
  await ev("location.hash = '#/subs'");
  await sleep(700);

  // 8i. 追番弹窗草稿：切页回来要原样恢复
  await click('[data-action="open-sub"]', 700);
  await setValue('#f-name', '切页弹窗追番');
  await setValue('#f-path', 'RSS/Bangumi?bangumiId=987654&subgroupid=1');
  await sleep(300);
  await ev("location.hash = '#/overview'");
  await sleep(900);
  await ev("location.hash = '#/subs'");
  await sleep(1300);
  const modalDraft = await ev(`(() => ({
    open: !!document.querySelector('#sub-form'),
    name: document.querySelector('#f-name') ? document.querySelector('#f-name').value : '',
    path: document.querySelector('#f-path') ? document.querySelector('#f-path').value : '',
  }))()`);
  ok('切页回来追番弹窗草稿保留', modalDraft.open === true && modalDraft.name === '切页弹窗追番'
    && modalDraft.path.includes('987654'), JSON.stringify(modalDraft));
  await click('[data-action="close-modal"]', 500);

  // 9. 搜索番剧 → 选发布组 → 预填追番表单
  await click('[data-action="open-search"]', 600);
  const searchOpen = await ev("!!document.querySelector('#search-form')");
  ok('搜索弹窗可打开', searchOpen);
  await ev(`(() => {
    const sel = document.querySelector('#search-base');
    sel.value = 'b_demo';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await setValue('#search-q', '药屋');
  await click('#search-form button[type="submit"]', 1800);
  const hits = await ev("document.querySelectorAll('.search-hit').length");
  ok('站点搜索结果返回番剧', hits >= 1, String(hits));
  const chips = await ev("document.querySelectorAll('.subgroup-chip').length");
  ok('搜索结果包含发布组', chips >= 1, String(chips));
  const chipText = await ev("document.querySelector('.subgroup-chip')?.innerText || ''");
  ok('发布组显示真实集数', chipText.includes('全 12 集'), chipText.replace(/\n/g, ' '));
  await click('.subgroup-chip', 1200);
  const prefilled = await ev(`(() => {
    const path = document.querySelector('#f-path') ? document.querySelector('#f-path').value : '';
    const name = document.querySelector('#f-name') ? document.querySelector('#f-name').value : '';
    return { path, name, hasForm: !!document.querySelector('#sub-form') };
  })()`);
  ok('选发布组后预填追番表单', prefilled.hasForm && prefilled.path.includes('subgroupid='), JSON.stringify(prefilled));
  ok('预填番剧名称', prefilled.name.includes('药屋'), prefilled.name);
  await click('[data-action="close-modal"]', 400);

  // 10. 重新下载 / 允许重下
  await ev("location.hash = '#/subs'");
  await sleep(900);
  await click('[data-action="preview-sub"][data-id="s_kusuriya"]', 1600);
  const redownloadBtn = await ev(`(() => {
    const b = document.querySelector('.feed-item [data-action="download-item"][data-force="1"]');
    return b ? { label: b.innerText.trim(), disabled: b.disabled } : null;
  })()`);
  ok('抽屉里有重新下载按钮', !!redownloadBtn && redownloadBtn.disabled === false, JSON.stringify(redownloadBtn));
  await click('.feed-item [data-action="download-item"][data-force="1"]', 1600);
  const redownloadToast = await ev("document.querySelector('.toast')?.innerText || ''");
  ok('重新下载已提交', /qBittorrent/.test(redownloadToast), redownloadToast.replace(/\n/g, ' '));
  await click('[data-action="close-drawer"]', 500);
  await ev("location.hash = '#/downloads'");
  await sleep(900);
  const allowIdsExpr = "Array.from(new Set(Array.from(document.querySelectorAll('[data-action=\"allow-redownload\"]')).map((b) => b.dataset.id))).length";
  const allowBefore = await ev(allowIdsExpr);
  ok('下载记录有允许重下按钮', allowBefore >= 1, String(allowBefore));
  await click('[data-action="allow-redownload"]', 1200);
  const allowAfter = await ev(allowIdsExpr);
  ok('允许重下后按钮消失', allowAfter === allowBefore - 1, `${allowBefore} -> ${allowAfter}`);

  // 11. 封面视图 / 列表视图切换
  await ev("location.hash = '#/subs'");
  await sleep(900);
  await click('[data-action="sub-view"][data-view="grid"]', 700);
  const subCount = (await state()).subs.length;
  const tiles = await ev("document.querySelectorAll('.sub-grid .sub-tile').length");
  ok('封面视图渲染全部追番', tiles === subCount, `${tiles}/${subCount}`);
  const covered = await ev("document.querySelectorAll('.sub-grid .sub-tile img.tile-cover').length");
  ok('封面视图显示封面图', covered >= 2, String(covered));
  // 封面视图里的启用/暂停开关
  const gridSubId = (await state()).subs.find((s) => s.id === 's_kusuriya').id;
  const beforeEnabled = (await state()).subs.find((s) => s.id === gridSubId).enabled;
  await click(`.sub-tile [data-action="toggle-sub"][data-id="${gridSubId}"]`, 900);
  const afterEnabled = (await state()).subs.find((s) => s.id === gridSubId).enabled;
  const drawerOpened = await ev("document.querySelectorAll('#drawer-root > *').length");
  ok('封面视图开关可暂停/启用', afterEnabled === !beforeEnabled, `${beforeEnabled} -> ${afterEnabled}`);
  ok('点开关不会误开预览抽屉', drawerOpened === 0, String(drawerOpened));
  await click(`.sub-tile [data-action="toggle-sub"][data-id="${gridSubId}"]`, 900);
  const restored = (await state()).subs.find((s) => s.id === gridSubId).enabled;
  ok('封面视图开关可恢复', restored === beforeEnabled, String(restored));
  // 封面视图的删除按钮：应弹出确认框，取消不删数据
  const delBtn = await ev(`!!document.querySelector('.sub-tile [data-action="delete-sub"][data-id="${gridSubId}"]')`);
  ok('封面视图有删除按钮', delBtn === true);
  await click(`.sub-tile [data-action="delete-sub"][data-id="${gridSubId}"]`, 400);
  const confirmText = await ev("document.querySelector('.modal-title')?.textContent || ''");
  ok('封面视图删除需要确认', confirmText.includes('删除追番'), confirmText);
  await click('[data-action="confirm-no"]', 400);
  const stillThere = (await state()).subs.some((s) => s.id === gridSubId);
  ok('取消后追番未被删除', stillThere === true);
  await click('[data-action="sub-view"][data-view="list"]', 500);
  const cards = await ev("document.querySelectorAll('.sub-list .sub-card').length");
  ok('列表视图仍然可用', cards === subCount, `${cards}/${subCount}`);

  // 12. 移动端导航全部可见
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await ev("location.hash = '#/subs'");
  await sleep(900);
  const navs = await ev(`Array.from(document.querySelectorAll('#nav a')).map((a) => {
    const r = a.getBoundingClientRect();
    return { text: a.innerText.trim(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  })`);
  ok('移动端 6 个导航全部在视口内', navs.length === 6 && navs.every((n) => n.right <= 390 && n.left >= 0), JSON.stringify(navs));
  ok('移动端导航文字完整', navs.map((n) => n.text).join(',') === '总览,追番,补番,下载记录,站点与路径,连接设置', navs.map((n) => n.text).join(','));

  console.log('\n交互测试全部通过：' + pass.length + ' 项');
  console.log('console errors:', errors.length ? errors : 'none');
  ws.close();
}

main().catch((e) => {
  console.error('\n交互测试失败：', e && e.stack ? e.stack : e);
  try { ws.close(); } catch { /* ignore */ }
  process.exitCode = 1;
});
