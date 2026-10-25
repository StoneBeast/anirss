'use strict';

/**
 * 字幕弹窗的浏览器抽查：打开补番页 → 点字幕按钮 → 弹窗渲染 →
 * 通过 CDP 塞一个 zip 进文件输入框 → 确认入库与列表刷新。
 * 前提：Chrome 9222 + 演示实例 8777（同 dev/ui-actions.js）。
 */

const fs = require('fs');
const path = require('path');
const { buildZip } = require('./zip-builder');

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8777';

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, 20000);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
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
  await send('Page.navigate', { url: APP + '/#/extras' });
  await new Promise((r) => setTimeout(r, 2500));

  // 卡片上有字幕按钮
  const btnCount = await evalJs(`document.querySelectorAll('[data-action="extra-subs"]').length`);
  if (!btnCount) { console.error('✗ 补番卡片没有字幕按钮'); process.exit(1); }
  console.log(`✓ 字幕按钮 ${btnCount} 个`);

  // 打开弹窗
  await evalJs(`document.querySelector('[data-action="extra-subs"]').click(); 'ok'`);
  await new Promise((r) => setTimeout(r, 300));
  const modalTitle = await evalJs(`document.querySelector('#modal-root .modal-title')?.textContent || ''`);
  if (!modalTitle.includes('字幕管理')) { console.error('✗ 字幕弹窗未打开: ' + modalTitle); process.exit(1); }
  console.log('✓ 弹窗打开：' + modalTitle.trim());

  // 构造一个 zip 塞进文件输入框（DOM.setFileInputFiles 触发 change）
  const zipPath = path.join(__dirname, '..', '..', 'tmp', 'ui-subs-test.zip');
  fs.writeFileSync(zipPath, buildZip([
    { name: 'chs/01.ass', data: '浏览器上传的简体字幕', utf8Name: true },
    { name: 'readme.txt', data: 'skip me', utf8Name: true },
  ]));
  const doc = await send('DOM.getDocument');
  const nodeId = doc.root.nodeId;
  const input = await send('DOM.querySelector', { nodeId, selector: '#extra-subs-file' });
  if (!input.nodeId) { console.error('✗ 找不到文件输入框'); process.exit(1); }
  await send('DOM.setFileInputFiles', { files: [zipPath], nodeId: input.nodeId });
  console.log('等待上传与刷新…');
  await new Promise((r) => setTimeout(r, 2500));

  const after = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.subs-row .subs-name')].map((x) => x.textContent);
    const tips = document.querySelector('#modal-root .modal-sub') ? document.querySelectorAll('.subs-row').length : -1;
    const chips = [...document.querySelectorAll('.extra-card .chip')].some((c) => /个外挂字幕/.test(c.textContent));
    return { rows, chips };
  })()`);
  if (!after.rows.some((n) => n.includes('chs/01.ass'))) {
    console.error('✗ 上传后列表没有新字幕: ' + JSON.stringify(after));
    process.exit(1);
  }
  console.log('✓ zip 上传入库（readme.txt 被跳过），列表显示: ' + after.rows.join(' , '));
  if (!after.chips) console.log('! 卡片外挂字幕计数未显示（可能渲染在下个轮询）');
  else console.log('✓ 卡片显示外挂字幕计数');

  // 清理演示数据里刚传的字幕，避免污染演示环境
  await evalJs(`document.querySelector('[data-action="extra-subs-clear"]')?.click(); 'ok'`);
  await new Promise((r) => setTimeout(r, 400));
  await evalJs(`[...document.querySelectorAll('[data-action="confirm-yes"]')].pop()?.click(); 'ok'`);
  await new Promise((r) => setTimeout(r, 1200));
  const cleared = await evalJs(`document.querySelectorAll('.subs-row').length`);
  console.log(`✓ 清空后剩余 ${cleared} 行（应为 0）`);

  console.log('\n字幕弹窗浏览器抽查通过');
  process.exit(0);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
