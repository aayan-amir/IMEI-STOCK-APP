const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function stream() {
  const track = { stopped: 0, stop() { this.stopped++; }, getCapabilities: () => ({}), getSettings: () => ({}), applyConstraints: async () => {} };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
function screen() {
  const scheduled = [], frames = [], scripts = [];
  const b = browserContext({ setTimeout: fn => { scheduled.push(fn); return scheduled.length; }, clearTimeout() {}, requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {} });
  for (const file of ['globals', 'utils', 'imei', 'scanner']) b.load('public/js/' + file + '.js');
  const s = b.context, messages = []; s.showToast = message => messages.push(message);
  s.navigator = { mediaDevices: { getUserMedia: async () => stream(), enumerateDevices: async () => [] } };
  s.BarcodeDetector = class { static async getSupportedFormats() { return ['code_128']; } async detect() { return []; } };
  const create = s.document.createElement.bind(s.document);
  s.document.createElement = tag => tag === 'canvas' ? { getContext: () => ({ drawImage() {} }) } : tag === 'script' ? { remove() {} } : create(tag);
  s.document.head = { appendChild: script => scripts.push(script) };
  const video = s.document.getElementById('camVideo'); Object.assign(video, { play: async () => {}, pause() {}, readyState: 2, videoWidth: 640, videoHeight: 480, clientWidth: 320, clientHeight: 240, addEventListener() {}, removeEventListener() {} });
  return { s, b, scripts, scheduled, frames, messages, video };
}

test('ordinary app entry does not eagerly request the292357-byte fallback decoder', () => {
  const html = require('node:fs').readFileSync('public/index.html', 'utf8'); assert.equal(/<script[^>]+src=["'][^"']*zxing/.test(html), false, "Decoder must load on first use");
});

test('closing while camera permission is pending stops the late stream and cannot reopen the scanner', async () => {
  const { s, video } = screen(), late = stream(); let release;
  s.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; });
  const opening = s.openCamera(); s.closeCamera(); release(late); await opening;
  assert.ok(late.track.stopped); assert.equal(s.camStream, null); assert.equal(video.srcObject, null); assert.equal(s.document.getElementById('camModal').style.display, 'none');
});

test('a rejected camera request preserves manual entry and reports permission recovery', async () => {
  const { s, messages } = screen(); s.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(Error('denied'), { name: 'NotAllowedError' }); };
  s.document.getElementById('imeiInput').value = '001234567890123'; await s.openCamera();
  assert.equal(s.camStream, null); assert.equal(s.document.getElementById('imeiInput').value, '001234567890123'); assert.match(messages[0], /permission|allow/i);
});

test('a closed native decode result cannot populate a field or dispatch a stock action', async () => {
  const { s, frames, video } = screen(); let release, detections = 0;
  s.BarcodeDetector = class { static async getSupportedFormats() { return ['code_128']; } detect() { return new Promise(resolve => { release = resolve; }); } };
  s.onBarcodeDetected = () => { detections++; }; await s.openCamera();
  const scanning = frames.shift()(); s.closeCamera(); release([{ rawValue: '001234567890123', format: 'code_128' }]); await scanning;
  assert.equal(detections, 0); assert.equal(video.srcObject, null);
});

test('fallback loading is single flight, recoverable after failure and never requests the API origin', async () => {
  const { s, scripts } = screen(); delete s.BarcodeDetector;
  const first = s.loadBarcodeFallback(), second = s.loadBarcodeFallback(); assert.equal(scripts.length, 1); assert.equal(scripts[0].src, '/js/zxing.min.js');
  scripts[0].onerror(); await assert.rejects(first); await assert.rejects(second);
  const retry = s.loadBarcodeFallback(); assert.equal(scripts.length, 2);
  s.ZXing = { BrowserMultiFormatReader: class {} }; scripts[1].onload(); await retry;
});


test('hiding the app closes an active camera and stops its track', async () => {
  const { s, b } = screen(); const active = stream(); s.navigator.mediaDevices.getUserMedia = async () => active;
  await s.openCamera(); s.document.hidden = true; b.listeners.get('visibilitychange')?.();
  assert.ok(active.track.stopped); assert.equal(s.camStream, null);
});

test('closing removes pending video readiness listeners instead of retaining detached callbacks', async () => {
  const { s, video, scheduled, frames } = screen(), listeners = new Map(); video.readyState = 0;
  video.addEventListener = (name, fn) => listeners.set(name, fn); video.removeEventListener = name => listeners.delete(name);
  await s.openCamera(); assert.equal(listeners.size, 2); s.closeCamera();
  assert.equal(listeners.size, 0); for (const callback of scheduled) callback(); assert.equal(frames.length, 0);
});

test('a delayed focus reset from an old scanner cannot change a newly opened camera', async () => {
  const { s, scheduled } = screen(), first = stream(), second = stream(); let newConstraints = 0;
  second.track.applyConstraints = async () => { newConstraints++; };
  s.navigator.mediaDevices.getUserMedia = async () => first; await s.openCamera(); await s.triggerFocus();
  s.closeCamera(); s.navigator.mediaDevices.getUserMedia = async () => second; await s.openCamera();
  for (const callback of scheduled) await callback(); assert.equal(newConstraints, 0);
});

test('a late permission result from an earlier opening cannot replace or stop the newer stream', async () => {
  const { s } = screen(), old = stream(), current = stream(); let release;
  s.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; }); const earlier = s.openCamera('imei1');
  s.navigator.mediaDevices.getUserMedia = async () => current; await s.openCamera('imei2'); release(old); await earlier;
  assert.equal(s.camStream, current); assert.ok(old.track.stopped); assert.equal(current.track.stopped, 0); assert.equal(s.camMode, 'imei2');
});


test('Escape cancels a camera opening before permission resolves', async () => {
  const { s, b } = screen(), late = stream(); let release;
  s.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; }); const opening = s.openCamera();
  b.listeners.get('keydown')({ key: 'Escape' }); release(late); await opening; assert.ok(late.track.stopped);
});

test('session expiration stops the active stream before showing another sign-in screen', async () => {
  const { s } = screen(), active = stream(); s.authRole = 'admin'; s.localStorage.setItem('authToken', 'camera-token');
  s.navigator.mediaDevices.getUserMedia = async () => active; await s.openCamera(); s.expireSession('camera-token');
  assert.ok(active.track.stopped); assert.equal(s.camStream, null);
});

test('navigating to another workflow closes the scanner', async () => {
  const { s, b } = screen(), active = stream(); b.load('public/js/ui.js');
  s.shopModeActive = false; s.IS_PHONE = false; s.authRole = 'admin'; s.navigator.mediaDevices.getUserMedia = async () => active;
  await s.openCamera(); s.nav('scan'); assert.ok(active.track.stopped); assert.equal(s.camStream, null);
});

test('a decode finishing after authenticated owner change cannot dispatch a scan result', async () => {
  const { s, frames } = screen(); let release, detections = 0;
  s.BarcodeDetector = class { static async getSupportedFormats() { return ['code_128']; } detect() { return new Promise(resolve => { release = resolve; }); } };
  s.onBarcodeDetected = () => { detections++; }; await s.openCamera(); const pending = frames.shift()();
  s.localStorage.setItem('authToken', 'new-owner-token'); release([{ rawValue: '001234567890123', format: 'code_128' }]); await pending;
  assert.equal(detections, 0); assert.equal(s.camStream, null);
});


test('unsupported optional camera capabilities do not shut down a usable camera', async () => {
  const { s } = screen(), active = stream(); active.track.getCapabilities = () => { throw Error('unsupported capabilities'); };
  s.navigator.mediaDevices.getUserMedia = async () => active; await s.openCamera();
  assert.equal(s.camStream, active); assert.equal(s.document.getElementById('torchBtn').style.opacity, '0.3');
});

test('closing during delayed video playback does not restart decoding or retain a stream', async () => {
  const { s, video } = screen(), active = stream(); let release, started;
  const playing = new Promise(resolve => { started = resolve; });
  video.play = () => { started(); return new Promise(resolve => { release = resolve; }); };
  s.navigator.mediaDevices.getUserMedia = async () => active; const opening = s.openCamera(); await playing;
  s.closeCamera(); release(); await opening;
  assert.ok(active.track.stopped); assert.equal(s.camStream, null); assert.equal(s.scanActive, false);
});


test('owner change during permission closes its abandoned opening without showing a stale overlay', async () => {
  const { s } = screen(), late = stream(); let release;
  s.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; }); const opening = s.openCamera();
  s.localStorage.setItem('authToken', 'another-owner'); release(late); await opening;
  assert.ok(late.track.stopped); assert.equal(s.cameraOpening, false); assert.equal(s.document.getElementById('camModal').style.display, 'none');
});

test('an already settled decoder callback cannot reset a newer shared loading attempt', async () => {
  const { s, scripts } = screen(); delete s.BarcodeDetector;
  const old = s.loadBarcodeFallback(), oldFailure = scripts[0].onerror; oldFailure(); await assert.rejects(old);
  const retry = s.loadBarcodeFallback(); oldFailure(); const shared = s.loadBarcodeFallback(); assert.equal(scripts.length, 2);
  s.ZXing = { BrowserMultiFormatReader: class {} }; scripts[1].onload(); await retry; await shared;
});


test('synchronous decoder insertion failure clears its shared request immediately for successful retry', async () => {
  const { s, scripts } = screen(); let attempts = 0;
  s.document.head.appendChild = script => { attempts++; if (attempts === 1) throw Error('script insertion unavailable'); scripts.push(script); };
  await assert.rejects(s.loadBarcodeFallback()); const retry = s.loadBarcodeFallback();
  assert.equal(attempts, 2); assert.equal(scripts.length, 1); s.ZXing = { BrowserMultiFormatReader: class {} }; scripts[0].onload(); await retry;
});
