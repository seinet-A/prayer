# 「성경 읽기·듣기」 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈에서 「이어서 읽기」/「성경 찾기」로 개역한글 본문을 큰 글씨로 보고, 절 단위로 이어 읽어주기를 듣는다.

**Architecture:** 기존 순수 HTML/JS 앱에 화면 3개(책·장·본문)와 모듈 2개(`bible.js` 데이터·계산, `bible-ui.js` 화면)를 더한다. 공용 `$`/`show`는 `ui.js`로 뺀다. 본문 66개 JSON은 서비스워커가 캐시 우선으로 따로 보관한다.

**Tech Stack:** 1단계와 동일. 라이브러리 없음.

## Global Constraints

- 외부 라이브러리·빌드 도구 금지. 본문 글자 28px 이상, 버튼 80px 이상, 제스처 없음 (1단계 spec 3.4).
- 본문은 수정하지 않는다. 빠진 절은 `null` → "(본문 준비 중)" (2단계 spec 2.1).
- 절 참조 기준 `책ID.장.절` (spec 2.2). `bibleLast = { book, chapter, verse }` (spec 2.3).
- 서비스워커: 껍데기 `prayer-v2` 네트워크 우선, 본문 `bible-v1` 캐시 우선, `r.ok`만 저장 (spec 4).

## 파일 구조

| 파일 | 책임 |
|---|---|
| `ui.js` (새) | `$`, `show`, `onLeave` 훅 |
| `bible.js` (새) | index/책 불러오기, 앞뒤 장, 읽던 자리, 제목 문구, 오프라인 준비 |
| `test_bible.js` (새) | `bible.js` 순수 함수 검증 |
| `bible-ui.js` (새) | 책·장·본문 화면, 이어 읽기 |
| `speech.js` (수정) | `speakList` 추가, 토큰으로 늦은 콜백 무시 |
| `app.js` (수정) | `ui.js` 사용, 홈 버튼, 설정의 성경 내려받기 |
| `index.html`, `style.css` (수정) | 화면 3개, 격자·절·하단 바 스타일 |
| `sw.js` (수정) | 캐시 둘, ok만 저장 |

---

### Task 1: bible.js 순수 함수 + 테스트

**Files:** Create `bible.js`, `test_bible.js`

**Interfaces (Produces):**
- `nextChapter(index, book, chapter) → {book, chapter} | null`, `prevChapter(...)` 같은 꼴
- `loadLast(storage) → {book, chapter, verse, fresh}` (없거나 깨지면 `{GEN,1,1,fresh:true}`)
- `saveLast(storage, {book, chapter, verse})`
- `chapterTitle(index, book, chapter) → '요한복음 3장'`
- `lastLabel(index, last) → '이어서 읽기 — 요한복음 3장'` / fresh면 `'성경 읽기 — 창세기 1장부터'`
- `loadIndex() → Promise<index>`, `loadBook(id) → Promise<{chapters, titles}>` (모듈 안 캐시)
- `prepareOffline(index, onProgress(done, total)) → Promise<number>` 성공 개수
- `offlineCount(total) → Promise<number>`

- [ ] **Step 1: 테스트**

`test_bible.js`:
```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextChapter, prevChapter, loadLast, saveLast, chapterTitle, lastLabel } from './bible.js';

const index = JSON.parse(readFileSync(new URL('./bible/index.json', import.meta.url), 'utf-8'));
assert.equal(index.length, 66);

assert.deepEqual(nextChapter(index, 'GEN', 1), { book: 'GEN', chapter: 2 });
assert.deepEqual(nextChapter(index, 'GEN', 50), { book: 'EXO', chapter: 1 });
assert.deepEqual(nextChapter(index, 'MAL', 4), { book: 'MAT', chapter: 1 });
assert.equal(nextChapter(index, 'REV', 22), null);
assert.deepEqual(prevChapter(index, 'EXO', 1), { book: 'GEN', chapter: 50 });
assert.deepEqual(prevChapter(index, 'JHN', 3), { book: 'JHN', chapter: 2 });
assert.equal(prevChapter(index, 'GEN', 1), null);

function fakeStorage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) }; }
const st = fakeStorage();
assert.deepEqual(loadLast(st), { book: 'GEN', chapter: 1, verse: 1, fresh: true });
saveLast(st, { book: 'JHN', chapter: 3, verse: 16 });
assert.deepEqual(loadLast(st), { book: 'JHN', chapter: 3, verse: 16, fresh: false });
st.setItem('bibleLast', '{"book":"NOPE","chapter":1,"verse":1}');
assert.equal(loadLast(st).fresh, true); // 모르는 책이면 처음부터
st.setItem('bibleLast', 'garbage');
assert.equal(loadLast(st).fresh, true);

assert.equal(chapterTitle(index, 'JHN', 3), '요한복음 3장');
assert.equal(lastLabel(index, { book: 'JHN', chapter: 3, verse: 16, fresh: false }), '이어서 읽기 — 요한복음 3장');
assert.equal(lastLabel(index, { book: 'GEN', chapter: 1, verse: 1, fresh: true }), '성경 읽기 — 창세기 1장부터');

console.log('bible.js OK');
```

- [ ] **Step 2: 실패 확인** — `node test_bible.js` → ERR_MODULE_NOT_FOUND

- [ ] **Step 3: 구현**

`bible.js`:
```js
export const LAST_KEY = 'bibleLast';

function pos(index, book) { return index.findIndex(b => b.id === book); }

export function nextChapter(index, book, chapter) {
  const i = pos(index, book);
  if (i < 0) return null;
  if (chapter < index[i].chapters) return { book, chapter: chapter + 1 };
  return i + 1 < index.length ? { book: index[i + 1].id, chapter: 1 } : null;
}

export function prevChapter(index, book, chapter) {
  const i = pos(index, book);
  if (i < 0) return null;
  if (chapter > 1) return { book, chapter: chapter - 1 };
  return i > 0 ? { book: index[i - 1].id, chapter: index[i - 1].chapters } : null;
}

const FRESH = { book: 'GEN', chapter: 1, verse: 1, fresh: true };
export function loadLast(storage, index) {
  try {
    const d = JSON.parse(storage.getItem(LAST_KEY));
    if (d && typeof d.book === 'string' && d.chapter >= 1 && d.verse >= 1 && (!index || pos(index, d.book) >= 0)) {
      return { book: d.book, chapter: d.chapter, verse: d.verse, fresh: false };
    }
  } catch {}
  return { ...FRESH };
}
export function saveLast(storage, { book, chapter, verse }) {
  try { storage.setItem(LAST_KEY, JSON.stringify({ book, chapter, verse })); } catch {}
}

export function chapterTitle(index, book, chapter) {
  const b = index[pos(index, book)];
  return `${b ? b.ko : book} ${chapter}장`;
}
export function lastLabel(index, last) {
  return last.fresh ? `성경 읽기 — ${chapterTitle(index, last.book, last.chapter)}부터`
                    : `이어서 읽기 — ${chapterTitle(index, last.book, last.chapter)}`;
}

let indexCache = null;
const bookCache = new Map();
export async function loadIndex() {
  if (!indexCache) indexCache = await fetch('bible/index.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  return indexCache;
}
export async function loadBook(id) {
  if (!bookCache.has(id)) {
    const r = await fetch(`bible/${id}.json`);
    if (!r.ok) throw new Error(r.status);
    bookCache.set(id, await r.json());
  }
  return bookCache.get(id);
}

// 66개 파일을 차례로 받아 서비스워커 캐시(bible-v1)에 채운다. 성공 개수 반환.
export async function prepareOffline(index, onProgress) {
  let ok = 0;
  for (let i = 0; i < index.length; i++) {
    try { const r = await fetch(`bible/${index[i].id}.json`); if (r.ok) ok++; } catch {}
    onProgress?.(i + 1, index.length);
  }
  return ok;
}
export async function offlineCount() {
  try { const c = await caches.open('bible-v1'); return (await c.keys()).length; } catch { return 0; }
}
```
`loadLast(storage, index)`의 `index`는 선택 — 테스트에서는 `NOPE` 검사를 위해 index를 넘긴다. 테스트의 `loadLast(st)` 호출 세 곳을 `loadLast(st, index)`로 쓴다.

- [ ] **Step 4: 통과 확인** — `node test_bible.js` → `bible.js OK`
- [ ] **Step 5: 커밋** — `git add bible.js test_bible.js && git commit -m "성경 앞뒤 장·읽던 자리 로직과 테스트"`

---

### Task 2: ui.js 분리, speech.js speakList

**Files:** Create `ui.js`; Modify `speech.js`, `app.js`, `test_speech.js`

- [ ] **Step 1: ui.js**
```js
export const $ = id => document.getElementById(id);
export const onLeave = [];   // 화면을 떠날 때 호출할 함수들
export function show(name) {
  onLeave.forEach(f => f());
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== name; });
  window.scrollTo(0, 0);
}
```

- [ ] **Step 2: speech.js 글→음성 부분 교체**
```js
let token = 0;                      // 실행마다 올려서 이전 실행의 늦은 콜백을 무시
function utter(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  if (voice) u.voice = voice;
  u.rate = 0.85;
  return u;
}
export function speak(text, onEnd) {
  if (!TTS) return false;
  const my = ++token;
  TTS.cancel();
  const u = utter(text);
  u.onend = u.onerror = () => { if (my === token) onEnd(); };
  TTS.speak(u);
  return true;
}
// texts[start]부터 차례로. null/빈 항목은 건너뜀. 정상 종료만 다음으로 이어감.
export function speakList(texts, start, { onIndex, onDone }) {
  if (!TTS) return false;
  const my = ++token;
  TTS.cancel();
  let i = start;
  const next = () => {
    if (my !== token) return;
    while (i < texts.length && !texts[i]) i++;
    if (i >= texts.length) { onDone(); return; }
    onIndex(i);
    const u = utter(texts[i]);
    u.onend = () => { if (my !== token) return; i++; next(); };
    u.onerror = () => { if (my === token) onDone(); };
    TTS.speak(u);
  };
  next();
  return true;
}
export function stopSpeaking() {
  token++;
  if (TTS) TTS.cancel();
}
```

- [ ] **Step 3: test_speech.js 끝(`console.log` 앞)에 speakList 검사 추가**
```js
// 7. speakList: null 건너뜀, onend만 이어감, stop 뒤 늦은 콜백 무시
spoken.length = 0;
const idx = []; let done = 0;
const fakeTTS = window.speechSynthesis;
const utts = [];
fakeTTS.speak = u => { spoken.push(u.text); utts.push(u); };
V.speakList(['일', null, '삼'], 0, { onIndex: i => idx.push(i), onDone: () => done++ });
assert.deepEqual(spoken, ['cancel', '일']);
utts[0].onend();
assert.deepEqual(spoken, ['cancel', '일', '삼']);
assert.deepEqual(idx, [0, 2]);
utts[1].onend();
assert.equal(done, 1);
V.speakList(['가', '나'], 1, { onIndex: i => idx.push(i), onDone: () => done++ });
assert.equal(spoken.at(-1), '나');
V.stopSpeaking();
utts.at(-1).onend();           // 늦은 콜백
assert.equal(done, 1);         // 안 늘어남
utts.at(-1).onerror();
assert.equal(done, 1);
```

- [ ] **Step 4: app.js 수정**
- `const $ = id => document.getElementById(id);`와 `show` 함수, `.back` 리스너를 지우고 맨 위에:
```js
import { $, show, onLeave } from './ui.js';
onLeave.push(() => { V.stopSpeaking(); $('speak').textContent = '읽어주기'; });
document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => show(b.dataset.to || 'home')));
```

- [ ] **Step 5: 확인** — `node test_speech.js` → OK; 브라우저 새로고침 후 기도 흐름·읽어주기 그대로 동작, 콘솔 오류 없음.
- [ ] **Step 6: 커밋** — `git add ui.js speech.js test_speech.js app.js && git commit -m "공용 ui.js 분리, 절 단위 이어 읽기"`

---

### Task 3: 화면 — index.html, style.css, bible-ui.js, app.js 홈·설정

**Files:** Create `bible-ui.js`; Modify `index.html`, `style.css`, `app.js`

- [ ] **Step 1: index.html**

홈 섹션의 「기도하기」 버튼 아래에:
```html
  <button id="toResume" class="big">성경 읽기</button>
  <button id="toBooks" class="big">성경 찾기</button>
```
`</main>` 앞에 섹션 세 개:
```html
<section id="books" hidden>
  <header><button class="back small">뒤로</button><h1>성경 찾기</h1><span></span></header>
  <h2>구약</h2><div id="otGrid" class="grid2"></div>
  <h2>신약</h2><div id="ntGrid" class="grid2"></div>
</section>

<section id="chapters" hidden>
  <header><button class="back small" data-to="books">뒤로</button><h1 id="chaptersTitle"></h1><span></span></header>
  <div id="chapterGrid" class="grid4"></div>
</section>

<section id="reader" hidden>
  <header><button class="back small" data-to="chapters">뒤로</button><h1 id="readerTitle"></h1><span></span></header>
  <p id="readerMsg" class="status"></p>
  <div id="verses"></div>
  <div class="bar">
    <button id="prevCh" class="big">이전 장</button>
    <button id="readCh" class="big primary">읽어주기</button>
    <button id="nextCh" class="big">다음 장</button>
  </div>
</section>
```
설정 섹션 「전체 내보내기」 위에:
```html
  <button id="prepBible" class="big">성경 내려받기</button>
  <p id="bibleMsg" class="status"></p>
```
`<script type="module" src="app.js">` 앞에 `<script type="module" src="bible-ui.js"></script>`는 **넣지 않는다** — `app.js`가 import한다.

- [ ] **Step 2: style.css 끝에 추가**
```css
h2 { font-size: var(--fs); margin: 24px 0 8px; color: #555; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.grid2 > button, .grid4 > button { margin: 0; }
#reader { padding-bottom: 140px; }
.ptitle { color: #555; font-size: calc(var(--fs) * .7); margin: 8px 0; }
.verse { margin: 0 0 12px; padding: 8px 12px; border-radius: 12px; word-break: keep-all; }
.verse .num { color: #888; font-size: calc(var(--fs) * .7); margin-right: 8px; }
.verse.now { background: #fef3c7; }
.verse.gap { color: #888; }
.bar { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 800px; display: flex; gap: 12px; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); background: #fff; border-top: 2px solid #ddd; }
.bar > button { flex: 1; margin: 0; }
button:disabled { opacity: .35; }
```

- [ ] **Step 3: bible-ui.js**
```js
import { $, show, onLeave } from './ui.js';
import * as B from './bible.js';
import * as V from './speech.js';

let index = null;
let cur = null;        // { book, chapter }
let data = null;       // { chapters, titles }
let verse = 1;
let reading = false;
let following = true;

function setReading(on) {
  reading = on;
  $('readCh').textContent = on ? '멈춤' : '읽어주기';
}
onLeave.push(() => { if (reading) { V.stopSpeaking(); setReading(false); } });
window.addEventListener('wheel', () => { following = false; }, { passive: true });
window.addEventListener('touchmove', () => { following = false; }, { passive: true });

export async function updateResume() {
  try { index = await B.loadIndex(); } catch { $('toResume').textContent = '성경 읽기'; return; }
  $('toResume').textContent = B.lastLabel(index, B.loadLast(localStorage, index));
}

function renderBooks() {
  for (const [gridId, ot] of [['otGrid', true], ['ntGrid', false]]) {
    const g = $(gridId); g.innerHTML = '';
    for (const b of index.filter(b => b.ot === ot)) {
      const btn = document.createElement('button');
      btn.className = 'big'; btn.textContent = b.ko;
      btn.addEventListener('click', () => openChapters(b.id));
      g.append(btn);
    }
  }
  show('books');
}
function openChapters(book) {
  const b = index.find(x => x.id === book);
  $('chaptersTitle').textContent = b.ko;
  const g = $('chapterGrid'); g.innerHTML = '';
  for (let c = 1; c <= b.chapters; c++) {
    const btn = document.createElement('button');
    btn.className = 'big'; btn.textContent = c;
    btn.addEventListener('click', () => openChapter(book, c, 1));
    g.append(btn);
  }
  show('chapters');
}

async function openChapter(book, chapter, startVerse) {
  cur = { book, chapter };
  verse = startVerse;
  $('readerTitle').textContent = B.chapterTitle(index, book, chapter);
  $('readerMsg').textContent = '';
  $('verses').innerHTML = '';
  show('reader');
  try { data = await B.loadBook(book); }
  catch { $('readerMsg').textContent = '성경 본문을 불러오지 못했어요. 인터넷을 켜고 다시 열어 주세요'; return; }
  const texts = data.chapters[chapter - 1];
  const title = data.titles[String(chapter)];
  const box = $('verses');
  if (title) { const p = document.createElement('p'); p.className = 'ptitle'; p.textContent = title; box.append(p); }
  texts.forEach((t, i) => {
    const p = document.createElement('p');
    p.className = 'verse' + (t ? '' : ' gap');
    p.dataset.v = i + 1;
    const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1;
    p.append(n, t || '(본문 준비 중)');
    if (t) p.addEventListener('click', () => readFrom(i + 1));
    box.append(p);
  });
  $('prevCh').disabled = !B.prevChapter(index, book, chapter);
  $('nextCh').disabled = !B.nextChapter(index, book, chapter);
  B.saveLast(localStorage, { book, chapter, verse });
  setReading(false);
  highlight(verse, false);
  if (verse > 1) scrollToVerse(verse);
}

function highlight(v, scroll) {
  document.querySelectorAll('.verse.now').forEach(p => p.classList.remove('now'));
  const p = document.querySelector(`.verse[data-v="${v}"]`);
  if (p && v > 1) p.classList.add('now');
  if (scroll && following) scrollToVerse(v);
}
function scrollToVerse(v) {
  document.querySelector(`.verse[data-v="${v}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function readFrom(v) {
  following = true;
  const texts = data.chapters[cur.chapter - 1];
  const ok = V.speakList(texts, v - 1, {
    onIndex(i) { verse = i + 1; highlight(verse, true); B.saveLast(localStorage, { ...cur, verse }); },
    onDone() { setReading(false); },
  });
  if (!ok) { $('readerMsg').textContent = '이 기기는 읽어주기가 안 돼요'; return; }
  setReading(true);
}

$('readCh').addEventListener('click', () => {
  if (reading) { V.stopSpeaking(); setReading(false); B.saveLast(localStorage, { ...cur, verse }); }
  else readFrom(verse);
});
$('prevCh').addEventListener('click', () => { const p = B.prevChapter(index, cur.book, cur.chapter); if (p) openChapter(p.book, p.chapter, 1); });
$('nextCh').addEventListener('click', () => { const n = B.nextChapter(index, cur.book, cur.chapter); if (n) openChapter(n.book, n.chapter, 1); });

$('toBooks').addEventListener('click', async () => {
  try { index = await B.loadIndex(); renderBooks(); }
  catch { alert('성경 목록을 불러오지 못했어요. 인터넷을 켜고 다시 해주세요'); }
});
$('toResume').addEventListener('click', async () => {
  try { index = await B.loadIndex(); }
  catch { alert('성경 목록을 불러오지 못했어요. 인터넷을 켜고 다시 해주세요'); return; }
  const last = B.loadLast(localStorage, index);
  openChapter(last.book, last.chapter, last.verse);
});

// 설정: 성경 내려받기
async function showOffline() {
  const n = await B.offlineCount();
  $('bibleMsg').textContent = `오프라인 준비 ${n}/66`;
}
$('prepBible').addEventListener('click', async () => {
  try { index = await B.loadIndex(); } catch { $('bibleMsg').textContent = '인터넷을 켜고 다시 해주세요'; return; }
  await B.prepareOffline(index, (d, t) => { $('bibleMsg').textContent = `받는 중 ${d}/${t}`; });
  showOffline();
});
export async function autoPrepare() {
  showOffline();
  if (!navigator.onLine || !('serviceWorker' in navigator)) return;
  if (await B.offlineCount() >= 66) return;
  try { index = await B.loadIndex(); await B.prepareOffline(index); showOffline(); } catch {}
}
```
`alert`는 두 곳뿐이고 인터넷 없는 첫 실행에서만 뜬다. 그 경우 사용자가 할 수 있는 게 없으므로 단순히 둔다.

- [ ] **Step 4: app.js**
- 맨 위 import에 `import { updateResume, autoPrepare } from './bible-ui.js';`
- `renderHome()` 안 `show('home');` 앞에 `updateResume();`
- 맨 끝 서비스워커 등록 다음 줄에 `autoPrepare();`
- `.back` 리스너는 Task 2에서 `data-to`를 보도록 이미 바꿨다.

- [ ] **Step 5: sw.js 교체**
```js
const CACHE = 'prayer-v2';
const BIBLE = 'bible-v1';
const FILES = ['./', './index.html', './style.css', './app.js', './ui.js', './store.js', './speech.js', './bible.js', './bible-ui.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './bible/index.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== BIBLE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isBible = url.pathname.includes('/bible/') && !url.pathname.endsWith('index.json');
  if (isBible) {
    // 본문: 캐시 우선. 내용이 안 바뀌므로 한 번 받으면 그대로.
    e.respondWith(caches.open(BIBLE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  // 껍데기: 네트워크 우선, 실패하면 캐시. 성공 응답만 저장.
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request))
  );
});
```

- [ ] **Step 6: PC 브라우저 확인**
1. 홈에 「성경 읽기 — 창세기 1장부터」「성경 찾기」 보임.
2. 성경 찾기 → 구약 39·신약 27 버튼 → 요한복음 → 21개 숫자 → 3 → "요한복음 3장", 36절, 절 번호 회색.
3. 읽어주기 → 1절부터 노란 하이라이트가 이동, 버튼 「멈춤」 → 멈춤 → 다시 읽어주기 → 멈춘 절부터.
4. 16절 누르기 → 16절부터 읽음. 뒤로 → 소리 멈춤.
5. 다음 장 → 4장. 이전 장 → 3장. 창세기 1장에서 「이전 장」 비활성, 요한계시록 22장에서 「다음 장」 비활성. 말라기 4장 → 다음 장 → 마태복음 1장.
6. 시편 3편 → 표제 작게 보임. 마태복음 18장 → 11절 "(본문 준비 중)".
7. 새로고침 → 홈 「이어서 읽기 — …」 → 누르면 그 장, 그 절로 스크롤.
8. 설정 → 「성경 내려받기」 → "받는 중 n/66" → "오프라인 준비 66/66". 서버 끄고 새로고침 → 성경 찾기 → 본문 열림.
9. 콘솔 오류 없음. `node test_store.js && node test_speech.js && node test_bible.js` 전부 OK.

- [ ] **Step 7: 커밋** — `git add -A && git commit -m "성경 읽기·듣기 화면"`

---

### Task 4: 아이패드 체크리스트 추가

**Files:** Modify `docs/ipad-checklist.md`

- [ ] **Step 1: 표 아래에 추가**
```markdown
| 16 | 설정 → 성경 내려받기 (홈화면 앱 안에서) | "오프라인 준비 66/66" | |
| 17 | 비행기 모드 → 성경 찾기 → 요한복음 3장 | 본문 보임 | |
| 18 | 비행기 모드 → 읽어주기 | 소리 남(안 나면 인터넷 필요 음성) | |
| 19 | 읽어주기 중 화면 잠금 → 풀기 | 계속 읽거나 「읽어주기」로 재개 가능 | |
| 20 | 읽는 중 다른 절 누르기 | 즉시 그 절부터 | |
| 21 | 읽는 중 손으로 스크롤 | 화면이 안 끌려감, 읽기는 계속 | |
| 22 | 앱 껐다 켜서 「이어서 읽기」 | 멈춘 장·절로 | |
| 23 | 아주 크게 설정에서 본문 | 절 번호 읽힘, 마지막 절이 하단 버튼에 안 가림 | |
```
- [ ] **Step 2: 커밋** — `git add docs/ipad-checklist.md && git commit -m "아이패드 확인 목록: 성경"`
