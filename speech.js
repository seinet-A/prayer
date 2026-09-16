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
  let seenFinal = 0;   // 이미 넘긴 final 개수. iOS가 결과를 다시 보내도 중복 안 되게.
  userStopped = false;
  errored = false;
  rec.onstart = () => onState('listening');
  rec.onresult = e => {
    const fresh = [];
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { if (i >= seenFinal) { fresh.push(r[0].transcript.trim()); seenFinal = i + 1; } }
      else interim += r[0].transcript;
    }
    onText(fresh, interim);
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
export function stopSpeaking() {
  token++;
  if (TTS) TTS.cancel();
}
