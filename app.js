import * as S from './store.js';
import * as V from './speech.js';
import { $, show, onLeave } from './ui.js';
import { updateResume, autoPrepare } from './bible-ui.js';
import * as C from './commands.js';
import * as A from './audio.js';

const REFINE_URL = '';   // Cloudflare Worker 주소. 비어 있으면 「다듬기」 숨김.
let store = S.load(localStorage);
let current = null;      // 보기 화면의 Prayer
let clauses = [];        // 녹음 화면에 쌓인 구절들
let removeIdx = -1;      // 빼기 확인 중인 구절 번호
let afterStop = null;    // 인식이 멈춘 뒤 할 일: 'confirm' | 'remove'
let source = 'typed';
let parts = [];          // 이번 기도의 녹음 조각들
let currentAudio = [];   // 보기 화면에 미리 읽어 둔 녹음 조각들
let lastDeleted = null;  // 되살리기용
let undoTimer = null;

// ---------- 화면 전환 ----------
onLeave.push(() => { V.stopSpeaking(); $('speak').textContent = '읽어주기'; A.stop(); $('playVoice').textContent = '내 목소리로 듣기'; });
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
$('toRecord').addEventListener('click', () => { clauses = []; parts = []; resetRecord(); show('record'); });

// ---------- 첫 안내 ----------
$('introDone').addEventListener('click', () => { try { localStorage.setItem('introSeen', '1'); } catch {} renderHome(); });
$('showIntro').addEventListener('click', () => show('intro'));

// ---------- 녹음 조각 ----------
async function keepPart() {
  const blob = await A.stopRecording();
  if (blob) parts.push(blob);
}

// ---------- 녹음 ----------
function renderLive(interim = '') {
  const box = $('live');
  box.innerHTML = '';
  clauses.forEach((c, i) => {
    const p = document.createElement('p');
    p.className = 'clause' + (i === removeIdx ? ' gone' : '');
    const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1;
    p.append(n, c);
    box.append(p);
  });
  if (interim) { const p = document.createElement('p'); p.className = 'clause interim'; p.textContent = interim; box.append(p); }
  box.scrollTop = box.scrollHeight;   // 길어지면 맨 아래(방금 말한 것)가 보이게
}
function resetRecord() {
  removeIdx = -1;
  afterStop = null;
  renderLive();
  setRecState('idle');
}
function setRecState(state, detail) {
  const mic = $('mic');
  mic.classList.toggle('listening', state === 'listening');
  mic.textContent = state === 'listening' ? '그만' : '말하기';
  mic.hidden = state === 'typed' || state === 'remove';
  $('toTyped').hidden = state !== 'idle' && state !== 'paused' && state !== 'notfound';
  $('pausedRow').hidden = state !== 'paused' && state !== 'notfound';
  $('removeRow').hidden = state !== 'remove';
  $('typedBox').hidden = state !== 'typed';
  const msg = {
    idle: ['', '버튼을 누르고 말씀하세요. "됐어요"라고 하면 끝나요'],
    requesting: ['마이크 사용을 허락해 주세요', ''],
    listening: ['듣고 있어요', '"됐어요"로 끝내고, "3번 빼줘"로 지워요'],
    finishing: ['정리하고 있어요', ''],
    paused: ['잠시 멈췄어요', '더 말씀하시려면 「이어서 말하기」'],
    remove: ['이 부분을 뺄까요?', ''],
    notfound: ['어느 부분인지 못 찾았어요', '이어서 말씀하시거나, 저장 전에 글에서 고쳐 주세요'],
    typed: [detail || '', '다 적으면 아래 버튼을 누르세요'],
  }[state] || ['', ''];
  $('recStatus').textContent = msg[0];
  $('recHint').textContent = msg[1];
}
// 인식을 멈추고, 멈춘 뒤 what을 한다. iOS가 onend를 안 주면 3초 뒤 강제로.
function stopFor(what) {
  afterStop = what;
  setRecState('finishing');
  A.beep(660);
  V.stop();
  finishTimer = setTimeout(onStopped, 3000);
}
function onStopped() {
  clearTimeout(finishTimer);
  keepPart();
  const what = afterStop;
  afterStop = null;
  if (what === 'remove') setRecState(removeIdx >= 0 ? 'remove' : 'notfound');
  else if (what === 'confirm') goConfirm();
}
function showTyped(reason) {
  source = 'typed';
  $('typed').value = clauses.join('\n');   // 말한 게 있으면 이어서 적을 수 있게
  setRecState('typed', reason);
  $('typed').focus();
}
$('toTyped').addEventListener('click', () => showTyped(''));
let finishTimer = null;
function startListening() {
  if (!V.canListen) { showTyped('이 기기는 음성 인식이 안 돼요. 대신 적어 주세요'); return; }
  source = 'speech';
  removeIdx = -1;
  V.start({
    onText(fresh, interim) {
      if (afterStop) return;                       // 멈추는 중에 온 결과는 무시
      for (const seg of fresh) {
        const r = C.ingest(clauses, seg);
        clauses = r.clauses;
        if (r.action?.type === 'end') { renderLive(); stopFor('confirm'); return; }
        if (r.action?.type === 'remove') { removeIdx = r.action.index; renderLive(); stopFor('remove'); return; }
      }
      renderLive(interim);
    },
    onState(state) {
      if (state === 'requesting') { setRecState(state); return; }
      if (state === 'listening') { setRecState(state); A.beep(880); A.startRecording(); return; }
      renderLive();
      if (afterStop) { onStopped(); return; }
      keepPart();
      if (state === 'paused') setRecState('paused');
      else if (state === 'done') goConfirm();
      else if (state === 'denied') showTyped('마이크를 쓸 수 없어요. 대신 적어 주세요');
      else showTyped('음성 인식이 안 돼요. 대신 적어 주세요');
    },
  });
}
$('mic').addEventListener('click', () => {
  A.prepareBeep();
  if ($('mic').classList.contains('listening')) stopFor('confirm');
  else startListening();
});
$('resume').addEventListener('click', startListening);
$('finish').addEventListener('click', goConfirm);
// 빼기 답을 하면 바로 다시 듣는다 (어르신이 「이어서 말하기」를 누르지 않아도 되게)
$('removeYes').addEventListener('click', () => { if (removeIdx >= 0) clauses.splice(removeIdx, 1); removeIdx = -1; renderLive(); startListening(); });
$('removeNo').addEventListener('click', () => { removeIdx = -1; renderLive(); startListening(); });
$('typedDone').addEventListener('click', () => { clauses = linesOf($('typed').value); goConfirm(); });
function linesOf(text) { return text.split('\n').map(s => s.trim()).filter(Boolean); }

// ---------- 확인 ----------
function goConfirm() {
  $('confirmText').value = clauses.join('\n');
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
  const id = next.prayers[0].id;
  const toSave = parts; parts = [];
  if (toSave.length) {
    // 녹음은 덤: 실패해도 글은 이미 저장됐다
    A.saveParts(id, toSave).then(n => { if (n) { const s2 = S.setAudio(store, id, n); try { S.save(localStorage, s2); store = s2; } catch {} } });
  }
  renderHome();
});
$('more').addEventListener('click', () => { clauses = linesOf($('confirmText').value); resetRecord(); show('record'); startListening(); });
$('redo').addEventListener('click', () => { clauses = []; parts = []; resetRecord(); show('record'); });

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
  currentAudio = [];
  $('playVoice').hidden = true;
  renderView();
  show('view');
  if (current.audioParts > 0) {
    // 미리 읽어 두면 버튼 누름(사용자 동작) 안에서 바로 재생할 수 있다 (iOS)
    A.loadParts(id, current.audioParts).then(blobs => {
      if (current?.id === id && blobs.length) { currentAudio = blobs; $('playVoice').hidden = false; }
    });
  }
}
$('playVoice').addEventListener('click', () => {
  if ($('playVoice').textContent === '멈춤') { A.stop(); $('playVoice').textContent = '내 목소리로 듣기'; return; }
  A.play(currentAudio, () => { $('playVoice').textContent = '내 목소리로 듣기'; });
  $('playVoice').textContent = '멈춤';
});
function updatePrayer(next) {
  try { S.save(localStorage, next); } catch { $('viewMsg').textContent = '저장하지 못했어요. 다시 눌러 주세요'; return false; }
  store = next;
  if (current) current = store.prayers.find(p => p.id === current.id) || current;
  if (current && !$('view').hidden) renderView();
  return true;
}
$('refine').addEventListener('click', async () => {
  if (!navigator.onLine) { $('viewMsg').textContent = '인터넷이 필요해요'; return; }
  const id = current.id;            // 응답이 올 때 다른 기도를 보고 있어도 이 기도에 저장
  const text = current.original;
  $('refine').disabled = true;
  $('viewMsg').textContent = '다듬는 중…';
  try {
    const r = await fetch(REFINE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(r.status);
    const { refined } = await r.json();
    if (!refined) throw new Error('empty');
    if (!store.prayers.some(p => p.id === id)) throw new Error('gone');   // 그새 지워졌으면 버림
    if (updatePrayer(S.setRefined(store, id, refined)) && current?.id === id) $('viewMsg').textContent = '';
  } catch {
    if (current?.id === id) $('viewMsg').textContent = '지금은 다듬을 수 없어요. 나중에 다시 해주세요';
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
  finishUndo();                     // 이전에 지운 게 있으면 그건 확정
  lastDeleted = current;
  $('undoRow').hidden = false;
  undoTimer = setTimeout(finishUndo, 6000);
  renderHome();
});
// 되살리기 시간이 끝나면 녹음 조각도 지운다
function finishUndo() {
  clearTimeout(undoTimer);
  $('undoRow').hidden = true;
  if (lastDeleted?.audioParts > 0) A.deleteParts(lastDeleted.id, lastDeleted.audioParts);
  lastDeleted = null;
}
$('undo').addEventListener('click', () => {
  if (!lastDeleted) return;
  clearTimeout(undoTimer);
  const next = S.restore(store, lastDeleted);
  try { S.save(localStorage, next); store = next; } catch {}
  lastDeleted = null;
  $('undoRow').hidden = true;
  renderHome();
});

// ---------- 설정 ----------
function applySize(size) {
  document.documentElement.dataset.size = size;
  document.querySelectorAll('.size').forEach(b => b.classList.toggle('on', b.dataset.size === size));
  try { localStorage.setItem('fontSize', size); } catch {}
}
document.querySelectorAll('.size').forEach(b => b.addEventListener('click', () => applySize(b.dataset.size)));
function renderBeep() {
  let off = false;
  try { off = localStorage.getItem('beep') === 'off'; } catch {}
  $('beepToggle').textContent = off ? '소리 신호 켜기' : '소리 신호 끄기';
}
$('beepToggle').addEventListener('click', () => {
  try { localStorage.setItem('beep', localStorage.getItem('beep') === 'off' ? 'on' : 'off'); } catch {}
  renderBeep();
});
renderBeep();
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
let introSeen = false;
try { introSeen = !!localStorage.getItem('introSeen'); } catch {}
if (introSeen) renderHome(); else { renderHome(); show('intro'); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
autoPrepare();
