export const MAX_NEWS = 30;
export const MAX_FILE_BYTES = 1024 * 1024;
export const STORAGE_KEY = 'daybrief.settings.v1';

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

export function loadSettings(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!value || !Array.isArray(value.keywords) || value.keywords.some(k => typeof k !== 'string') ||
        typeof value.userId !== 'string' || value.userId.length > 100) return {keywords: [], userId: ''};
    return {keywords: parseKeywords(value.keywords.join(',')), userId: value.userId.trim()};
  } catch { return {keywords: [], userId: ''}; }
}
