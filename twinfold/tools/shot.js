// Headless Chrome screenshot/playtest helper (muted). Usage:
//   node tools/shot.js <outDir> [step ...]   where a step is  "js:<expression>"  "wait:<ms>"  "shot:<name>"
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const out = process.argv[2];
const steps = process.argv.slice(3);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(out, 'profile');
fs.mkdirSync(out, { recursive: true });

const proc = spawn(CHROME, ['--headless=new', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`,
  '--window-size=1300,740', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let ws;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {};
  const errors = [];
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) errors.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 740, deviceScaleFactor: 1, mobile: false });
  const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/') + (process.env.Q || '');
  await send('Page.navigate', { url });
  await sleep(1200);
  for (const st of steps) {
    const [k, ...rest] = st.split(':'); const v = rest.join(':');
    if (k === 'wait') await sleep(+v);
    else if (k === 'js') {
      const r = await send('Runtime.evaluate', { expression: v, awaitPromise: true, returnByValue: true });
      const val = r.result?.result?.value;
      if (r.result?.exceptionDetails) errors.push('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      else if (val !== undefined) console.log('js =>', typeof val === 'string' ? val : JSON.stringify(val));
    } else if (k === 'mouse') { // mouse:x:y:button(0|2)
      const [x, y, b] = v.split(':').map(Number); const button = b === 2 ? 'right' : 'left';
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: b === 2 ? 2 : 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
    } else if (k === 'move') { const [x, y] = v.split(':').map(Number); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    } else if (k === 'down' || k === 'up') { // down:KeyA:a
      const [code, key] = v.split(':');
      await send('Input.dispatchKeyEvent', { type: k === 'down' ? 'keyDown' : 'keyUp', code, key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : (key === ' ' ? 32 : 0) });
    } else if (k === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(out, v + '.png'); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('saved', f);
    }
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error(e); proc.kill(); process.exit(1); });
