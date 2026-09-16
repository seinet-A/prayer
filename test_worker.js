import assert from 'node:assert/strict';
import { handle } from './worker/refine.js';

const ORIGIN = 'https://seinet-a.github.io';
const env = { ANTHROPIC_API_KEY: 'sk-test' };
const req = (method, body, origin = ORIGIN) => new Request('https://w.example/', {
  method, headers: { Origin: origin, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const okUpstream = (text) => async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });

// OPTIONS / 잘못된 메서드 / 다른 Origin
assert.equal((await handle(req('OPTIONS'), env, okUpstream('x'))).status, 204);
assert.equal((await handle(req('GET'), env, okUpstream('x'))).status, 405);
assert.equal((await handle(req('POST', { text: '기도' }, 'https://evil.example'), env, okUpstream('x'))).status, 403);

// 본문 검사
assert.equal((await handle(new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN }, body: '{bad' }), env, okUpstream('x'))).status, 400);
assert.equal((await handle(req('POST', { text: '   ' }), env, okUpstream('x'))).status, 400);
assert.equal((await handle(req('POST', { text: 'a'.repeat(4001) }), env, okUpstream('x'))).status, 413);

// 성공: 업스트림에 보내는 내용과 응답
let sent = null;
const capture = async (url, init) => { sent = { url, init }; return okUpstream('하나님 아버지, 감사합니다.')(); };
const res = await handle(req('POST', { text: '하나님 아버지 감사합니다' }), env, capture);
assert.equal(res.status, 200);
assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
assert.deepEqual(await res.json(), { refined: '하나님 아버지, 감사합니다.' });
assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
assert.equal(sent.init.headers['x-api-key'], 'sk-test');
const body = JSON.parse(sent.init.body);
assert.equal(body.model, 'claude-opus-5');
assert.equal(body.messages[0].content, '하나님 아버지 감사합니다');
assert.ok(body.system.includes('바꾸지 않는다'));

// 요청 전체 크기 상한 (본문을 읽기 전에 거절)
let upstreamCalled = false;
const big = new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Length': '999999' }, body: JSON.stringify({ text: 'x', pad: 'y' }) });
assert.equal((await handle(big, env, async () => { upstreamCalled = true; })).status, 413);
assert.equal(upstreamCalled, false);

// 다른 Origin에는 CORS 허용 헤더를 주지 않는다
assert.equal((await handle(req('POST', { text: '기도' }, 'https://evil.example'), env, okUpstream('x'))).headers.get('Access-Control-Allow-Origin'), null);

// 잘린 응답은 실패
assert.equal((await handle(req('POST', { text: '기도' }), env, async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '잘린' }] }), { status: 200 }))).status, 502);

// 업스트림 오류 / 거절 / 빈 응답
assert.equal((await handle(req('POST', { text: '기도' }), env, async () => new Response('', { status: 500 }))).status, 502);
assert.equal((await handle(req('POST', { text: '기도' }), env, async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 }))).status, 502);
assert.equal((await handle(req('POST', { text: '기도' }), env, okUpstream('  '))).status, 502);

console.log('worker OK');
