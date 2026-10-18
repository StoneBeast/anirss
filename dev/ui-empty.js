'use strict';

const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const APP = process.env.EMPTY_APP || 'http://127.0.0.1:8791';
const OUT = path.resolve(__dirname, '..', '..', 'work', 'ui');
fs.mkdirSync(OUT, { recursive: true });

let ws;
let nextId = 1;
const pending = new Map();
const waiters = new Map();
const errors = [];

async function main() {
  const targets = await (await fetch(CDP + '/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 20000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const waitEvent = (method) => new Promise((resolve) => {
    const list = waiters.get(method) || [];
    list.push({ resolve });
    waiters.set(method, list);
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP + '/?empty=' + Date.now() + '#/overview' });
  await new Promise((r) => setTimeout(r, 1800));
  errors.length = 0;

  const text = await evaluate('document.body.innerText');
  console.log('setup visible:', text.includes('三步开始'));
  console.log('unverified visible:', text.includes('尚未验证') || text.includes('未验证'));
  console.log('empty subs:', text.includes('还没有追番') || text.includes('新增追番'));

  const metrics = await send('Page.getLayoutMetrics');
  const size = metrics.cssContentSize;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: Math.min(1800, Math.ceil(size.height)), scale: 1 },
  });
  const file = path.join(OUT, '13-empty-overview.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('screenshot:', file);
  console.log('console errors:', errors.length ? errors : 'none');
  ws.close();
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  try { ws.close(); } catch { /* ignore */ }
  process.exitCode = 1;
});
