import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi, ApiError} from '../api.mjs';

test('real endpoints use exact methods and payloads; user IDs are encoded', async () => {
  const calls = [];
  const api = createApi(async (path, options) => { calls.push({path, options}); return Response.json({status: 'ok'}); });
  const summary = {user_id: null, user_keywords: ['AI'], news: []};
  const feedback = {user_id: 'reader', news_id: '1', topic: 'AI', feedback_type: 'like'};
  await api.health(); await api.summarize(summary); await api.feedback(feedback); await api.memory('독자 1');
  assert.deepEqual(calls.map(c => [c.path, c.options.method]), [['/health', 'GET'], ['/api/summarize', 'POST'], ['/api/feedback', 'POST'], ['/api/memory/%EB%8F%85%EC%9E%90%201', 'GET']]);
  assert.deepEqual(JSON.parse(calls[1].options.body), summary);
  assert.deepEqual(JSON.parse(calls[2].options.body), feedback);
});
test('API failures remain failures and retain backend detail instead of returning demo data', async () => {
  const api = createApi(async () => Response.json({detail: 'Supabase 연결 설정을 확인하세요.'}, {status: 500}));
  await assert.rejects(api.memory('reader'), error => error instanceof ApiError && error.status === 500 && error.message.includes('Supabase'));
  const invalid = createApi(async () => new Response('<html>Bad gateway</html>', {status: 502}));
  await assert.rejects(invalid.health(), /JSON/);
});
test('cancelling a summary propagates cancellation and does not retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const api = createApi((path, options) => new Promise((resolve, reject) => {
    calls++; options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const request = api.summarize({news: []}, controller.signal); controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError'); assert.equal(calls, 1);
});
