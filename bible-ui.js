import { $, show } from './ui.js';
import * as B from './bible.js';

let index = null;
let cur = null;        // { book, chapter }
let data = null;       // { chapters, titles }

export async function updateResume() {
  try { index = await B.loadIndex(); } catch { $('toResume').textContent = '성경 읽기'; return; }
  $('toResume').textContent = B.lastLabel(index, B.loadLast(localStorage, index));
}

function renderBooks() {
  if (!$('otGrid').children.length) for (const [gridId, ot] of [['otGrid', true], ['ntGrid', false]]) {
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
// 「뒤로」: 본문 → 그 책의 장 고르기 → 책 고르기. 「이어서 읽기」로 바로 들어온 경우 목록이 안 만들어져 있을 수 있어 여기서 만든다.
document.querySelector('#chapters .back').addEventListener('click', renderBooks);
document.querySelector('#reader .back').addEventListener('click', () => { if (cur) openChapters(cur.book); });
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

async function openChapter(book, chapter, verse) {
  cur = { book, chapter };
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
    // 절을 누르면 "여기까지 읽었어요" 표시. 다음에 「이어서 읽기」로 열면 이 절로 온다.
    p.addEventListener('click', () => mark(i + 1));
    box.append(p);
  });
  $('prevCh').disabled = !B.prevChapter(index, book, chapter);
  $('nextCh').disabled = !B.nextChapter(index, book, chapter);
  mark(verse);
  if (verse > 1) document.querySelector(`.verse[data-v="${verse}"]`)?.scrollIntoView({ block: 'center' });
}

function mark(v) {
  document.querySelectorAll('.verse.now').forEach(p => p.classList.remove('now'));
  if (v > 1) document.querySelector(`.verse[data-v="${v}"]`)?.classList.add('now');
  B.saveLast(localStorage, { ...cur, verse: v });
}

$('prevCh').addEventListener('click', () => { const p = B.prevChapter(index, cur.book, cur.chapter); if (p) openChapter(p.book, p.chapter, 1); });
$('nextCh').addEventListener('click', () => { const n = B.nextChapter(index, cur.book, cur.chapter); if (n) openChapter(n.book, n.chapter, 1); });

// 「성경 읽기」 하나로: 읽던 자리로 바로 들어가고, 「뒤로」로 장·책 고르기.
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
