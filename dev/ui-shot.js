'use strict';

/**
 * 通过 Chrome DevTools Protocol 截图 + 做基础交互验收。
 * 前提：Chrome 以 --remote-debugging-port=9222 运行，qbrss 演示实例在 8777。
 */

const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8777';
const OUT = path.resolve(__dirname, '..', '..', 'work', 'ui');
fs.mkdirSync(OUT, { recursive: true });

let ws;
let nextId = 1;
const pending = new Map();
const eventWaiters = new Map();
const errors = [];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect() {
  const targets = await (await fetch(CDP + '/json/list')).json();
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    const res = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    page = await res.json();
  }
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
    if (waiters && waiters.length) {
      const w = waiters.shift();
      w.resolve(msg.params);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push('LOG: ' + msg.params.entry.text);
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      errors.push('HTTP ' + msg.params.response.status + ': ' + msg.params.response.url);
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
    const timer = setTimeout(() => {
      const idx = list.indexOf(waiter);
      if (idx >= 0) list.splice(idx, 1);
      reject(new Error('event timeout: ' + method));
    }, timeout || 15000);
    const waiter = {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
    };
    list.push(waiter);
    eventWaiters.set(method, list);
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text + ' ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || ''));
  }
  return res.result ? res.result.value : undefined;
}

async function gotoHash(hash, wait) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(wait || 900);
}

async function screenshot(name, opts) {
  const options = opts || {};
  if (options.width || options.height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: options.width || 1440,
      height: options.height || 1100,
      deviceScaleFactor: 1,
      mobile: !!options.mobile,
    });
    await sleep(300);
  }
  let clip;
  if (options.full) {
    const metrics = await send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const height = Math.min(options.maxHeight || 4400, Math.ceil(size.height));
    clip = { x: 0, y: 0, width: options.width || 1440, height, scale: 1 };
  }
  const params = { format: 'png', captureBeyondViewport: !!clip };
  if (clip) params.clip = clip;
  const res = await send('Page.captureScreenshot', params);
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  const info = { file, width: clip ? clip.width : (options.width || 1440), height: clip ? clip.height : (options.height || 1100) };
  console.log('screenshot:', file, info.width + 'x' + info.height);
  return file;
}

async function click(selector, wait) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error('click target not found: ' + selector);
  await sleep(wait || 600);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: APP + '/?ui=' + Date.now() + '#/overview' });
  await waitEvent('Page.loadEventFired', 15000).catch(() => {});
  await sleep(2200);
  errors.length = 0; // 清掉上一个页面/上一次会话残留的 Log 缓冲

  const title = await evaluate('document.title');
  const text = await evaluate('document.body.innerText.slice(0, 800)');
  console.log('title:', title);
  console.log('has overview:', text.includes('个追番正在自动守候') || text.includes('把 RSS 追番变成'));
  await screenshot('01-overview', { full: true, maxHeight: 1600 });

  await gotoHash('#/subs', 1000);
  await screenshot('02-subs', { full: true, maxHeight: 2200 });

  // 封面视图
  await click('[data-action="sub-view"][data-view="grid"]', 1000);
  const tileBox = await evaluate(`(() => {
    const el = document.querySelector('.sub-tile');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 30 };
  })()`);
  if (tileBox) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tileBox.x, y: tileBox.y, button: 'none' });
    await sleep(400);
  }
  await screenshot('02b-sub-grid', { full: true, maxHeight: 1600 });
  const tiles = await evaluate("document.querySelectorAll('.sub-grid .sub-tile').length");
  console.log('grid tiles:', tiles);
  await click('[data-action="sub-view"][data-view="list"]', 500);

  // 预览抽屉
  await click('[data-action="preview-sub"]', 1400);
  await screenshot('03-drawer', { width: 1440, height: 1100 });
  await click('[data-action="close-drawer"]', 400);

  // 新增追番弹窗
  await click('[data-action="open-sub"]', 600);
  await screenshot('04-sub-modal', { width: 1440, height: 1800 });
  const regexError = await evaluate("document.querySelector('#regex-error') ? document.querySelector('#regex-error').textContent : 'no-field'");
  console.log('regex error empty:', regexError === '');
  const templateVars = await evaluate("document.querySelectorAll('[data-template-var]').length");
  console.log('template vars:', templateVars);
  await click('[data-action="fill-example"]', 500);
  const composed = await evaluate("document.querySelector('#url-preview code').textContent");
  console.log('composed URL:', composed);
  await evaluate(`(() => {
    const values = ['\${name}', '01'];
    document.querySelectorAll('[data-template-var]').forEach((el, i) => {
      el.value = values[i] || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return true;
  })()`);
  // 等自动获取的追番名称落进输入框，模板里的 ${name} 才会展开
  for (let i = 0; i < 20; i++) {
    const nameValue = await evaluate("document.querySelector('#f-name')?.value || ''");
    if (nameValue) break;
    await sleep(400);
  }
  await sleep(300);
  await sleep(300);
  const savePath = await evaluate("document.querySelector('#f-savepath').value");
  const readOnly = await evaluate("document.querySelector('#f-savepath').readOnly");
  console.log('rendered savePath:', savePath, 'readonly:', readOnly);
  await screenshot('04b-sub-modal-filled', { width: 1440, height: 1800 });
  // 预览用本地演示源，避免真实站点波动影响截图
  await evaluate(`(() => {
    const sel = document.querySelector('#f-base');
    if (sel) { sel.value = 'b_demo'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const path = document.querySelector('#f-path');
    if (path) { path.value = '/RSS/Bangumi?bangumiId=4059&subgroupid=203'; path.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  })()`);
  await sleep(400);
  await click('[data-action="preview-form"]', 4000);
  const previewText = await evaluate("(document.querySelector('#sub-preview-result')?.innerText || 'no-preview').slice(0, 200)");
  console.log('preview result:', previewText.replace(/\n/g, ' | '));
  await screenshot('04c-sub-preview', { width: 1440, height: 1800 });
  await click('[data-action="close-modal"]', 300);

  await gotoHash('#/downloads', 900);
  await screenshot('05-downloads', { width: 1440, height: 1100 });

  await gotoHash('#/library', 900);
  await screenshot('06-library', { width: 1440, height: 1000 });

  await gotoHash('#/connection', 1100);
  await screenshot('07-connection', { width: 1440, height: 1150 });

  // 补番
  await gotoHash('#/extras', 1200);
  await screenshot('15-extras', { full: true, maxHeight: 2200 });

  // 搜索番剧弹窗
  await gotoHash('#/subs', 700);
  await click('[data-action="open-search"]', 600);
  await evaluate(`(() => {
    const sel = document.querySelector('#search-base');
    if (sel) { sel.value = 'b_demo'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const q = document.querySelector('#search-q');
    if (q) q.value = '药屋';
    return true;
  })()`);
  await click('#search-form button[type="submit"]', 2200);
  const searchHits = await evaluate("document.querySelectorAll('.search-hit').length");
  console.log('search hits:', searchHits);
  await screenshot('16-search', { width: 1440, height: 1250 });
  await click('[data-action="close-modal"]', 400);

  // 主题切换回归
  await gotoHash('#/overview', 700);
  const lightTheme = await evaluate("document.documentElement.getAttribute('data-theme')");
  await click('#theme-toggle', 500);
  const darkTheme = await evaluate("document.documentElement.getAttribute('data-theme')");
  console.log('theme before/after:', lightTheme, darkTheme);
  await screenshot('14-dark-overview', { width: 1440, height: 1100 });
  await click('#theme-toggle', 500);

  // 移动端
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await gotoHash('#/overview', 1000);
  await screenshot('08-mobile-overview', { width: 390, height: 844, full: true, maxHeight: 2400 });
  await gotoHash('#/subs', 900);
  await screenshot('09-mobile-subs', { width: 390, height: 844, full: true, maxHeight: 2400 });
  await gotoHash('#/downloads', 900);
  await screenshot('10-mobile-downloads', { width: 390, height: 844, full: true, maxHeight: 2600 });
  await gotoHash('#/library', 800);
  await screenshot('11-mobile-library', { width: 390, height: 844, full: true, maxHeight: 2400 });
  await gotoHash('#/connection', 800);
  await screenshot('12-mobile-connection', { width: 390, height: 844, full: true, maxHeight: 2600 });

  console.log('\nconsole errors:', errors.length ? errors : 'none');
  ws.close();
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  try { ws.close(); } catch { /* ignore */ }
  process.exitCode = 1;
});
