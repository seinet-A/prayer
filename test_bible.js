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
assert.deepEqual(loadLast(st, index), { book: 'GEN', chapter: 1, verse: 1, fresh: true });
saveLast(st, { book: 'JHN', chapter: 3, verse: 16 });
assert.deepEqual(loadLast(st, index), { book: 'JHN', chapter: 3, verse: 16, fresh: false });
st.setItem('bibleLast', '{"book":"NOPE","chapter":1,"verse":1}');
assert.equal(loadLast(st, index).fresh, true); // 모르는 책이면 처음부터
st.setItem('bibleLast', 'garbage');
assert.equal(loadLast(st, index).fresh, true);

assert.equal(chapterTitle(index, 'JHN', 3), '요한복음 3장');
assert.equal(lastLabel(index, { book: 'JHN', chapter: 3, verse: 16, fresh: false }), '이어서 읽기 — 요한복음 3장');
assert.equal(lastLabel(index, { book: 'GEN', chapter: 1, verse: 1, fresh: true }), '성경 읽기 — 창세기 1장부터');

console.log('bible.js OK');
