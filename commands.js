// 말로 한 글에서 "끝내는 말"과 "빼는 말"을 알아듣는 규칙. AI·서버 없이 동작. 기도 외 다른 글에도 그대로 쓴다.

const ENDER = /(시고|옵고|시며|니다|소서|세요|아멘|께요|게요)$/;
const PUNCT = /[.,!?]+$/;

// 맺음말로 끝나는 낱말 뒤에서 구절을 끊는다. 줄바꿈도 경계.
export function splitClauses(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    let cur = [];
    for (const w of line.trim().split(/\s+/).filter(Boolean)) {
      cur.push(w);
      if (ENDER.test(w.replace(PUNCT, ''))) { out.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) out.push(cur.join(' '));
  }
  return out;
}

const END_ONLY = /^(됐어요?|됐습니다|이제\s*(끝|됐어요?|그만)|그만(할게요?|할래요?|이요|이에요)?|끝(이에요|이야|났어요?)?|다\s*했어요?|다\s*했습니다)$/;
const REMOVE_VERB = /(빼\s*(줘|주세요|주라|버려|줄래|주십시오)|지워\s*(줘|주세요|주라|버려|줄래)|없애\s*(줘|주세요|줄래)|삭제해\s*(줘|주세요)|취소해\s*(줘|주세요)|다시\s*할(게|께|래)요?|여기서\s*부터\s*다시|다시\s*(말|얘기)\s*할(게|께)요?)/g;
const REF = /(아까|방금|그거|그것|그\s*(얘기|이야기|말|부분)|얘기|이야기|말한|한\s*거|부분|마지막|여기서|다시\s*할|다시\s*(말|얘기)|앞에|전에|번째|번\s*줄|번\s*(빼|지워)|줄|첫|둘째|셋째|넷째|다섯째)/;
const ORDINAL = { '첫': 1, '첫째': 1, '하나': 1, '둘째': 2, '두': 2, '둘': 2, '셋째': 3, '세': 3, '셋': 3, '넷째': 4, '네': 4, '넷': 4, '다섯째': 5, '다섯': 5, '여섯째': 6, '여섯': 6, '일곱째': 7, '일곱': 7, '여덟째': 8, '여덟': 8, '아홉째': 9, '아홉': 9, '열째': 10, '열': 10 };
// "3번", "3번째", "3번 줄", "세 번째", "셋째 줄", "첫 줄" → 줄 번호. 없으면 0.
export function lineNumber(s) {
  const d = s.match(/(\d+)\s*(번째|번)/);
  if (d) return Number(d[1]);
  const w = s.match(/(첫째|둘째|셋째|넷째|다섯째|여섯째|일곱째|여덟째|아홉째|열째|첫|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)\s*(번째|째|줄|번)/);
  return w ? ORDINAL[w[1]] || 0 : 0;
}
const LAST = /(방금|마지막|여기서\s*부터|다시\s*할|다시\s*(말|얘기)|바로\s*전)/;
const STOP = new Set(['아까', '방금', '그', '그거', '그것', '거', '것', '얘기', '이야기', '말', '말한', '한', '부분', '좀', '그런', '저', '이', '제', '내', '우리', '앞에', '전에', '했던', '하던', '거기', '그것도']);
const PARTICLE = /(은|는|이|가|을|를|도|만|에|의|에서|으로|로|한테|께서|께)$/;

// 명령이면 { type: 'end', keep } 또는 { type: 'remove', keywords } (keywords 비면 "마지막"), 아니면 null.
export function detectCommand(segment) {
  const s = String(segment).trim().replace(PUNCT, '');
  if (!s) return null;
  if (END_ONLY.test(s)) return { type: 'end', keep: false };
  if (/아멘$/.test(s)) return { type: 'end', keep: true };
  if (!REMOVE_VERB.test(s) || !REF.test(s)) { REMOVE_VERB.lastIndex = 0; return null; }
  REMOVE_VERB.lastIndex = 0;
  const line = lineNumber(s);
  if (line) return { type: 'remove', keywords: [], line };
  if (LAST.test(s)) return { type: 'remove', keywords: [] };
  const keywords = s.replace(REMOVE_VERB, ' ').split(/\s+/)
    .map(w => { const t = w.replace(PARTICLE, ''); return t.length >= 2 ? t : w; })
    .filter(w => w.length >= 2 && !STOP.has(w));
  return { type: 'remove', keywords };
}

// 낱말이 가장 많이 겹치는 구절의 번호. 동률이면 최근 것. 없으면 -1.
export function findClause(clauses, keywords) {
  let best = -1, bestScore = 0;
  clauses.forEach((c, i) => {
    let score = 0;
    for (const k of keywords) {
      if (c.includes(k)) score += 2;
      else if (k.length >= 3 && c.includes(k.slice(0, -1))) score += 1;
      else if (k.length >= 3 && c.includes(k.slice(0, 2))) score += 0.5;
    }
    if (score > 0 && score >= bestScore) { best = i; bestScore = score; }
  });
  return best;
}

// 확정된 음성 구간 하나를 받아 구절 목록을 갱신하고 할 일을 돌려준다.
export function ingest(clauses, segment) {
  const cmd = detectCommand(segment);
  if (!cmd) return { clauses: [...clauses, ...splitClauses(segment)], action: null };
  if (cmd.type === 'end') {
    return { clauses: cmd.keep ? [...clauses, ...splitClauses(segment)] : clauses, action: { type: 'end' } };
  }
  let index;
  if (cmd.line) index = cmd.line <= clauses.length ? cmd.line - 1 : -1;
  else if (cmd.keywords.length) index = findClause(clauses, cmd.keywords);
  else index = clauses.length - 1;
  return { clauses, action: { type: 'remove', index } };
}
