// 내 목소리 녹음: 녹음 시작/멈춤, 조각 보관(IndexedDB), 이어 듣기, 삐 소리. 실패는 전부 조용히 넘긴다.

// ---------- 녹음 ----------
export const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
let rec = null, stream = null, chunks = [];

export async function startRecording() {
  if (!canRecord || rec) return false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(stream);
    chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start();
    return true;
  } catch { stopStream(); rec = null; return false; }
}
// 녹음 조각(Blob) 또는 null
export function stopRecording() {
  return new Promise(resolve => {
    if (!rec || rec.state === 'inactive') { stopStream(); rec = null; resolve(null); return; }
    const r = rec;
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/mp4' });
      stopStream(); rec = null; chunks = [];
      resolve(blob.size ? blob : null);
    };
    try { r.stop(); } catch { stopStream(); rec = null; resolve(null); }
  });
}
function stopStream() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

// ---------- 보관 ----------
const DB = 'prayer-audio', STORE = 'parts';
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function run(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const results = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(results.map(r => r.result));
    t.onerror = () => reject(t.error);
  }));
}
// 조각들을 저장하고 저장된 개수를 돌려준다. 실패하면 0.
export async function saveParts(id, blobs) {
  try { await run('readwrite', s => blobs.map((b, i) => s.put(b, `${id}:${i}`))); return blobs.length; }
  catch { return 0; }
}
export async function loadParts(id, n) {
  try { const out = await run('readonly', s => Array.from({ length: n }, (_, i) => s.get(`${id}:${i}`))); return out.filter(Boolean); }
  catch { return []; }
}
export async function deleteParts(id, n) {
  try { await run('readwrite', s => Array.from({ length: n }, (_, i) => s.delete(`${id}:${i}`))); } catch {}
}

// ---------- 듣기 ----------
let player = null, urls = [];
export function play(blobs, onEnd) {
  stop();
  urls = blobs.map(b => URL.createObjectURL(b));
  let i = 0;
  player = new Audio();
  const finish = () => { stop(); onEnd(); };
  const next = () => {
    if (i >= urls.length) { finish(); return; }
    player.src = urls[i++];
    player.play().catch(finish);
  };
  player.onended = next;
  player.onerror = finish;
  next();
}
export function stop() {
  if (player) { player.onended = null; player.onerror = null; player.pause(); player.removeAttribute('src'); player = null; }
  urls.forEach(u => URL.revokeObjectURL(u));
  urls = [];
}

// ---------- 삐 소리 ----------
let ctx = null;
export function prepareBeep() {          // 사용자 동작 안에서 한 번 부른다 (iOS)
  try { ctx ??= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch {}
}
export function beep(freq = 880, ms = 120) {
  try {
    if (!ctx || localStorage.getItem('beep') === 'off') return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + ms / 1000);
  } catch {}
}
