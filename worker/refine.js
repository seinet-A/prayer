// Cloudflare Worker: 기도문 다듬기 중계. 대시보드에 그대로 붙여넣는다.
// 비밀 변수 ANTHROPIC_API_KEY 필요 (Settings → Variables and Secrets).
const ALLOWED_ORIGINS = ['https://seinet-a.github.io', 'http://localhost:8000'];
const MODEL = 'claude-opus-5';        // 더 싸게: 'claude-haiku-4-5' (effort는 자동으로 빠짐)
const MAX_CHARS = 4000;               // 본문 글자 수 상한
const MAX_BYTES = 20000;              // 요청 전체 크기 상한 (Content-Length)
const SYSTEM = `너는 어르신이 말로 한 기도를 글로 정리하는 도우미다. 음성 인식 결과를 받아 아래 규칙대로 정리한 기도문만 출력한다.
- 내용, 순서, 사람 이름, 지명, 구체적인 부탁은 바꾸지 않는다. 새 내용, 성경 구절, 꾸미는 말을 넣지 않는다.
- 문장을 나누고 마침표와 쉼표를 넣는다. 화제가 바뀌면 줄을 바꾼다.
- "어", "그", "음" 같은 군말과 기도가 아닌 말(기계 시험, 혼잣말)만 뺀다. 간절함으로 되풀이한 말은 그대로 둔다.
- 낱말은 바꾸지 않는다. 다만 음성 인식이 잘못 들은 게 분명한 경우(문맥상 말이 안 되는 낱말)만 바로잡는다. 낯선 이름은 그대로 둔다.
- 말투(존댓말·반말)는 그대로 둔다. 마무리 인사("아멘")가 없어도 붙이지 않는다.
- 설명, 인사, 따옴표 없이 정리된 기도문 본문만 출력한다.`;

export default {
  fetch: (request, env) => handle(request, env, fetch),
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

export async function handle(request, env, fetchFn) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  const cors = allowed ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  } : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
  if (!allowed) return json({ error: 'origin' }, 403, cors);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return json({ error: 'too_long' }, 413, cors);

  let text;
  try { ({ text } = await request.json()); } catch { return json({ error: 'json' }, 400, cors); }
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'empty' }, 400, cors);
  if (text.length > MAX_CHARS) return json({ error: 'too_long' }, 413, cors);

  const r = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,                // 회당 출력 상한 = 비용 상한 (Opus 5 기준 최대 약 0.1달러)
      ...(MODEL.includes('haiku') ? {} : { output_config: { effort: 'low' } }),
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!r.ok) return json({ error: 'upstream', status: r.status }, 502, cors);
  const data = await r.json();
  if (data.stop_reason === 'refusal') return json({ error: 'refusal' }, 502, cors);
  if (data.stop_reason === 'max_tokens') return json({ error: 'truncated' }, 502, cors);   // 잘린 글을 완성본으로 주지 않는다
  const refined = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!refined) return json({ error: 'empty_reply' }, 502, cors);
  return json({ refined }, 200, cors);
}
