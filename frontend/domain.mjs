export const MAX_NEWS = 30;
export const MAX_FILE_BYTES = 1024 * 1024;
export const STORAGE_KEY = 'daybrief.settings.v1';
export const SESSION_KEY = 'daybrief.briefing.v1';
export const FEEDBACK_KEY = 'daybrief.feedback.v1';
const MAX_FEEDBACK_ENTRIES = 500;

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseKeywords(value) {
  const keywords = [...new Set(value.split(/[,\n]/).map(s => s.trim()).filter(Boolean))];
  if (!keywords.length) throw new Error('관심 키워드를 하나 이상 입력해 주세요.');
  if (keywords.length > 20 || keywords.some(k => k.length > 100)) throw new Error('키워드는 최대 20개, 각 100자까지 입력할 수 있어요.');
  return keywords;
}

export function parseNews(text) {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('파일은 1MB 이하로 선택해 주세요.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON 형식을 확인해 주세요. 쉼표나 따옴표가 빠졌을 수 있어요.'); }
  const news = Array.isArray(data) ? data : data?.news;
  if (!Array.isArray(news) || !news.length) throw new Error('news 배열에 기사를 한 건 이상 넣어 주세요.');
  if (news.length > MAX_NEWS) throw new Error(`한 번에 ${MAX_NEWS}건까지 불러올 수 있어요.`);
  const ids = new Set();
  return news.map((item, index) => {
    const clean = {};
    for (const key of ['id', 'title', 'summary', 'source', 'url', 'published_at']) {
      if (typeof item?.[key] !== 'string' || (key !== 'published_at' && !item[key].trim())) {
        throw new Error(`${index + 1}번째 기사의 ${key} 값을 확인해 주세요.`);
      }
      clean[key] = item[key].trim();
    }
    if (clean.id.length > 200) throw new Error(`${index + 1}번째 기사 ID는 200자 이하여야 해요.`);
    if (ids.has(clean.id)) throw new Error(`기사 ID가 중복돼요: ${clean.id}`);
    if (!safeUrl(clean.url)) throw new Error(`${index + 1}번째 기사에 올바른 http 또는 https 원문 주소가 필요해요.`);
    if (clean.published_at && !Number.isFinite(Date.parse(clean.published_at))) throw new Error(`${index + 1}번째 기사 게시 시각을 확인해 주세요.`);
    ids.add(clean.id);
    return clean;
  });
}

export function validateSummary(data, input) {
  if (!data || !Array.isArray(data.results) || !Array.isArray(data.excluded_news)) throw new Error('요약 응답 형식이 올바르지 않습니다. 다시 요청해 주세요.');
  const originals = new Map(input.map(n => [n.id, n]));
  const seen = new Set();
  const results = data.results.map(n => {
    const original = originals.get(n?.id);
    if (!original || seen.has(n.id) || typeof n.summary !== 'string' || !n.summary.trim() ||
        !Number.isInteger(n.importance_score) || n.importance_score < 0 || n.importance_score > 100 ||
        !Array.isArray(n.matched_keywords) || n.matched_keywords.some(k => typeof k !== 'string')) {
      throw new Error('기사 요약 응답을 확인할 수 없습니다. 서버 응답을 점검해 주세요.');
    }
    seen.add(n.id);
    // Keep the original source, URL, timestamp and title; the model cannot replace source links.
    return {...original, summary: n.summary, importance_score: n.importance_score,
      matched_keywords: [...new Set(n.matched_keywords.filter(k => k.trim() && k.length <= 100))],
      selection_reason: typeof n.selection_reason === 'string' ? n.selection_reason : '',
    };
  });
  const excluded = data.excluded_news.map(n => {
    if (!originals.has(n?.id) || seen.has(n.id) || typeof n.reason !== 'string') throw new Error('제외된 기사 응답 형식을 확인해 주세요.');
    seen.add(n.id);
    return {id: n.id, title: originals.get(n.id).title, reason: n.reason};
  });
  // No silently dropped input articles, even if the model omitted an ID.
  for (const n of input) if (!seen.has(n.id)) excluded.push({id: n.id, title: n.title, reason: 'AI 응답에 이 기사가 포함되지 않았습니다.'});
  return {results, excluded_news: excluded};
}

export function visibleNews(news, query, keyword, sort) {
  const q = query.trim().toLocaleLowerCase();
  return news.filter(n => (!keyword || n.matched_keywords.includes(keyword)) &&
    `${n.title} ${n.summary} ${n.source}`.toLocaleLowerCase().includes(q))
    .sort((a, b) => sort === 'recent' ? (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0) : b.importance_score - a.importance_score);
}

// Groups already-sorted articles under the reader's keywords, in the reader's keyword order.
// An article matching several keywords appears once, under the first one; unmatched ones go last.
export function groupByKeyword(news, keywords) {
  const groups = new Map([...keywords, ''].map(k => [k, []]));
  for (const n of news) {
    const keyword = keywords.find(k => n.matched_keywords.includes(k)) ?? '';
    groups.get(keyword).push(n);
  }
  return [...groups].filter(([, items]) => items.length);
}

// Rough reading time for titles and summaries, at about 500 Korean characters a minute.
export function readingMinutes(news) {
  const chars = news.reduce((sum, n) => sum + n.title.length + n.summary.length, 0);
  return Math.max(1, Math.round(chars / 500));
}

// Per-topic preference change over the last `days`, from the server feedback history.
// Uses scores rather than counting clicks, so the ±5 cap is respected.
export function recentChanges(history, now = Date.now(), days = 7) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const byTopic = new Map();
  for (const h of history) {
    const time = Date.parse(h.created_at);
    if (!Number.isFinite(time) || time < since) continue;
    const step = h.feedback_type === 'like' ? 1 : -1;
    const start = Number.isInteger(h.previous_score) ? h.previous_score : h.new_score - step;
    const entry = byTopic.get(h.topic) ?? {first: {time, start}, last: {time, score: h.new_score}, count: 0};
    if (time < entry.first.time) entry.first = {time, start};
    if (time >= entry.last.time) entry.last = {time, score: h.new_score};
    entry.count++;
    byTopic.set(h.topic, entry);
  }
  return [...byTopic].map(([topic, e]) => ({topic, change: e.last.score - e.first.start, count: e.count}))
    .filter(c => c.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.change - a.change);
}

export function loadSettings(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!value || !Array.isArray(value.keywords) || value.keywords.some(k => typeof k !== 'string') ||
        typeof value.userId !== 'string' || value.userId.length > 100) return {keywords: [], userId: ''};
    return {keywords: parseKeywords(value.keywords.join(',')), userId: value.userId.trim()};
  } catch { return {keywords: [], userId: ''}; }
}

// Restores the last real briefing of this tab. Anything malformed is dropped, never partially trusted.
export function loadSession(storage) {
  const empty = {news: [], sourceName: '', results: [], excluded: [], hasResult: false};
  const text = value => typeof value === 'string';
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEY));
    if (!value || !Array.isArray(value.news) || !value.news.length || !text(value.sourceName) ||
        !Array.isArray(value.results) || !Array.isArray(value.excluded)) return empty;
    const news = parseNews(JSON.stringify(value.news));
    const originals = new Map(news.map(n => [n.id, n]));
    const resultsValid = value.results.every(n => originals.has(n?.id) && text(n.summary) && text(n.selection_reason) &&
      Number.isInteger(n.importance_score) && n.importance_score >= 0 && n.importance_score <= 100 &&
      Array.isArray(n.matched_keywords) && n.matched_keywords.every(text));
    const excludedValid = value.excluded.every(n => originals.has(n?.id) && text(n.reason));
    if (!resultsValid || !excludedValid) return {...empty, news, sourceName: value.sourceName};
    // Title, source, URL and time always come from the validated article, as after a fresh summary.
    const results = value.results.map(n => ({...originals.get(n.id), summary: n.summary, importance_score: n.importance_score,
      matched_keywords: n.matched_keywords, selection_reason: n.selection_reason}));
    const excluded = value.excluded.map(n => ({id: n.id, title: originals.get(n.id).title, reason: n.reason}));
    return {news, sourceName: value.sourceName, results, excluded, hasResult: results.length + excluded.length > 0};
  } catch { return empty; }
}

// Feedback already sent from this browser. A request still pending at reload has an unknown outcome.
export function loadFeedback(storage) {
  try {
    const entries = JSON.parse(storage.getItem(FEEDBACK_KEY));
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.filter(e => Array.isArray(e) && typeof e[0] === 'string' && ['like', 'dislike'].includes(e[1]?.type) && typeof e[1].message === 'string')
      .map(([key, entry]) => [key, entry.pending ?
        {type: entry.type, tone: 'error', message: '저장 여부를 확인하지 못했어요. 내 취향에서 확인하세요.'} :
        {type: entry.type, tone: entry.tone === 'success' ? 'success' : 'error', message: entry.message}]));
  } catch { return new Map(); }
}
export function serializeFeedback(feedback) {
  return JSON.stringify([...feedback].slice(-MAX_FEEDBACK_ENTRIES));
}
