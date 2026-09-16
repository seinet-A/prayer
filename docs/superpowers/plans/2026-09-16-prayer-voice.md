# 「말하면 기도문」 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이패드 홈화면 웹앱에서 큰 버튼을 눌러 말하면 기도문이 글로 저장되고, 다시 보고 읽어줄 수 있다.

**Architecture:** 순수 HTML/CSS/JS 정적 파일. `store.js`(저장 순수 함수)와 `speech.js`(음성↔글)는 `app.js`(화면)와 분리. 저장은 localStorage 한 키. 서비스워커로 오프라인.

**Tech Stack:** HTML, CSS, ES module JS, Web Speech API, localStorage, Service Worker. 빌드 도구·라이브러리 없음. 테스트는 node 내장 `assert`.

## Global Constraints

- 외부 라이브러리·빌드 도구 금지 (spec 6절).
- 본문 글자 28px 이상, 버튼 높이 80px 이상, 흰 바탕 검은 글씨, 밀기·길게 누르기 제스처 없음 (spec 3.4).
- 원문(`original`)은 저장 후 불변 (spec 2-2).
- 데이터 형태 `{ version: 1, prayers: Prayer[] }`, localStorage 키 `prayers` (spec 4).
- 되돌릴 수 없는 행동은 삭제뿐이며 2단계 확인 (spec 3.4).
- 파일 경로는 전부 `C:\Users\김성택\Claude\Projects\ch\` 기준 상대 경로.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `store.js` | 기도문 데이터 순수 함수: load/save/add/remove/shownText/toggleShowing/exportJSON/formatDate |
| `test_store.js` | `store.js` 검증 (node) |
| `speech.js` | 음성→글(`start/stop`), 글→음성(`speak/stopSpeaking/hasKoreanVoice`) |
| `index.html` | 화면 5개 섹션(home/record/confirm/view/settings) |
| `style.css` | 어르신용 크기·색 |
| `app.js` | 화면 전환·이벤트·상태 |
| `manifest.webmanifest`, `sw.js`, `icons/` | 홈화면 추가·오프라인 |
| `make_icons.py` | 아이콘 PNG 생성(1회) |

---

### Task 1: store.js — 저장 로직과 테스트

**Files:**
- Create: `store.js`
- Test: `test_store.js`

**Interfaces:**
- Produces:
  - `load(storage) → Store` (storage는 `getItem/setItem` 가진 객체, 깨진 데이터면 빈 Store)
  - `save(storage, store) → void` (실패 시 throw)
  - `add(store, text, source, now?: Date, id?: string) → Store` (새 기도가 맨 앞)
  - `remove(store, id) → Store`
  - `shownText(prayer) → string`
  - `toggleShowing(store, id) → Store` (refined 없으면 그대로)
  - `exportJSON(store) → string`
  - `formatDate(iso, now?: Date) → string` (예: `9월 16일 저녁`, 다른 해면 `2025년 9월 16일 저녁`)

- [ ] **Step 1: 실패하는 테스트 작성**

`test_store.js`:
```js
import assert from 'node:assert/strict';
import { load, save, add, remove, shownText, toggleShowing, exportJSON, formatDate } from './store.js';

function fakeStorage(initial) {
  const m = new Map(initial ? [['prayers', initial]] : []);
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) };
}

// load: 없음/깨짐/정상
assert.deepEqual(load(fakeStorage()), { version: 1, prayers: [] });
assert.deepEqual(load(fakeStorage('{not json')), { version: 1, prayers: [] });
assert.deepEqual(load(fakeStorage('{"version":9}')), { version: 1, prayers: [] });
const good = { version: 1, prayers: [{ id: 'a', createdAt: '2026-09-16T10:00:00.000Z', original: 'x', refined: null, refinedAt: null, showing: 'original', source: 'typed' }] };
assert.deepEqual(load(fakeStorage(JSON.stringify(good))), good);

// add: 맨 앞, trim, 필드
const now = new Date('2026-09-16T10:00:00.000Z');
let s = add({ version: 1, prayers: [] }, '  하나님 감사합니다  ', 'speech', now, 'id1');
assert.equal(s.prayers.length, 1);
assert.deepEqual(s.prayers[0], { id: 'id1', createdAt: '2026-09-16T10:00:00.000Z', original: '하나님 감사합니다', refined: null, refinedAt: null, showing: 'original', source: 'speech' });
s = add(s, '둘째', 'typed', now, 'id2');
assert.equal(s.prayers[0].id, 'id2');
assert.equal(s.prayers[1].id, 'id1');
assert.match(add(s, 'x', 'typed').prayers[0].id, /^[0-9a-f-]{36}$/);

// save/load 왕복
const st = fakeStorage();
save(st, s);
assert.deepEqual(load(st), s);

// remove
assert.deepEqual(remove(s, 'id1').prayers.map(p => p.id), ['id2']);
assert.deepEqual(remove(s, 'none').prayers.map(p => p.id), ['id2', 'id1']);

// shownText / toggleShowing
const p = s.prayers[1];
assert.equal(shownText(p), '하나님 감사합니다');
assert.equal(shownText({ ...p, showing: 'refined' }), '하나님 감사합니다'); // refined 없으면 원문
assert.equal(shownText({ ...p, refined: '다듬음', showing: 'refined' }), '다듬음');
assert.equal(toggleShowing(s, 'id1').prayers[1].showing, 'original'); // refined 없으면 안 바뀜
const withRefined = { version: 1, prayers: [{ ...p, refined: '다듬음' }] };
assert.equal(toggleShowing(withRefined, 'id1').prayers[0].showing, 'refined');
assert.equal(toggleShowing(toggleShowing(withRefined, 'id1'), 'id1').prayers[0].showing, 'original');
assert.equal(withRefined.prayers[0].showing, 'original'); // 원본 불변

// exportJSON
assert.deepEqual(JSON.parse(exportJSON(s)), s);

// formatDate (현지 시간 기준 아침/낮/저녁/밤, 같은 해면 연도 생략)
const y = now.getFullYear();
const iso = (h) => new Date(y, 8, 16, h, 0).toISOString();
assert.equal(formatDate(iso(7), now), '9월 16일 아침');
assert.equal(formatDate(iso(13), now), '9월 16일 낮');
assert.equal(formatDate(iso(19), now), '9월 16일 저녁');
assert.equal(formatDate(iso(23), now), '9월 16일 밤');
assert.equal(formatDate(iso(0), now), '9월 16일 밤');
assert.equal(formatDate(new Date(y - 1, 0, 1, 10).toISOString(), now), `${y - 1}년 1월 1일 아침`);

console.log('store.js OK');
```

- [ ] **Step 2: 실패 확인**

Run: `node test_store.js`
Expected: `ERR_MODULE_NOT_FOUND` (store.js 없음)

- [ ] **Step 3: 구현**

`store.js`:
```js
export const KEY = 'prayers';

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 1 && Array.isArray(d.prayers)) return d;
    }
  } catch {}
  return { version: 1, prayers: [] };
}

export function save(storage, store) {
  storage.setItem(KEY, JSON.stringify(store));
}

export function add(store, text, source, now = new Date(), id = crypto.randomUUID()) {
  const prayer = {
    id,
    createdAt: now.toISOString(),
    original: text.trim(),
    refined: null,
    refinedAt: null,
    showing: 'original',
    source,
  };
  return { ...store, prayers: [prayer, ...store.prayers] };
}

export function remove(store, id) {
  return { ...store, prayers: store.prayers.filter(p => p.id !== id) };
}

export function shownText(p) {
  return p.showing === 'refined' && p.refined != null ? p.refined : p.original;
}

export function toggleShowing(store, id) {
  return {
    ...store,
    prayers: store.prayers.map(p => {
      if (p.id !== id || p.refined == null) return p;
      return { ...p, showing: p.showing === 'refined' ? 'original' : 'refined' };
    }),
  };
}

export function exportJSON(store) {
  return JSON.stringify(store, null, 2);
}

export function formatDate(iso, now = new Date()) {
  const d = new Date(iso);
  const h = d.getHours();
  const part = h < 5 ? '밤' : h < 11 ? '아침' : h < 17 ? '낮' : h < 21 ? '저녁' : '밤';
  const year = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}년 `;
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 ${part}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test_store.js`
Expected: `store.js OK`

- [ ] **Step 5: 커밋**

```bash
git add store.js test_store.js
git commit -m "기도문 저장 로직과 테스트"
```

---

### Task 2: 화면 뼈대 — index.html, style.css, app.js (키보드 입력 경로까지)

이 태스크가 끝나면 음성 없이도 키보드로 기도를 적고·저장하고·보고·지울 수 있다.

**Files:**
- Create: `index.html`, `style.css`, `app.js`

**Interfaces:**
- Consumes: Task 1의 `store.js` 전부.
- Produces: `app.js` 안의 `setRecState(state, detail)`, `showTyped(reason)`, `goConfirm()`, `startListening()`, `stopListening()` (Task 3에서 음성으로 채움). 이 태스크에서는 마이크 버튼이 항상 키보드 칸을 연다.

- [ ] **Step 1: index.html**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="기도">
<meta name="theme-color" content="#ffffff">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<link rel="stylesheet" href="style.css">
<title>기도</title>
</head>
<body>
<main>

<section id="home">
  <header><span></span><h1>기도</h1><button id="toSettings" class="small">설정</button></header>
  <button id="toRecord" class="big primary">기도하기</button>
  <p id="empty" class="hint">아직 기도가 없어요. 위 버튼을 눌러 시작하세요.</p>
  <ul id="list"></ul>
</section>

<section id="record" hidden>
  <header><button class="back small">뒤로</button><h1>기도하기</h1><span></span></header>
  <button id="mic" class="mic">말하기</button>
  <p id="recStatus" class="status"></p>
  <p id="recHint" class="hint"></p>
  <div id="live" class="text"></div>
  <div id="pausedRow" class="row" hidden>
    <button id="resume" class="big">이어서 말하기</button>
    <button id="finish" class="big primary">다 했어요</button>
  </div>
  <div id="typedBox" hidden>
    <textarea id="typed" rows="6" placeholder="여기에 기도를 적어 주세요"></textarea>
    <button id="typedDone" class="big primary">다 적었어요</button>
  </div>
</section>

<section id="confirm" hidden>
  <header><button class="back small">뒤로</button><h1>확인</h1><span></span></header>
  <p class="hint">틀린 글자가 있으면 고쳐 주세요.</p>
  <textarea id="confirmText" rows="8"></textarea>
  <p id="saveMsg" class="status"></p>
  <button id="save" class="big primary">저장</button>
  <div class="row">
    <button id="more" class="big">이어서 말하기</button>
    <button id="redo" class="big">다시 하기</button>
  </div>
</section>

<section id="view" hidden>
  <header><button class="back small">뒤로</button><h1 id="viewDate"></h1><span></span></header>
  <div id="viewText" class="text"></div>
  <p id="viewMsg" class="status"></p>
  <div class="row">
    <button id="speak" class="big primary">읽어주기</button>
    <button id="share" class="big">공유</button>
  </div>
  <button id="del" class="big danger">지우기</button>
  <div id="delRow" hidden>
    <p class="status">정말 지울까요?</p>
    <div class="row">
      <button id="delYes" class="big danger">네, 지워요</button>
      <button id="delNo" class="big">아니요</button>
    </div>
  </div>
</section>

<section id="settings" hidden>
  <header><button class="back small">뒤로</button><h1>설정</h1><span></span></header>
  <p>글자 크기</p>
  <div class="row">
    <button class="big size" data-size="normal">보통</button>
    <button class="big size" data-size="large">크게</button>
    <button class="big size" data-size="xlarge">아주 크게</button>
  </div>
  <button id="export" class="big">전체 내보내기</button>
  <p id="settingsMsg" class="status"></p>
</section>

</main>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: style.css**

```css
:root { --fs: 28px; --btn: 80px; }
:root[data-size="large"] { --fs: 32px; --btn: 90px; }
:root[data-size="xlarge"] { --fs: 40px; --btn: 100px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; font-size: var(--fs); line-height: 1.6; color: #111; background: #fff; }
main { max-width: 800px; margin: 0 auto; padding: 16px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
header > * { min-width: 96px; }
header h1 { flex: 1; text-align: center; font-size: var(--fs); margin: 0; }
button { font: inherit; color: #111; background: #f2f2f2; border: 2px solid #888; border-radius: 16px; padding: 0 20px; min-height: var(--btn); width: 100%; margin: 8px 0; cursor: pointer; }
button.small { min-height: 56px; width: auto; font-size: calc(var(--fs) * .75); }
button.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
button.danger { background: #fff; color: #b91c1c; border-color: #b91c1c; }
button.size.on { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
button:active { opacity: .7; }
.row { display: flex; gap: 12px; }
.row > button { flex: 1; }
.mic { width: 200px; height: 200px; border-radius: 50%; margin: 16px auto; display: block; border-width: 6px; padding: 0; }
.mic.listening { background: #fecaca; border-color: #dc2626; color: #7f1d1d; }
.status { text-align: center; min-height: 1.6em; margin: 8px 0; font-weight: bold; }
.hint { color: #555; font-size: calc(var(--fs) * .7); text-align: center; }
.text { min-height: 6em; padding: 16px; background: #f7f7f7; border-radius: 16px; white-space: pre-wrap; word-break: keep-all; }
textarea { width: 100%; font: inherit; padding: 16px; border: 2px solid #888; border-radius: 16px; }
ul { list-style: none; padding: 0; margin: 0; }
li button { text-align: left; background: #fff; }
li .date { display: block; font-size: calc(var(--fs) * .7); color: #555; }
[hidden] { display: none !important; }
```

- [ ] **Step 3: app.js (음성 자리는 비워두고 키보드 경로만)**

```js
import * as S from './store.js';

const $ = id => document.getElementById(id);
let store = S.load(localStorage);
let current = null;      // 보기 화면의 Prayer
let base = '';           // 녹음 화면에 쌓인 확정 글
let source = 'typed';

// ---------- 화면 전환 ----------
function show(name) {
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== name; });
  window.scrollTo(0, 0);
}
document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => show('home')));

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
function startListening() {
  // Task 3에서 음성으로 교체. 지금은 키보드 칸.
  showTyped('');
}
function stopListening() {}
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
function openView(id) {
  current = store.prayers.find(p => p.id === id);
  $('viewDate').textContent = S.formatDate(current.createdAt);
  $('viewText').textContent = S.shownText(current);
  $('viewMsg').textContent = '';
  $('delRow').hidden = true;
  $('del').hidden = false;
  show('view');
}
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
```

- [ ] **Step 4: PC 브라우저에서 확인**

Run (별도 터미널, 계속 켜둠): `python -m http.server 8000`
Edge/Chrome에서 `http://localhost:8000` 열고:
1. 「기도하기」→ 키보드 칸이 뜬다 → 글 입력 → 「다 적었어요」→ 확인 화면에 글이 있다 → 「저장」→ 홈 목록에 날짜+첫 줄이 보인다.
2. 목록 항목 클릭 → 본문·날짜 보인다 → 「지우기」→ "정말 지울까요?" → 「아니요」→ 돌아감 → 「지우기」→「네, 지워요」→ 홈에서 사라짐.
3. 새로고침 후에도 저장된 기도가 남아 있다.
4. 설정 → 「아주 크게」→ 글자가 커지고 새로고침 후에도 유지.
5. 확인 화면에서 빈 글로 「저장」→ "내용이 없어요".
6. 개발자도구 콘솔에 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add index.html style.css app.js
git commit -m "화면 뼈대와 키보드 입력 경로"
```

---

### Task 3: speech.js — 음성→글, 글→음성

**Files:**
- Create: `speech.js`
- Modify: `app.js` (`startListening`, `stopListening`, 보기 화면 「읽어주기」, `show`)

**Interfaces:**
- Produces (`speech.js`):
  - `canListen: boolean`
  - `start({ onText(finals: string, interim: string), onState(state, detail?) })` — state는 `'requesting'|'listening'|'paused'|'done'|'denied'|'failed'|'unsupported'`
  - `stop()` — 사용자가 끝냄. 이후 `onState('done')`가 온다.
  - `speak(text, onEnd) → boolean`, `stopSpeaking()`, `hasKoreanVoice() → boolean`, `voicesLoaded() → boolean`

- [ ] **Step 1: speech.js**

```js
// 음성 → 글 --------------------------------------------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
let rec = null;
let userStopped = false;
let errored = false;

export function start({ onText, onState }) {
  if (!SR) { onState('unsupported'); return; }
  if (!rec) {
    rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
  }
  let finals = '';
  userStopped = false;
  errored = false;
  rec.onstart = () => onState('listening');
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finals += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    onText(finals, interim);
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // onend가 paused로 처리
    errored = true;
    onState(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : 'failed', e.error);
  };
  rec.onend = () => { if (!errored) onState(userStopped ? 'done' : 'paused'); };
  onState('requesting');
  try { rec.start(); }
  catch (e) { errored = true; onState('failed', String(e)); }
}

export function stop() {
  userStopped = true;
  try { rec && rec.stop(); } catch {}
}

// 글 → 음성 --------------------------------------------------
const TTS = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voice = null;
let loaded = false;
function pickVoice() {
  const vs = TTS.getVoices();
  loaded = vs.length > 0;
  voice = vs.find(v => v.lang === 'ko-KR') || vs.find(v => v.lang.startsWith('ko')) || null;
}
if (TTS) { pickVoice(); TTS.onvoiceschanged = pickVoice; }

export function voicesLoaded() { return loaded; }
export function hasKoreanVoice() { return !!voice; }

export function speak(text, onEnd) {
  if (!TTS) return false;
  TTS.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  if (voice) u.voice = voice;
  u.rate = 0.85;
  u.onend = onEnd;
  u.onerror = onEnd;
  TTS.speak(u);
  return true;
}

export function stopSpeaking() {
  if (TTS) TTS.cancel();
}
```

- [ ] **Step 2: app.js에 연결**

`app.js` 맨 위 import 아래에 추가:
```js
import * as V from './speech.js';
```

`show(name)` 안, `window.scrollTo(0, 0);` 앞줄에 추가 (화면 나가면 읽어주기 중단):
```js
  V.stopSpeaking();
  $('speak').textContent = '읽어주기';
```

`startListening`과 `stopListening`을 통째로 교체:
```js
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
```

`$('share')` 리스너 위에 「읽어주기」 추가:
```js
$('speak').addEventListener('click', () => {
  if ($('speak').textContent === '멈춤') { V.stopSpeaking(); $('speak').textContent = '읽어주기'; return; }
  if (V.voicesLoaded() && !V.hasKoreanVoice()) $('viewMsg').textContent = '한국어 읽어주기 음성이 없어요';
  const ok = V.speak(S.shownText(current), () => { $('speak').textContent = '읽어주기'; });
  if (ok) $('speak').textContent = '멈춤';
  else $('viewMsg').textContent = '이 기기는 읽어주기가 안 돼요';
});
```

`$('more')` 리스너의 `startListening()` 호출은 그대로 둔다(음성으로 이어서).

- [ ] **Step 3: PC 브라우저에서 확인**

Edge/Chrome `http://localhost:8000` (localhost는 HTTPS 없이 마이크 허용됨):
1. 「기도하기」→「말하기」→ 권한 허용 → 버튼이 빨강 「그만」, "듣고 있어요" → 말하면 글이 쌓인다 → 「그만」→ 확인 화면에 글.
2. 확인 화면 「이어서 말하기」→ 기존 글 뒤에 이어 붙는다.
3. 말 안 하고 기다려 브라우저가 스스로 멈추면 → "잠시 멈췄어요" + 「이어서 말하기」「다 했어요」, 글은 남아 있다.
4. 권한 거부 → "마이크를 쓸 수 없어요…" + 키보드 칸.
5. 보기 화면 「읽어주기」→ 소리 남, 버튼 「멈춤」→ 누르면 멈춤. 읽는 중 「뒤로」→ 멈춤.
6. 콘솔 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add speech.js app.js
git commit -m "음성 인식과 읽어주기"
```

---

### Task 4: 홈화면 앱 — manifest, 서비스워커, 아이콘

**Files:**
- Create: `manifest.webmanifest`, `sw.js`, `make_icons.py`, `icons/icon-192.png`, `icons/icon-512.png`
- Modify: `app.js` (서비스워커 등록)

- [ ] **Step 1: 아이콘 생성 스크립트**

`make_icons.py`:
```python
# 파란 바탕에 흰 십자가. 표준 라이브러리만 사용.
import zlib, struct, os

def png(size, path):
    bg, fg = (29, 78, 216), (255, 255, 255)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            vert = size * .42 <= x < size * .58 and size * .18 <= y < size * .82
            horz = size * .26 <= x < size * .74 and size * .36 <= y < size * .52
            row += bytes(fg if vert or horz else bg)
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)

os.makedirs('icons', exist_ok=True)
png(192, 'icons/icon-192.png')
png(512, 'icons/icon-512.png')
print('icons OK')
```

Run: `python make_icons.py`
Expected: `icons OK`, `icons/icon-192.png`·`icons/icon-512.png` 생성. 브라우저로 열어 파란 바탕 흰 십자가 확인.

- [ ] **Step 2: manifest.webmanifest**

```json
{
  "name": "기도",
  "short_name": "기도",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "lang": "ko",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: sw.js (네트워크 우선, 실패하면 캐시)**

```js
const CACHE = 'prayer-v1';
const FILES = ['./', './index.html', './style.css', './app.js', './store.js', './speech.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});
```

- [ ] **Step 4: app.js 끝(`renderHome();` 아래)에 등록 추가**

```js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
```

- [ ] **Step 5: PC 브라우저에서 확인**

1. `http://localhost:8000` 새로고침 → 개발자도구 Application → Service Workers에 등록됨, Cache Storage에 `prayer-v1`.
2. `http.server` 끄고 새로고침 → 앱이 그대로 뜬다(오프라인). 다시 켠다.
3. Application → Manifest에 이름 "기도", 아이콘 2개 표시.

- [ ] **Step 6: 커밋**

```bash
git add manifest.webmanifest sw.js make_icons.py icons/
git commit -m "홈화면 추가와 오프라인 캐시"
```

---

### Task 5: 아이패드 검증 문서와 배포 (배포는 승인 후)

**Files:**
- Create: `docs/ipad-checklist.md`
- Create: `.gitignore`

- [ ] **Step 1: .gitignore**

```
__pycache__/
*.pyc
.DS_Store
```

- [ ] **Step 2: docs/ipad-checklist.md**

```markdown
# 아이패드 확인 목록

앱 주소를 사파리로 연 다음, **먼저 홈화면에 추가**하고(공유 버튼 → 홈 화면에 추가) 홈화면 아이콘으로 연다.
사파리 탭에서 쓴 기도는 홈화면 앱과 저장소가 달라 안 보인다.

| # | 할 일 | 기대 | 결과 |
|---|---|---|---|
| 1 | 홈화면 아이콘으로 열기 | 주소창 없이 전체 화면 | |
| 2 | 기도하기 → 말하기 → 허용 | 빨간 「그만」, "듣고 있어요", 글이 쌓임 | |
| 3 | 말하다 5초쯤 쉬기 | "잠시 멈췄어요", 글 남아 있음 | |
| 4 | 이어서 말하기 | 뒤에 붙음 | |
| 5 | 그만 → 확인 → 글자 하나 고치기 → 저장 | 홈 목록에 보임 | |
| 6 | 목록 눌러 열기 → 읽어주기 | 한국어 소리, 「멈춤」으로 멈춤 | |
| 7 | 읽는 중 뒤로 | 소리 멈춤 | |
| 8 | 공유 | 공유창 뜸(메모에 저장해 보기) | |
| 9 | 앱 완전히 끄고 다시 열기 | 기도 남아 있음 | |
| 10 | 비행기 모드로 열기 | 앱이 뜨고 목록 보임(음성은 안 될 수 있음) | |
| 11 | 설정 → 마이크 → 이 앱 거부 후 말하기 | "마이크를 쓸 수 없어요" + 키보드 칸 | |
| 12 | 키보드 칸의 마이크로 받아쓰기 | 글이 들어감 → 저장됨 | |
| 13 | 지우기 → 아니요 / 네 | 남음 / 사라짐 | |
| 14 | 설정 → 아주 크게 | 글자 커지고 유지됨 | |
| 15 | 설정 → 전체 내보내기 | 공유창에 json 파일 | |

안 되는 항목은 번호와 화면 사진을 벼리에게.
```

- [ ] **Step 3: 커밋**

```bash
git add .gitignore docs/ipad-checklist.md
git commit -m "아이패드 확인 목록"
```

- [ ] **Step 4: 배포 (성택님 승인 필요 — 외부에 올리는 일)**

아이패드 사파리는 마이크에 HTTPS를 요구하므로 무료 HTTPS 호스팅에 올려야 한다. 성택님께 물을 것:
- GitHub 계정이 있는가? → 있으면 GitHub Pages (저장소 만들고 push, Settings → Pages → main 브랜치).
- 없으면 Cloudflare Pages 직접 업로드(계정 필요, 폴더 끌어다 놓기).
승인과 계정 정보를 받은 뒤에만 진행. 올린 주소를 `docs/ipad-checklist.md` 맨 위에 적는다.

- [ ] **Step 5: 아이패드 검증**

성택님이 체크리스트를 돌리고 결과를 알려주면, 안 되는 항목을 고치고 다시 배포한다.
