'use strict';

/**
 * 浏览器返回栈检查：站内切页（总览 / 追番 / 补番 …）不应该往历史里压栈，
 * 手机上按一次返回就应该离开页面，而不是先退回上一个标签页；
 * 弹窗 / 抽屉打开时则先关弹层，关掉之后再按返回才离开页面。
 *
 * 前提：Chrome 以 --remote-debugging-port=9222 运行，anirss 演示实例在 8777（同 dev/ui-actions.js）。
 * 运行：node dev/ui-history-check.js
 */

const CDP = process.env.ANIRSS_CDP || 'http://127.0.0.1:9222';
const APP = process.env.ANIRSS_APP || 'http://127.0.0.1:8777';

let ws;
let nextId = 1;
const pending = new Map();
let failures = 0;
let checks = 0;

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout ' + method));
    }, 20000);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result && r.result.value;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 轮询等待页面条件成立（站点搜索要真的出网，固定 sleep 容易偶发失败） */
async function waitFor(expression, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(300);
  }
  return false;
}

function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `（实际 ${JSON.stringify(actual)}，应为 ${JSON.stringify(expected)}）`}`);
}

async function snapshot() {
  return evaluate(`(() => ({
    href: location.href,
    hash: location.hash,
    length: history.length,
    crumb: (document.querySelector('#crumb') || {}).textContent || '',
  }))()`);
}

async function navigate(url, waitMs) {
  await send('Page.navigate', { url });
  await sleep(waitMs || 2500);
}

async function main() {
  // 用独立的新标签页跑：历史记录从 1 开始，不受上一次运行残留的前进/后退记录影响
  const created = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  if (!created || !created.webSocketDebuggerUrl) throw new Error('新建标签页失败：' + JSON.stringify(created));
  ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const fn = pending.get(msg.id);
      pending.delete(msg.id);
      fn(msg.result || msg.error || {});
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // 场景 A：从外部页面进入 → 总览 → 追番 → 补番，一次返回到外部页面
  await navigate('about:blank', 500);
  const base = await evaluate('history.length');
  await navigate(APP + '/', 3000);

  const a0 = await snapshot();
  check('默认落在总览', a0.hash, '#/overview');
  check('首屏不额外增加历史记录', a0.length, base + 1);

  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(700);
  const a1 = await snapshot();
  check('点「追番」切换页面', a1.hash, '#/subs');
  check('点「追番」不压历史', a1.length, a0.length);

  await evaluate(`document.querySelector('#nav a[data-nav="extras"]').click()`);
  await sleep(900);
  const a2 = await snapshot();
  check('点「补番」切换页面', a2.hash, '#/extras');
  check('点「补番」不压历史', a2.length, a0.length);

  await evaluate(`document.querySelector('#nav a[data-nav="extras"]').click()`);
  await sleep(300);
  check('重复点当前标签也不压历史', (await snapshot()).length, a0.length);

  await evaluate('history.back()');
  await sleep(1500);
  const a3 = await snapshot();
  check('一次返回直接离开页面', a3.href, 'about:blank');

  // 场景 B：带 hash 的深链进入，切页后一次返回同样是离开页面
  await navigate(APP + '/#/extras', 3000);
  const b0 = await snapshot();
  check('深链落在补番', b0.hash, '#/extras');

  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(700);
  const b1 = await snapshot();
  check('深链后切到追番', b1.hash, '#/subs');
  check('深链后切页不压历史', b1.length, b0.length);

  await evaluate('history.back()');
  await sleep(1500);
  check('深链后一次返回直接离开页面', (await snapshot()).href, 'about:blank');

  // 场景 C：页面内容里的站内链接（卡片上的「全部记录」）同样走替换
  await navigate(APP + '/', 3000);
  const c0 = await snapshot();
  const clicked = await evaluate(`(() => {
    const a = document.querySelector('.view a[href="#/downloads"]');
    if (!a) return false;
    a.click();
    return true;
  })()`);
  await sleep(900);
  const c1 = await snapshot();
  check('总览里有「全部记录」站内链接', clicked, true);
  check('内容链接切换到下载记录', c1.hash, '#/downloads');
  check('内容链接不压历史', c1.length, c0.length);

  // 场景 D：打开弹窗后按返回，先关弹窗而不是离开页面
  await navigate('about:blank', 500);
  await navigate(APP + '/', 3000);
  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(700);
  const d0 = await snapshot();
  await evaluate(`document.querySelector('[data-action="open-sub"]').click()`);
  await sleep(700);
  const dOpen = await evaluate(`document.querySelectorAll('#modal-root > *').length`);
  check('点「新增追番」打开弹窗', dOpen > 0, true);
  check('打开弹窗压一条历史', await evaluate('history.length'), d0.length + 1);

  await evaluate('history.back()');
  await sleep(900);
  check('返回先关掉弹窗', await evaluate(`document.querySelectorAll('#modal-root > *').length`), 0);
  check('关弹窗后仍留在追番页', (await snapshot()).hash, '#/subs');

  await evaluate('history.back()');
  await sleep(1500);
  check('弹窗关掉后再返回才离开页面', (await snapshot()).href, 'about:blank');

  // 场景 E：用 × 关掉弹窗，返回一次就离开页面（不会留下一次空返回）
  await navigate('about:blank', 500);
  await navigate(APP + '/', 3000);
  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(700);
  const e0 = await snapshot();
  await evaluate(`document.querySelector('[data-action="open-sub"]').click()`);
  await sleep(700);
  await evaluate(`document.querySelector('#modal-root [data-action="close-modal"]').click()`);
  await sleep(800);
  check('× 能关掉弹窗', await evaluate(`document.querySelectorAll('#modal-root > *').length`), 0);
  check('× 关窗后历史长度不变', await evaluate('history.length'), e0.length + 1);

  await evaluate('history.back()');
  await sleep(1500);
  check('× 关窗后一次返回就离开页面', (await snapshot()).href, 'about:blank');

  // 场景 F：预览抽屉打开时，返回先关抽屉
  await navigate('about:blank', 500);
  await navigate(APP + '/', 3000);
  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(900);
  const f0 = await snapshot();
  const fOpened = await evaluate(`(() => {
    const row = document.querySelector('[data-action="preview-sub"]');
    if (!row) return false;
    row.click();
    return true;
  })()`);
  await sleep(900);
  check('追番列表里能打开预览抽屉', fOpened, true);
  check('抽屉已打开', await evaluate(`document.querySelectorAll('#drawer-root > *').length`) > 0, true);
  check('打开抽屉压一条历史', await evaluate('history.length'), f0.length + 1);

  await evaluate('history.back()');
  await sleep(900);
  check('返回先关掉抽屉', await evaluate(`document.querySelectorAll('#drawer-root > *').length`), 0);
  check('关抽屉后仍留在追番页', (await snapshot()).hash, '#/subs');

  await evaluate('history.back()');
  await sleep(1500);
  check('抽屉关掉后再返回才离开页面', (await snapshot()).href, 'about:blank');

  // 场景 G：确认类弹窗（删除追番）按返回等于取消，不会真删
  await navigate('about:blank', 500);
  await navigate(APP + '/', 3000);
  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(900);
  const g0 = await snapshot();
  const beforeRows = await evaluate(`document.querySelectorAll('[data-action="delete-sub"]').length`);
  await evaluate(`document.querySelector('[data-action="delete-sub"]').click()`);
  await sleep(700);
  check('删除按钮弹出确认框', await evaluate(`document.querySelectorAll('#modal-root > *').length`) > 0, true);
  check('确认框也压一条历史', await evaluate('history.length'), g0.length + 1);
  await evaluate('history.back()');
  await sleep(900);
  check('返回关掉确认框', await evaluate(`document.querySelectorAll('#modal-root > *').length`), 0);
  check('取消后追番数量不变', await evaluate(`document.querySelectorAll('[data-action="delete-sub"]').length`), beforeRows);
  check('取消后删除按钮没有卡在忙碌态', await evaluate(`(() => {
    const el = document.querySelector('[data-action="delete-sub"]');
    return !!el && !el.disabled && !el.classList.contains('is-busy');
  })()`), true);
  await evaluate('history.back()');
  await sleep(1500);
  check('确认框关掉后再返回才离开页面', (await snapshot()).href, 'about:blank');

  // 场景 H：抽屉用 × 关掉后，一次返回就离开页面
  await navigate('about:blank', 500);
  await navigate(APP + '/', 3000);
  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(900);
  const h0 = await snapshot();
  await evaluate(`document.querySelector('[data-action="preview-sub"]').click()`);
  await sleep(900);
  await evaluate(`document.querySelector('#drawer-root [data-action="close-drawer"]').click()`);
  await sleep(800);
  check('× 能关掉抽屉', await evaluate(`document.querySelectorAll('#drawer-root > *').length`), 0);
  check('× 关抽屉后历史长度不变', await evaluate('history.length'), h0.length + 1);
  await evaluate('history.back()');
  await sleep(1500);
  check('× 关抽屉后一次返回就离开页面', (await snapshot()).href, 'about:blank');

  // 场景 I：搜索结果里选字幕组 → 订阅表单替换搜索弹窗（同一条占位记录），返回仍先关表单
  await navigate('about:blank', 500);
  await navigate(APP + '/', 3000);
  await evaluate(`document.querySelector('#nav a[data-nav="subs"]').click()`);
  await sleep(700);
  const i0 = await snapshot();
  await evaluate(`document.querySelector('[data-action="open-search"]').click()`);
  await sleep(700);
  await evaluate(`(() => { document.querySelector('#search-q').value = '药屋'; })()`);
  await evaluate(`document.querySelector('#search-form button[type="submit"]').click()`);
  check('搜索结果里有字幕组按钮', await waitFor(`document.querySelectorAll('.subgroup-chip').length > 0`, 15000), true);
  await evaluate(`document.querySelector('.subgroup-chip').click()`);
  await sleep(800);
  check('选字幕组后打开订阅表单', await evaluate(`!!document.querySelector('#sub-form')`), true);
  check('搜索弹窗已被替换掉', await evaluate(`!!document.querySelector('#search-form')`), false);
  // 预填落在 #f-path（base 模式）或 #f-url（url 模式）都算成功
  check('表单里预填了字幕组 RSS', await evaluate(`(() => {
    const url = (document.querySelector('#f-url') || {}).value || '';
    const path = (document.querySelector('#f-path') || {}).value || '';
    return (url + path).includes('subgroupid=');
  })()`), true);
  check('选字幕组不额外压历史', await evaluate('history.length'), i0.length + 1);
  await evaluate('history.back()');
  await sleep(900);
  check('返回先关掉订阅表单', await evaluate(`document.querySelectorAll('#modal-root > *').length`), 0);
  check('关掉表单后仍留在追番页', (await snapshot()).hash, '#/subs');
  await evaluate('history.back()');
  await sleep(1500);
  check('表单关掉后再返回才离开页面', (await snapshot()).href, 'about:blank');

  console.log(failures === 0 ? `\n全部通过（${checks} 项）` : `\n失败 ${failures} 项`);
  await fetch(CDP + '/json/close/' + created.id).catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
