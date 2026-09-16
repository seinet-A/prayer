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
