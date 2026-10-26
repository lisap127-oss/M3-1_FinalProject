import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNews, parseKeywords, visibleNews, validateSummary, loadSettings, safeUrl} from '../domain.mjs';

const news = {id: '1', title: 'AI 소식', summary: '요약할 내용', source: '뉴스', url: 'https://example.com/1', published_at: '2026-10-25T09:00:00+09:00'};
test('collector payload and raw article arrays preserve only the existing NewsItem contract', () => {
  assert.deepEqual(parseNews(JSON.stringify({user_keywords: ['AI'], news: [{...news, _matched: ['AI']}]})), [news]);
  assert.deepEqual(parseNews(JSON.stringify([news])), [news]);
});
test('reject empty, malformed, oversized, duplicate and unsafe imported news', () => {
  for (const payload of ['{}', 'not JSON', '[]', JSON.stringify([news, news]), JSON.stringify([{...news, url: 'javascript:alert(1)'}]), JSON.stringify([{...news, published_at: 'bad'}]), JSON.stringify([{...news, title: null}]), ' '.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => parseNews(payload));
  }
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl('https://user:password@example.com'), null);
  assert.equal(safeUrl('/relative'), null);
});
test('keyword validation trims, deduplicates and limits entries', () => {
  assert.deepEqual(parseKeywords(' AI, 스타트업\nAI '), ['AI', '스타트업']);
  assert.throws(() => parseKeywords(' , \n'));
  assert.throws(() => parseKeywords('a'.repeat(101)));
  assert.throws(() => parseKeywords(Array.from({length: 21}, (_, i) => String(i)).join(',')));
});
test('corrupt browser settings do not break first render', () => {
  assert.deepEqual(loadSettings({getItem() { throw Error(); }}), {keywords: [], userId: ''});
  assert.deepEqual(loadSettings({getItem: () => '{"keywords":[1],"userId":"u"}'}), {keywords: [], userId: ''});
  assert.deepEqual(loadSettings({getItem: () => '{"keywords":["AI"],"userId":"u"}'}), {keywords: ['AI'], userId: 'u'});
});
test('summary validation binds model IDs and source links to original input, exposes missing IDs', () => {
  const response = {results: [{...news, url: 'https://wrong.example', title: 'Changed', summary: '실제 요약', importance_score: 85, matched_keywords: ['AI']}], excluded_news: []};
  const result = validateSummary(response, [news, {...news, id: '2'}]);
  assert.equal(result.results[0].url, news.url);
  assert.equal(result.results[0].title, news.title);
  assert.equal(result.results[0].summary, '실제 요약');
  assert.equal(result.excluded_news[0].id, '2');
  assert.throws(() => validateSummary({...response, results: [{...response.results[0], id: 'unknown'}]}, [news]));
  assert.throws(() => validateSummary({...response, results: [{...response.results[0], importance_score: 150}]}, [news]));
  assert.throws(() => validateSummary({results: [response.results[0], response.results[0]], excluded_news: []}, [news]));
});
test('search, keyword filters and sort compose without mutating results', () => {
  const a = {...news, importance_score: 80, matched_keywords: ['AI']};
  const b = {...news, id: '2', title: '스타트업', importance_score: 90, matched_keywords: ['스타트업'], published_at: '2026-10-24T00:00:00Z'};
  const input = [a, b];
  assert.deepEqual(visibleNews(input, 'ai', 'AI', 'importance'), [a]);
  assert.deepEqual(visibleNews(input, '', '', 'importance'), [b, a]);
  assert.deepEqual(visibleNews(input, '', '', 'recent'), [a, b]);
  assert.deepEqual(input, [a, b]);
});
