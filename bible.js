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
