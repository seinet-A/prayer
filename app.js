import * as S from './store.js';
import * as V from './speech.js';
import { $, show, onLeave } from './ui.js';
import { updateResume, autoPrepare } from './bible-ui.js';

const REFINE_URL = '';   // Cloudflare Worker 주소. 비어 있으면 「다듬기」 숨김.
let store = S.load(localStorage);
let current = null;      // 보기 화면의 Prayer
let base = '';           // 녹음 화면에 쌓인 확정 글
let source = 'typed';

// ---------- 화면 전환 ----------
onLeave.push(() => { V.stopSpeaking(); $('speak').textContent = '읽어주기'; });
document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => show(b.dataset.to || 'home')));

// ---------- 홈 ----------
function renderHome() {
  const list = $('list');
  list.innerHTML = '';
  $('empty').hidden = store.prayers.length > 0;
  for (const p of store.prayers) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = S.formatDate(p.createdAt);
    b.append(date, S.shownText(p).split('\n')[0].slice(0, 30));
    b.addEventListener('click', () => openView(p.id));
    li.append(b);
    list.append(li);
  }
  updateResume();
  show('home');
}
$('toSettings').addEventListener('click', () => show('settings'));
$('toRecord').addEventListener('click', () => { base = ''; resetRecord(); show('record'); });

// ---------- 녹음 ----------
function resetRecord() {
  $('live').textContent = base;
  $('typed').value = '';
  setRecState('idle');
}
function setRecState(state, detail) {
  const mic = $('mic');
  mic.classList.toggle('listening', state === 'listening');
  mic.textContent = state === 'listening' ? '그만' : '말하기';
  mic.hidden = state === 'typed';
  $('pausedRow').hidden = state !== 'paused';
  $('typedBox').hidden = state !== 'typed';
  const msg = {
    idle: ['', '버튼을 누르고 말씀하세요'],
    requesting: ['마이크 사용을 허락해 주세요', ''],
    listening: ['듣고 있어요', '다 말씀하시면 「그만」을 누르세요'],
    finishing: ['정리하고 있어요', ''],
    paused: ['잠시 멈췄어요', '더 말씀하시려면 「이어서 말하기」'],
    typed: [detail || '', '다 적으면 아래 버튼을 누르세요'],
  }[state] || ['', ''];
  $('recStatus').textContent = msg[0];
  $('recHint').textContent = msg[1];
}
function showTyped(reason) {
  source = 'typed';
  setRecState('typed', reason);
  $('typed').focus();
}
let finishTimer = null;
function startListening() {
  if (!V.canListen) { showTyped('이 기기는 음성 인식이 안 돼요. 대신 적어 주세요'); return; }
  source = 'speech';
  let finals = '';
  V.start({
    onText(f, interim) { finals = f; $('live').textContent = base + finals + interim; },
    onState(state, detail) {
      if (state === 'listening' || state === 'requesting') { setRecState(state); return; }
      clearTimeout(finishTimer);
      base += finals; finals = '';
      $('live').textContent = base;
      if (state === 'paused') setRecState('paused');
      else if (state === 'done') goConfirm();
      else if (state === 'denied') showTyped('마이크를 쓸 수 없어요. 대신 적어 주세요');
      else showTyped('음성 인식이 안 돼요. 대신 적어 주세요');
    },
  });
}
function stopListening() {
  setRecState('finishing');
  V.stop();
  // iOS가 onend를 안 주는 경우 대비
  finishTimer = setTimeout(goConfirm, 3000);
}
$('mic').addEventListener('click', () => {
  if ($('mic').classList.contains('listening')) stopListening();
  else startListening();
});
$('resume').addEventListener('click', startListening);
$('finish').addEventListener('click', goConfirm);
$('typedDone').addEventListener('click', () => { base = $('typed').value; goConfirm(); });

// ---------- 확인 ----------
function goConfirm() {
  $('confirmText').value = base.trim();
  $('saveMsg').textContent = '';
  show('confirm');
}
$('save').addEventListener('click', () => {
  const text = $('confirmText').value.trim();
  if (!text) { $('saveMsg').textContent = '내용이 없어요'; return; }
  const next = S.add(store, text, source);
  try { S.save(localStorage, next); }
  catch { $('saveMsg').textContent = '저장하지 못했어요. 다시 눌러 주세요'; return; }
  store = next;
  renderHome();
});
$('more').addEventListener('click', () => { base = $('confirmText').value + ' '; resetRecord(); show('record'); startListening(); });
$('redo').addEventListener('click', () => { base = ''; resetRecord(); show('record'); });

// ---------- 보기 ----------
function renderView() {
  $('viewText').textContent = S.shownText(current);
  const refined = current.refined != null;
  $('refine').hidden = refined || !REFINE_URL;
  $('toggleText').hidden = !refined;
  $('toggleText').textContent = current.showing === 'refined' ? '원문으로' : '다듬은 글로';
}
function openView(id) {
  current = store.prayers.find(p => p.id === id);
  $('viewDate').textContent = S.formatDate(current.createdAt);
  $('viewMsg').textContent = '';
  $('delRow').hidden = true;
  $('del').hidden = false;
  renderView();
  show('view');
}
function updatePrayer(next) {
  try { S.save(localStorage, next); } catch { $('viewMsg').textContent = '저장하지 못했어요. 다시 눌러 주세요'; return false; }
  store = next;
  current = store.prayers.find(p => p.id === current.id);
  renderView();
  return true;
}
$('refine').addEventListener('click', async () => {
  if (!navigator.onLine) { $('viewMsg').textContent = '인터넷이 필요해요'; return; }
  $('refine').disabled = true;
  $('viewMsg').textContent = '다듬는 중…';
  try {
    const r = await fetch(REFINE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: current.original }) });
    if (!r.ok) throw new Error(r.status);
    const { refined } = await r.json();
    if (!refined) throw new Error('empty');
    if (updatePrayer(S.setRefined(store, current.id, refined))) $('viewMsg').textContent = '';
  } catch {
    $('viewMsg').textContent = '지금은 다듬을 수 없어요. 나중에 다시 해주세요';
  }
  $('refine').disabled = false;
});
$('toggleText').addEventListener('click', () => updatePrayer(S.toggleShowing(store, current.id)));
$('speak').addEventListener('click', () => {
  if ($('speak').textContent === '멈춤') { V.stopSpeaking(); $('speak').textContent = '읽어주기'; return; }
  if (V.voicesLoaded() && !V.hasKoreanVoice()) $('viewMsg').textContent = '한국어 읽어주기 음성이 없어요';
  const ok = V.speak(S.shownText(current), () => { $('speak').textContent = '읽어주기'; });
  if (ok) $('speak').textContent = '멈춤';
  else $('viewMsg').textContent = '이 기기는 읽어주기가 안 돼요';
});
$('share').addEventListener('click', async () => {
  const text = S.shownText(current);
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $('viewMsg').textContent = '복사했어요'; }
  } catch {}
});
$('del').addEventListener('click', () => { $('delRow').hidden = false; $('del').hidden = true; });
$('delNo').addEventListener('click', () => { $('delRow').hidden = true; $('del').hidden = false; });
$('delYes').addEventListener('click', () => {
  const next = S.remove(store, current.id);
  try { S.save(localStorage, next); }
  catch { $('viewMsg').textContent = '지우지 못했어요. 다시 눌러 주세요'; return; }
  store = next;
  renderHome();
});

// ---------- 설정 ----------
function applySize(size) {
  document.documentElement.dataset.size = size;
  document.querySelectorAll('.size').forEach(b => b.classList.toggle('on', b.dataset.size === size));
  try { localStorage.setItem('fontSize', size); } catch {}
}
document.querySelectorAll('.size').forEach(b => b.addEventListener('click', () => applySize(b.dataset.size)));
$('export').addEventListener('click', async () => {
  const file = new File([S.exportJSON(store)], `기도문-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch { return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  URL.revokeObjectURL(a.href);
  $('settingsMsg').textContent = '내려받았어요';
});

// ---------- 시작 ----------
let savedSize = 'normal';
try { savedSize = localStorage.getItem('fontSize') || 'normal'; } catch {}
applySize(savedSize);
navigator.storage?.persist?.();
renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
autoPrepare();
