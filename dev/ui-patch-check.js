'use strict';

/**
 * 针对 keyed patch 的快速检查：
 * 1. 下载表格行有 data-key；
 * 2. 软刷新（等一轮 12s 轮询）后列表节点是“复用”而非重建（引用不变）。
 * 前提：Chrome 9222 + 演示实例 8777（同 dev/ui-actions.js）。
 */

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8777';

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, 15000);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function main() {
  const targets = await (await fetch(CDP + '/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p(msg.result);
    }
  };

  await send('Page.enable');
  await send('Page.navigate', { url: APP + '/#/downloads' });
  await new Promise((r) => setTimeout(r, 2500));

  // 行上有 data-key
  const keyInfo = await send('Runtime.evaluate', {
    expression: `(() => {
      const rows = [...document.querySelectorAll('.download-table tbody tr')];
      return { rows: rows.length, keyed: rows.filter((r) => r.getAttribute('data-key')).length };
    })()`,
    returnByValue: true,
  });
  const { rows, keyed } = keyInfo.result.value;
  console.log(`下载表格行: ${rows}，带 data-key: ${keyed}`);
  if (!rows || keyed !== rows) { console.error('✗ 表格行缺少 data-key'); process.exit(1); }

  // 记住第一行引用，滚动到底，等一轮轮询（12s）后确认节点被复用
  await send('Runtime.evaluate', {
    expression: `window.__rowRef = document.querySelector('.download-table tbody tr');
      window.__cardRef = document.querySelector('.download-card');
      document.querySelector('.table-wrap').scrollTop = 99999; 'ok'`,
    returnByValue: true,
  });
  console.log('等待一轮后台轮询（~13s）…');
  await new Promise((r) => setTimeout(r, 13000));

  const reused = await send('Runtime.evaluate', {
    expression: `(() => {
      const row = document.querySelector('.download-table tbody tr');
      const card = document.querySelector('.download-card');
      return {
        rowSame: row === window.__rowRef,
        cardSame: card === window.__cardRef,
        scroll: document.querySelector('.table-wrap').scrollTop,
      };
    })()`,
    returnByValue: true,
  }).then((r) => r.result.value);
  console.log(`轮询后节点复用: 表格行 ${reused.rowSame ? '✓ 复用' : '✗ 重建'}，卡片 ${reused.cardSame ? '✓ 复用' : '✗ 重建'}`);
  if (!reused.rowSame || !reused.cardSame) { console.error('✗ 软刷新重建了列表节点'); process.exit(1); }
  console.log('keyed patch 检查通过');
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
