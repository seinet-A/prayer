// speech.js 상태 전이 검증 (브라우저 없이 가짜 SpeechRecognition으로)
import assert from 'node:assert/strict';

class FakeSR {
  static last = null;
  constructor() { FakeSR.last = this; this.started = 0; this.stopped = 0; }
  start() { this.started++; }
  stop() { this.stopped++; }
}
const spoken = [];
globalThis.window = {
  webkitSpeechRecognition: FakeSR,
  speechSynthesis: { getVoices: () => [{ lang: 'ko-KR', name: 'ko' }], cancel() { spoken.push('cancel'); }, speak(u) { spoken.push(u.text); } },
};
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };

const V = await import('./speech.js');
assert.equal(V.canListen, true);

function result(items) { // items: [text, isFinal][]
  return { resultIndex: 0, results: items.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) };
}

// 1. 정상: requesting → listening → 글 → 사용자가 stop → done
let states = [], texts = [];
V.start({ onText: (f, i) => texts.push([f, i]), onState: s => states.push(s) });
const rec = FakeSR.last;
assert.equal(rec.lang, 'ko-KR'); assert.equal(rec.continuous, true); assert.equal(rec.interimResults, true);
assert.deepEqual(states, ['requesting']);
rec.onstart();
rec.onresult(result([['하나님', false]]));
rec.onresult(result([['하나님 아버지', true], ['감사', false]]));
assert.deepEqual(texts, [['', '하나님'], ['하나님 아버지 ', '감사']]);
V.stop();
assert.equal(rec.stopped, 1);
rec.onend();
assert.deepEqual(states, ['requesting', 'listening', 'done']);

// 2. 기기가 혼자 멈춤 → paused (no-speech 오류는 무시), 인스턴스 재사용
states = [];
V.start({ onText() {}, onState: s => states.push(s) });
assert.equal(FakeSR.last, rec); // 싱글턴
rec.onstart();
rec.onerror({ error: 'no-speech' });
rec.onend();
assert.deepEqual(states, ['requesting', 'listening', 'paused']);

// 3. 권한 거절 → denied 한 번만 (onend가 paused로 덮어쓰지 않음)
states = [];
V.start({ onText() {}, onState: s => states.push(s) });
rec.onerror({ error: 'not-allowed' });
rec.onend();
assert.deepEqual(states, ['requesting', 'denied']);

// 4. 기타 오류 → failed
states = [];
V.start({ onText() {}, onState: s => states.push(s) });
rec.onerror({ error: 'network' });
rec.onend();
assert.deepEqual(states, ['requesting', 'failed']);

// 5. start()가 throw → failed
states = [];
rec.start = () => { throw new Error('busy'); };
V.start({ onText() {}, onState: s => states.push(s) });
assert.deepEqual(states, ['requesting', 'failed']);

// 6. TTS
assert.equal(V.hasKoreanVoice(), true);
assert.equal(V.speak('아멘', () => {}), true);
assert.deepEqual(spoken, ['cancel', '아멘']);
V.stopSpeaking();
assert.equal(spoken.at(-1), 'cancel');

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

console.log('speech.js OK');
