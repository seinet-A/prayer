import assert from 'node:assert/strict';
import { splitClauses, detectCommand, findClause, ingest } from './commands.js';

// 구절 나누기
assert.deepEqual(splitClauses('하나님 아버지 오늘도 감사합니다 우리 손주 시험 잘 보게 해주시고 영감 무릎 낫게 해주시옵소서 아멘'),
  ['하나님 아버지 오늘도 감사합니다', '우리 손주 시험 잘 보게 해주시고', '영감 무릎 낫게 해주시옵소서', '아멘']);
assert.deepEqual(splitClauses('첫 줄\n둘째 줄 감사합니다. 셋째'), ['첫 줄', '둘째 줄 감사합니다.', '셋째']);
assert.deepEqual(splitClauses('   '), []);

// 끝내는 말
for (const s of ['됐어', '됐어요', '이제 끝', '그만', '그만할게요', '다 했어요', '끝', '됐습니다.']) {
  assert.deepEqual(detectCommand(s), { type: 'end', keep: false }, s);
}
assert.deepEqual(detectCommand('예수님 이름으로 기도합니다 아멘'), { type: 'end', keep: true });
assert.equal(detectCommand('오늘도 감사합니다'), null);
assert.equal(detectCommand('이제 끝까지 지켜주세요'), null);   // "이제 끝"으로 시작하지만 기도

// 빼기: 가리키는 말 + 빼는 동사
assert.deepEqual(detectCommand('방금 거 빼줘'), { type: 'remove', keywords: [] });
assert.deepEqual(detectCommand('여기서부터 다시'), { type: 'remove', keywords: [] });
assert.deepEqual(detectCommand('다시 할게'), { type: 'remove', keywords: [] });
assert.deepEqual(detectCommand('마지막 거 지워줘'), { type: 'remove', keywords: [] });
assert.deepEqual(detectCommand('아까 무릎 얘기 빼줘'), { type: 'remove', keywords: ['무릎'] });
assert.deepEqual(detectCommand('아까 영감 무릎 아프다고 한 거 빼 주세요'), { type: 'remove', keywords: ['영감', '무릎', '아프다고'] });
assert.deepEqual(detectCommand('손주 시험 얘기한 거 없애줘'), { type: 'remove', keywords: ['손주', '시험', '얘기한'] });
// 가리키는 말이 없으면 기도
assert.equal(detectCommand('이 병을 빼주세요'), null);
assert.equal(detectCommand('내 죄를 지워주세요'), null);

// 구절 찾기
const cl = ['하나님 아버지 감사합니다', '우리 손주 시험 잘 보게 해주시고', '영감 무릎 낫게 해주시고', '우리 손주 감기 낫게 해주시고'];
assert.equal(findClause(cl, ['무릎']), 2);
assert.equal(findClause(cl, ['손주', '시험']), 1);
assert.equal(findClause(cl, ['손주']), 3);          // 동률이면 최근 것
assert.equal(findClause(cl, ['아프다고']), -1);
assert.equal(findClause(cl, ['감기']), 3);
assert.equal(findClause([], ['무릎']), -1);

// ingest
let r = ingest([], '하나님 아버지 감사합니다 우리 손주 지켜주시고');
assert.deepEqual(r, { clauses: ['하나님 아버지 감사합니다', '우리 손주 지켜주시고'], action: null });
r = ingest(r.clauses, '영감 무릎 낫게 해주시고');
r = ingest(r.clauses, '아까 무릎 얘기 빼줘');
assert.deepEqual(r.action, { type: 'remove', index: 2 });
assert.equal(r.clauses.length, 3);                   // 명령은 글에 안 들어감
r = ingest(r.clauses, '방금 거 빼줘');
assert.deepEqual(r.action, { type: 'remove', index: 2 });
r = ingest(r.clauses, '아까 자동차 얘기 빼줘');
assert.deepEqual(r.action, { type: 'remove', index: -1 });
r = ingest(r.clauses, '됐어요');
assert.deepEqual(r, { clauses: r.clauses, action: { type: 'end' } });
assert.equal(r.clauses.length, 3);
r = ingest(r.clauses, '예수님 이름으로 기도합니다 아멘');
assert.deepEqual(r.action, { type: 'end' });
assert.deepEqual(r.clauses.slice(-2), ['예수님 이름으로 기도합니다', '아멘']);
assert.deepEqual(ingest([], '방금 거 빼줘').action, { type: 'remove', index: -1 });

console.log('commands.js OK');
