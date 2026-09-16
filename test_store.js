import assert from 'node:assert/strict';
import { load, save, add, remove, shownText, toggleShowing, setRefined, exportJSON, formatDate } from './store.js';

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

// setRefined: 원문 불변, refined/refinedAt/showing 설정, 다른 기도는 그대로
const sr = setRefined(s, 'id1', '하나님 아버지, 감사합니다.', now);
assert.equal(sr.prayers[1].original, '하나님 감사합니다');
assert.equal(sr.prayers[1].refined, '하나님 아버지, 감사합니다.');
assert.equal(sr.prayers[1].refinedAt, '2026-09-16T10:00:00.000Z');
assert.equal(sr.prayers[1].showing, 'refined');
assert.equal(sr.prayers[0].refined, null);
assert.equal(s.prayers[1].refined, null); // 원본 store 불변
assert.equal(shownText(sr.prayers[1]), '하나님 아버지, 감사합니다.');
assert.equal(shownText(toggleShowing(sr, 'id1').prayers[1]), '하나님 감사합니다');

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
