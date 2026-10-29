'use strict';

/**
 * 浏览器返回栈检查：站内切页（总览 / 追番 / 补番 …）不应该往历史里压栈，
 * 手机上按一次返回就应该离开页面，而不是先退回上一个标签页。
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
  const targets = await (await fetch(CDP + '/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的页面目标，先打开 Chrome');
  ws = new WebSocket(page.webSocketDebuggerUrl);
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

  console.log(failures === 0 ? `\n全部通过（${checks} 项）` : `\n失败 ${failures} 项`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
