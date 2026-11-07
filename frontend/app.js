import {createApi} from './api.mjs';
import {parseNews, parseKeywords, visibleNews, groupByKeyword, readingMinutes, recentChanges, validateSummary, loadSettings, loadSession, loadFeedback, serializeFeedback, safeUrl,
  STORAGE_KEY, SESSION_KEY, FEEDBACK_KEY, MAX_FILE_BYTES} from './domain.mjs';
import {demoBriefing} from './demo.mjs';

const $ = id => document.getElementById(id);
const api = createApi();
let storage, session;
try { storage = window.localStorage; } catch { /* Restricted browsers still work in memory. */ }
try { session = window.sessionStorage; } catch { /* Same: the briefing just won't survive a reload. */ }
const state = {settings: loadSettings(storage), news: [], results: [], excluded: [], mode: 'real',
  hasResult: false, query: '', keyword: '', sort: 'keyword', busy: false, generation: 0,
  feedback: loadFeedback(storage), memoryGeneration: 0, sourceName: '', composerOpen: false, ...loadSession(session)};
let summaryController, memoryController;
// News collected by the server (GET /api/news). Anything else came from the test tools' file upload.
const RSS_SOURCE = '언론사 RSS';

// Static, trusted icon markup only. Never interpolate user or server text here.
const ICONS = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0L8 8m4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M5 11h14M5 16h9"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14V4H4v10zM7 14l4 7a2 2 0 0 0 2-2v-4h5.5a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.3 4H7"/></svg>',
};
function icon(name, className = 'icon') {
  const span = document.createElement('span');
  span.className = className; span.setAttribute('aria-hidden', 'true'); span.innerHTML = ICONS[name];
  return span;
}

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function message(id, text = '') { $(id).textContent = text; $(id).hidden = !text; }
// Screen-reader announcement for changes that are already visible on the page.
function announce(text) { $('live').textContent = ''; setTimeout(() => { $('live').textContent = text; }, 50); }
// Visible confirmation, optionally with the next useful action.
function notify(text, href, linkText) {
  $('notice').replaceChildren(node('span', '', text));
  if (href) $('notice').append(link(linkText, href));
  $('notice').hidden = false;
}
function dateLabel(value, options = {}) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', ...options}).format(date) : '게시 시각 미상';
}
function link(text, href, className = 'inline-link') {
  const a = node('a', className, text); a.href = href; return a;
}
function button(text, className, action) {
  const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', action); return b;
}
function saveToStorage() {
  try { if (!storage) throw new Error(); storage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); return true; } catch { return false; }
}
// Keep the real briefing across reloads of this tab. The example is never stored.
function saveSession() {
  if (state.mode !== 'real') return;
  const done = state.hasResult && !state.busy;
  try { session?.setItem(SESSION_KEY, JSON.stringify({news: state.news, sourceName: state.sourceName,
    results: done ? state.results : [], excluded: done ? state.excluded : []})); } catch { /* Quota or blocked storage. */ }
}
function setFeedback(key, entry) {
  state.feedback.set(key, entry);
  try { storage?.setItem(FEEDBACK_KEY, serializeFeedback(state.feedback)); } catch { /* Still blocks resends in this tab. */ }
}

function cancelSummary() {
  state.generation++;
  summaryController?.abort();
  state.busy = false;
  $('results').setAttribute('aria-busy', 'false');
  updateView();
}
function resetResults() {
  cancelSummary();
  state.results = []; state.excluded = []; state.hasResult = false; state.composerOpen = false;
  state.query = ''; state.keyword = ''; $('search').value = '';
  message('summary-error'); message('summary-error-compose'); renderResults(); saveSession();
}

// Serialize writes so older requests cannot overwrite newer keyword changes.
let keywordSaveQueue = Promise.resolve();
let keywordEditRevision = 0;
let keywordLoadGeneration = 0;

function persistKeywords() {
  const userId = state.settings.userId;
  if (!userId) return;

  const keywords = [...state.settings.keywords];
  keywordSaveQueue = keywordSaveQueue
    .catch(() => {})
    .then(() => api.saveKeywords(userId, keywords));

  keywordSaveQueue.catch(error => {
    if (error.status === 403) return;
    if (state.settings.userId === userId) {
      message('settings-error', `서버에 키워드를 저장하지 못했어요. ${error.message}`);
    }
  });
}

async function loadServerKeywords(migrateLocal = false) {
  const userId = state.settings.userId;
  if (!userId) return;

  const generation = ++keywordLoadGeneration;
  const revision = keywordEditRevision;
  const localKeywords = [...state.settings.keywords];

  try {
    // Wait for pending keyword saves before loading remote settings.
    await keywordSaveQueue.catch(() => {});

    if (generation !== keywordLoadGeneration ||
        revision !== keywordEditRevision ||
        state.settings.userId !== userId) return;

    const data = await api.getKeywords(userId);

    if (generation !== keywordLoadGeneration ||
        revision !== keywordEditRevision ||
        state.settings.userId !== userId) return;

    if (data.exists === false && migrateLocal && localKeywords.length) {
      persistKeywords();
      return;
    }

    const keywords = parseKeywords((data.keywords || []).join(','));
    state.settings = {...state.settings, keywords};
    saveToStorage();
    renderKeywordTags();
    updateView();
  } catch (error) {
    if (error.status === 403) return;
    if (generation === keywordLoadGeneration &&
        state.settings.userId === userId) {
      message('settings-error', `서버 키워드를 불러오지 못했어요. ${error.message}`);
    }
  }
}

// ---------- Keywords ----------

const SUGGESTED_KEYWORDS = ['AI', '반도체', '경제', '부동산', '스타트업', '채용', '기후', '정책'];
function suggestionButtons(afterAdd) {
  return SUGGESTED_KEYWORDS.filter(k => !state.settings.keywords.includes(k)).map(keyword => {
    const b = button(`+ ${keyword}`, 'suggest-chip', () => { if (addKeywords(keyword)) afterAdd(); });
    b.setAttribute('aria-label', `${keyword} 키워드 추가`); return b;
  });
}
function renderKeywordTags() {
  const keywords = state.settings.keywords;
  $('keyword-tags').replaceChildren(...keywords.map(keyword => {
    const li = node('li', 'tag'); li.append(node('span', '', keyword));
    const remove = button('', 'tag-remove', () => { removeKeyword(keyword); $('keyword-input').focus(); });
    remove.setAttribute('aria-label', `${keyword} 키워드 삭제`); remove.append(icon('x'));
    li.append(remove); return li;
  }));
  $('keyword-suggestions').replaceChildren(...suggestionButtons(() => $('keyword-input').focus()));
  $('keyword-suggestions').parentElement.hidden = !$('keyword-suggestions').children.length;
  $('composer-keywords').replaceChildren(...(keywords.length ? keywords.map(k => node('li', 'chip', k)) : [node('li', 'chip-empty', '아직 정하지 않았어요')]));
  $('edit-keywords').textContent = keywords.length ? '바꾸기' : '정하기';
  $('user-id').value = state.settings.userId;
}
function setKeywords(keywords) {
  keywordEditRevision++;
  state.settings = {...state.settings, keywords};
  // A briefing made with the old keywords is stale.
  if (state.hasResult) {
    const hadRealResult = state.mode === 'real';
    state.mode = 'real'; resetResults();
    if (hadRealResult) notify('키워드가 바뀌어 이전 브리핑을 지웠어요. 새 키워드로 다시 만들어 주세요.', '#briefing', '브리핑으로 이동');
  }
  saveToStorage(); renderKeywordTags(); updateView();
  persistKeywords();
}
function addKeywords(raw) {
  if (!raw.trim()) return true;
  try {
    setKeywords(parseKeywords([...state.settings.keywords, raw].join(',')));
    $('keyword-input').value = ''; message('keyword-error'); $('tag-input').removeAttribute('data-invalid');
    return true;
  } catch (error) {
    message('keyword-error', error.message); $('tag-input').dataset.invalid = 'true';
    return false;
  }
}
function removeKeyword(keyword) {
  setKeywords(state.settings.keywords.filter(k => k !== keyword));
  announce(`${keyword} 키워드를 삭제했어요.`);
}

function importNews(text, name) {
  try {
    const news = parseNews(text);
    state.mode = 'real'; state.news = news; state.sourceName = name; resetResults();
    message('import-error'); announce(`${name}에서 기사 ${news.length}건을 불러왔어요.`);
    updateView();
  } catch (error) { message('import-error', error.message); }
}
async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { message('import-error', '파일은 1MB 이하로 선택해 주세요.'); return; }
  try { importNews(await file.text(), file.name); } catch { message('import-error', '파일을 읽지 못했어요. 다시 선택해 주세요.'); }
}

// ---------- View state ----------

function updateView() {
  const demo = state.mode === 'demo';
  const hasKeywords = state.settings.keywords.length > 0, hasNews = state.news.length > 0;
  const showResults = !state.busy && (demo || state.hasResult) && !state.composerOpen;
  $('composer').hidden = state.busy || showResults;
  $('progress').hidden = !state.busy;
  $('results').hidden = !showResults;
  $('demo-banner').hidden = !demo;
  $('back-to-results').hidden = !(state.composerOpen && state.hasResult);

  const uploaded = hasNews && state.sourceName !== RSS_SOURCE;
  $('dropzone').hidden = uploaded;
  $('file-row').hidden = !uploaded;
  $('file-name').textContent = state.sourceName;
  $('file-count').textContent = `기사 ${state.news.length}건`;

  const status = $('news-status');
  status.dataset.state = hasKeywords ? 'ready' : 'empty';
  if (!hasKeywords) status.replaceChildren(node('strong', '', '관심 키워드를 먼저 정해 주세요'), node('span', '', '키워드에 맞는 기사만 골라 드려요. '), link('키워드 정하기', '#settings'));
  else if (uploaded) status.replaceChildren(node('strong', '', `불러온 뉴스 ${state.news.length}건으로 만들어요`), node('span', '', '테스트 도구에서 불러온 파일의 기사만 사용해요.'));
  else status.replaceChildren(node('strong', '', '오늘의 뉴스를 바로 모아 드려요'), node('span', '', '언론사 기사 중 관심 키워드에 맞는 최근 24시간 기사를 모아 요약해요.'));

  // Without keywords there is nothing to look for, so the example becomes the main action.
  $('generate').hidden = false;
  $('generate').disabled = state.busy || !hasKeywords;
  $('show-demo').className = hasKeywords ? 'text-button' : 'secondary';
  $('generate-hint').textContent = !hasKeywords ? '관심 키워드를 정하면 만들 수 있어요.' :
    `기사를 모으고 요약하는 데 1~3분 정도 걸려요.${state.settings.userId ? ' 내 취향도 함께 반영해요.' : ''}`;
}

async function generate() {
  if (state.busy || !state.settings.keywords.length) return;
  // A file from the test tools is used as is; otherwise fresh news is collected on every run.
  const useUploaded = state.mode === 'real' && state.news.length > 0 && state.sourceName !== RSS_SOURCE;
  state.mode = 'real';
  resetResults();
  state.busy = true;
  summaryController = new AbortController();
  const signal = summaryController.signal;
  const run = state.generation;
  const snapshot = {user_id: state.settings.userId || null, user_keywords: [...state.settings.keywords]};
  $('progress-title').textContent = useUploaded ? '뉴스를 요약하고 있어요' : '오늘의 뉴스를 모으고 있어요';
  $('progress-bar').style.width = '6%';
  $('loading-progress').textContent = useUploaded ? '요약을 시작해요.' : `언론사 기사에서 ${snapshot.user_keywords.join(', ')} 관련 기사를 찾고 있어요.`;
  updateView(); renderDashBriefing(); $('cancel-summary').focus();
  $('results').setAttribute('aria-busy', 'true');
  let succeeded = 0;
  const failed = [];
  try {
    if (!useUploaded) {
      let collected;
      try {
        collected = (await api.news(snapshot.user_keywords, signal)).news;
        if (run !== state.generation) return;
        state.news = collected?.length ? parseNews(JSON.stringify({news: collected})) : [];
        state.sourceName = RSS_SOURCE;
      } catch (error) {
        if (signal.aborted || run !== state.generation) return;
        message('summary-error-compose', `오늘의 뉴스를 모으지 못했어요. ${error.message}`);
        announce('뉴스를 모으지 못했어요.');
        return;
      }
      if (!state.news.length) {
        // Nothing matched in the last 24 hours: show an empty briefing instead of calling the AI.
        state.hasResult = true;
        announce('최근 24시간 동안 관심 키워드에 맞는 기사가 없어요.');
        return;
      }
      $('progress-title').textContent = '뉴스를 요약하고 있어요';
    }
    const batches = [];
    for (let i = 0; i < state.news.length; i += 5) batches.push(state.news.slice(i, i + 5));
    setProgress(0, batches.length);
    for (const [index, batch] of batches.entries()) {
      try {
        const raw = await api.summarize({...snapshot, news: batch}, signal);
        if (run !== state.generation) return;
        const result = validateSummary(raw, batch);
        state.results.push(...result.results); state.excluded.push(...result.excluded_news); succeeded++;
      } catch (error) {
        if (signal.aborted || run !== state.generation) return;
        failed.push(`${index + 1}번째 묶음: ${error.message}`);
      }
      setProgress(index + 1, batches.length);
    }
    if (run !== state.generation) return;
    state.hasResult = succeeded > 0;
    if (!succeeded) message('summary-error-compose', `브리핑을 만들지 못했어요. 서버 연결을 확인한 뒤 다시 시도하세요. ${failed.join(' ')}`);
    else if (failed.length) message('summary-error', `${failed.length}개 묶음을 요약하지 못해 성공한 결과만 표시해요. 다시 만들면 전체 기사를 다시 요청해요. ${failed.join(' ')}`);
    announce(succeeded ? `${state.results.length}건의 요약을 준비했어요.` : '브리핑을 만들지 못했어요.');
  } finally {
    if (run === state.generation) {
      state.busy = false; $('results').setAttribute('aria-busy', 'false');
      updateView(); renderResults(); renderDashBriefing(); saveSession();
      // The progress card disappears, so move focus to what replaced it.
      if (state.hasResult) $('results-title').focus(); else $('generate').focus();
    }
  }
}
function openDemo() {
  resetResults(); state.mode = 'demo'; state.results = structuredClone(demoBriefing.results); state.excluded = structuredClone(demoBriefing.excluded_news); state.hasResult = true;
  updateView(); renderResults(); announce('예시 브리핑을 열었어요. 실제 API는 호출하지 않았어요.');
  // Focusing the title alone scrolls the example banner under the sticky app bar.
  $('results-title').focus({preventScroll: true}); window.scrollTo(0, 0);
}
function setProgress(done, total) {
  $('progress-bar').style.width = `${Math.max(6, Math.round(done / total * 100))}%`;
  $('loading-progress').textContent = done < total ? `${total}개 묶음 중 ${done}개 완료 · 기사 ${state.news.length}건` : '결과를 정리하고 있어요.';
  renderDashBriefing();
}

// ---------- Results ----------

function renderResults() {
  const demo = state.mode === 'demo';
  $('results-date').textContent = demo ? '화면 확인용 예시' : `${dateLabel(new Date(), {weekday: 'long'})} 브리핑`;
  $('results-title').textContent = demo ? `예시 기사 ${state.results.length}건` : `오늘 고른 기사 ${state.results.length}건`;
  const reading = state.results.length ? ` 약 ${readingMinutes(state.results)}분이면 다 읽어요.` : '';
  $('results-meta').textContent = demo ? `저장소의 테스트 기사 · 2026년 10월 13일.${reading}` :
    state.hasResult ? `뉴스 ${state.news.length}건 중 관심 키워드(${state.settings.keywords.join(', ')})에 맞는 기사만 골랐어요.${reading}` : '';
  $('new-briefing').hidden = demo;

  const filterRoot = $('keyword-filters'); filterRoot.replaceChildren();
  const keywords = [...new Set(state.results.flatMap(r => r.matched_keywords))];
  filterRoot.hidden = !state.results.length;
  for (const keyword of ['', ...keywords]) {
    const count = keyword ? state.results.filter(r => r.matched_keywords.includes(keyword)).length : state.results.length;
    const b = button('', 'segment', () => {
      state.keyword = keyword; renderResults();
      // Restore focus after replacing the filter controls.
      [...filterRoot.children].find(el => el.dataset.keyword === keyword)?.focus();
    });
    b.append(node('span', '', keyword || '전체'), node('span', 'segment-count', String(count)));
    b.dataset.keyword = keyword; b.setAttribute('aria-pressed', String(state.keyword === keyword)); filterRoot.append(b);
  }

  const hint = $('feedback-hint'); hint.replaceChildren();
  hint.hidden = !state.results.length || demo;
  if (state.settings.userId) hint.append('기사마다 좋아요·관심없음을 누르면 다음 브리핑을 고를 때 반영돼요.');
  else hint.append('좋아요·관심없음을 남기려면 ', link('관심사 설정', '#settings'), '에서 구독자 ID를 넣어 주세요.');

  renderNewsList();
  $('excluded').hidden = !state.excluded.length;
  $('excluded-label').textContent = `고르지 않은 기사 ${state.excluded.length}건`;
  $('excluded-list').replaceChildren(...state.excluded.map(n => {
    const li = node('li'); li.append(node('strong', '', n.title), node('p', '', n.reason)); return li;
  }));
}
function renderNewsList() {
  const news = visibleNews(state.results, state.query, state.keyword, state.sort);
  if (state.sort === 'keyword' && !state.keyword) {
    // Same shape as the email briefing: the reader's keywords first, then any other matched keyword.
    const order = [...new Set([...state.settings.keywords, ...state.results.flatMap(r => r.matched_keywords)])];
    $('news-list').replaceChildren(...groupByKeyword(news, order).map(([keyword, items]) => {
      const group = node('li', 'story-group');
      const head = node('h2', 'group-title'); head.append(node('span', '', keyword || '기타'), node('span', 'group-count', `${items.length}건`));
      const list = node('ol', 'story-list'); list.append(...items.map((n, i) => story(n, i)));
      group.append(head, list); return group;
    }));
  } else $('news-list').replaceChildren(...news.map((n, i) => story(n, i)));
  const empty = $('empty-state'); empty.hidden = news.length > 0;
  if (news.length) return;
  if (state.results.length) {
    empty.replaceChildren(node('h3', '', '조건에 맞는 기사가 없어요'), node('p', '', '검색어나 키워드 필터를 바꿔 보세요.'),
      button('검색 조건 초기화', 'secondary', () => { state.query = ''; state.keyword = ''; $('search').value = ''; renderResults(); $('search').focus(); }));
  } else {
    empty.replaceChildren(node('h3', '', '이번 뉴스에서 선정된 기사가 없어요'), node('p', '', '아래에서 제외 이유를 확인하거나 다른 뉴스·키워드로 다시 만들어 보세요.'));
  }
}
function story(news, index) {
  const li = node('li', 'story');
  const article = node('article', 'story-inner');
  const top = node('div', 'story-top');
  const meta = node('p', 'story-meta');
  meta.append(node('span', 'rank', String(index + 1)), node('span', 'source', news.source), node('span', 'dot', '·'),
    node('time', '', dateLabel(news.published_at, {hour: '2-digit', minute: '2-digit'})));
  const score = node('span', `score ${news.importance_score >= 80 ? 'score-high' : news.importance_score >= 60 ? 'score-mid' : 'score-low'}`, `중요도 ${news.importance_score}`);
  score.setAttribute('aria-label', `중요도 100점 중 ${news.importance_score}점`);
  top.append(meta, score);

  const title = node('h3', 'story-title', news.title);
  const summary = node('p', 'story-summary', news.summary);
  const tags = node('ul', 'story-tags'); tags.setAttribute('aria-label', '관련 키워드');
  for (const keyword of news.matched_keywords) tags.append(node('li', '', keyword));

  const reason = node('details', 'reason');
  reason.append(node('summary', '', '왜 골랐나요'), node('p', '', news.selection_reason || '고른 이유가 함께 오지 않았어요.'));

  const foot = node('div', 'story-foot');
  const left = node('div', 'story-links');
  const url = safeUrl(news.url);
  if (url && state.mode !== 'demo') {
    const a = node('a', 'source-link', '원문 보기'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `${news.title} 원문 보기 (새 탭)`); a.append(icon('external')); left.append(a);
  }
  left.append(reason);
  foot.append(left);
  const feedback = feedbackControls(news);
  if (feedback) foot.append(feedback);

  article.append(top, title, summary);
  if (news.matched_keywords.length) article.append(tags);
  article.append(foot);
  li.append(article);
  return li;
}
function feedbackControls(news) {
  // The hint above the list explains why feedback is unavailable, instead of repeating it per article.
  if (state.mode === 'demo' || !state.settings.userId) return null;
  const wrap = node('div', 'feedback');
  const row = node('div', 'feedback-row');
  const keywords = news.matched_keywords;
  let control = null;
  if (keywords.length > 1) {
    control = node('select', 'topic-control');
    keywords.forEach(k => { const option = node('option', '', k); option.value = k; control.append(option); });
  } else if (!keywords.length) {
    control = node('input', 'topic-control'); control.placeholder = '주제 입력'; control.maxLength = 100;
  }
  if (control) control.setAttribute('aria-label', `${news.title} 피드백 주제`);
  const topicValue = () => (control ? control.value : keywords[0]).trim();
  const status = node('p', 'feedback-status'); status.setAttribute('role', 'status');
  const userId = state.settings.userId;
  const key = () => JSON.stringify([userId, news.id, topicValue()]);
  const update = () => {
    const entry = state.feedback.get(key());
    like.disabled = dislike.disabled = Boolean(entry) || !topicValue();
    like.setAttribute('aria-pressed', String(entry?.type === 'like'));
    dislike.setAttribute('aria-pressed', String(entry?.type === 'dislike'));
    if (control) control.disabled = entry?.pending || false;
    status.textContent = entry?.message || '';
    status.dataset.tone = entry?.tone || '';
  };
  const send = async type => {
    const value = topicValue(), requestKey = key();
    if (!value || state.feedback.has(requestKey)) return;
    setFeedback(requestKey, {type, pending: true, message: '저장하고 있어요.'}); update();
    // Disabled buttons drop focus; keep keyboard users at the result message.
    status.tabIndex = -1; status.focus();
    try {
      const data = await api.feedback({user_id: userId, news_id: news.id, topic: value, feedback_type: type});
      if (!Number.isInteger(data.preference_score) || data.preference_score < -5 || data.preference_score > 5) throw new Error('저장 결과를 확인하지 못했어요.');
      setFeedback(requestKey, {type, tone: 'success', message: `${value} 선호도 ${data.preference_score > 0 ? '+' : ''}${data.preference_score}로 반영했어요.`});
    } catch (error) {
      // The backend is cumulative and lacks idempotency. Do not offer a blind retry after an ambiguous failure.
      setFeedback(requestKey, {type, tone: 'error', message: `${error.message} 저장 여부는 내 취향에서 확인하세요. 중복 반영을 막으려고 다시 보내지 않아요.`});
    }
    update();
    if (!wrap.isConnected && state.mode === 'real' && state.settings.userId === userId) renderNewsList();
  };
  const like = button('', 'vote', () => send('like'));
  const dislike = button('', 'vote', () => send('dislike'));
  like.append(icon('up'), node('span', '', '좋아요')); dislike.append(icon('down'), node('span', '', '관심없음'));
  like.setAttribute('aria-label', `${news.title} 좋아요`); dislike.setAttribute('aria-label', `${news.title} 관심없음`);
  control?.addEventListener('change', update); control?.addEventListener('input', update);
  if (control) row.append(control);
  row.append(like, dislike); wrap.append(row, status); update(); return wrap;
}

// ---------- Memory ----------

function memoryPlaceholder() {
  const id = state.settings.userId;
  $('memory-user').textContent = id ? `구독자 ID ${id}로 쌓인 취향이에요. 다음 브리핑을 고를 때 반영돼요.` : '기사에 남긴 좋아요·관심없음이 주제별 취향으로 쌓여요.';
  $('refresh-memory').hidden = !id;
  const empty = node('div', 'card empty-card');
  if (id) empty.append(node('h2', '', '기록을 불러와 확인하세요'), node('p', '', '다시 불러오기를 누르면 서버에 저장된 실제 기록을 조회해요.'));
  else empty.append(node('h2', '', '구독자 ID가 필요해요'), node('p', '', '관심사 설정에서 구독자 ID를 넣으면 내 취향을 볼 수 있어요.'), link('관심사 설정으로 이동', '#settings', 'secondary'));
  $('memory-content').replaceChildren(empty);
}
function checkMemory(data) {
  if (!data || !data.topic_preferences || typeof data.topic_preferences !== 'object' || Array.isArray(data.topic_preferences) ||
      Object.entries(data.topic_preferences).some(([k, v]) => !k || !Number.isInteger(v) || v < -5 || v > 5) ||
      !Array.isArray(data.feedback_history) || data.feedback_history.some(h => !h || typeof h.topic !== 'string' || !['like', 'dislike'].includes(h.feedback_type) || typeof h.news_id !== 'string' || !Number.isInteger(h.new_score))) {
    throw new Error('피드백 기록 응답 형식을 확인할 수 없어요.');
  }
  return data;
}
function preferenceBar(topic, score) {
  const bar = node('span', 'pref-bar'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${topic} 선호도 ${score}, 범위 −5부터 +5`);
  const fill = node('span', `pref-fill ${score < 0 ? 'negative' : ''}`);
  fill.style.width = `${Math.abs(score) * 10}%`;
  fill.style.left = score < 0 ? `${50 - Math.abs(score) * 10}%` : '50%';
  bar.append(fill);
  return bar;
}
function prefList(entries) {
  const list = node('ul', 'pref-list');
  for (const [topic, score] of entries) {
    const row = node('li', 'pref-row');
    row.append(node('strong', 'pref-topic', topic), preferenceBar(topic, score), node('span', `pref-score ${score < 0 ? 'negative' : ''}`, `${score > 0 ? '+' : ''}${score}`));
    list.append(row);
  }
  return list;
}
async function loadMemory() {
  if (!state.settings.userId) return;
  memoryController?.abort(); memoryController = new AbortController();
  const generation = ++state.memoryGeneration;
  $('refresh-memory').disabled = true; $('memory-loading').hidden = false;
  $('memory-content').replaceChildren(); message('memory-error');
  try {
    const data = checkMemory(await api.memory(state.settings.userId, memoryController.signal));
    if (generation !== state.memoryGeneration) return;
    renderMemory(data);
  } catch (error) {
    if (generation === state.memoryGeneration && error.name !== 'AbortError') message('memory-error', error.message);
  } finally {
    if (generation === state.memoryGeneration) {
      $('refresh-memory').disabled = false; $('memory-loading').hidden = true;
      if (document.activeElement === document.body) $('refresh-memory').focus();
    }
  }
}
const signed = n => `${n > 0 ? '+' : ''}${n}`;
function trendCard(history) {
  const card = node('section', 'card memory-card trend-card');
  const head = node('div', 'card-head'); head.append(node('h2', '', '최근 7일 동안 달라진 취향'));
  card.append(head);
  const changes = recentChanges(history);
  if (!changes.length) { card.append(node('p', 'empty-inline', '최근 7일 동안 취향 점수가 바뀐 주제가 없어요.')); return card; }
  const list = node('ul', 'trend-list');
  for (const {topic, change, count} of changes) {
    const up = change > 0;
    const li = node('li', 'trend-row');
    const copy = node('div', 'trend-copy');
    copy.append(node('strong', '', topic), node('p', '', `${up ? '다음 브리핑에서 더 우선적으로 골라요' : '다음 브리핑에서 덜 골라요'} · 좋아요·관심없음 ${count}번`));
    li.append(icon(up ? 'up' : 'down', `history-icon ${up ? 'like' : 'dislike'}`), copy, node('span', `pref-score ${up ? '' : 'negative'}`, signed(change)));
    list.append(li);
  }
  card.append(list);
  return card;
}
function renderMemory(data) {
  const preferences = Object.entries(data.topic_preferences).sort((a, b) => b[1] - a[1]);
  const prefCard = node('section', 'card memory-card');
  const prefHead = node('div', 'card-head'); prefHead.append(node('h2', '', '주제별 취향'), node('span', 'field-hint', '좋아요 +1 · 관심없음 −1'));
  prefCard.append(prefHead);
  if (!preferences.length) prefCard.append(node('p', 'empty-inline', '아직 쌓인 취향이 없어요. 브리핑에서 좋아요·관심없음을 남겨 보세요.'));
  else {
    const legend = node('p', 'pref-legend'); legend.setAttribute('aria-hidden', 'true');
    legend.append(node('span', '', '덜 보고 싶어요'), node('span', '', '더 보고 싶어요'));
    prefCard.append(legend, prefList(preferences));
  }

  // The server stores only article IDs; show the title when the article is in this tab's news.
  const titles = new Map(state.news.map(n => [n.id, n.title]));
  const historyCard = node('section', 'card memory-card');
  const historyHead = node('div', 'card-head'); historyHead.append(node('h2', '', '좋아요·관심없음 기록'), node('span', 'field-hint', `${data.feedback_history.length}건`));
  historyCard.append(historyHead);
  if (!data.feedback_history.length) historyCard.append(node('p', 'empty-inline', '아직 남긴 기록이 없어요.'));
  const list = node('ol', 'history-list');
  for (const item of data.feedback_history) {
    const li = node('li');
    const like = item.feedback_type === 'like';
    const badge = icon(like ? 'up' : 'down', `history-icon ${like ? 'like' : 'dislike'}`);
    const copy = node('div', 'history-copy');
    copy.append(node('strong', '', `${item.topic} · ${like ? '좋아요' : '관심없음'}`), node('p', '', `${titles.get(item.news_id) ?? `기사 ${item.news_id}`} · 반영 후 ${item.topic} ${item.new_score > 0 ? '+' : ''}${item.new_score}`));
    li.append(badge, copy, node('time', 'history-time', dateLabel(item.created_at, {hour: '2-digit', minute: '2-digit'})));
    list.append(li);
  }
  if (data.feedback_history.length) historyCard.append(list);
  $('memory-content').replaceChildren(trendCard(data.feedback_history), prefCard, historyCard);
}

// ---------- Dashboard ----------

let dashController;
function dashCard(title, id) {
  const card = node('section', 'card dash-card'); if (id) card.id = id;
  const head = node('div', 'card-head'); head.append(node('h2', '', title)); card.append(head);
  return card;
}
function actions(...items) {
  const row = node('div', 'hero-actions'); row.append(...items); return row;
}
// Run a briefing-page action from the home screen.
function goToBriefing(then) {
  history.pushState(null, '', '#briefing'); route(); then();
}
function renderDashboard() {
  dashController?.abort();
  const hero = node('section', 'card dash-hero'); hero.id = 'dash-briefing'; hero.setAttribute('aria-labelledby', 'dash-hero-title');
  const prefs = dashCard('내 취향', 'dash-prefs');
  const delivery = dashCard('메일 브리핑');
  const grid = node('div', 'dash-grid'); grid.append(prefs, delivery);
  const steps = dashSteps();
  $('dashboard-content').replaceChildren(hero, ...(steps ? [steps] : []), grid);
  renderDashBriefing();
  loadDashPrefs(prefs);
  // Fixed schedule from .github/workflows/daily-briefing.yml (cron 30 22 * * * UTC).
  delivery.append(node('p', 'dash-big', '매일 오전 7:30'), node('p', 'field-hint', '관심 키워드에 맞춘 브리핑을 메일로 보내요. 구독 신청과 변경은 아직 팀에서 직접 관리해요.'));
}
function dashSteps() {
  const userId = state.settings.userId;
  // Feedback keys are JSON arrays that start with the user ID.
  const prefix = JSON.stringify([userId]).slice(0, -1) + ',';
  const steps = [
    [state.settings.keywords.length > 0, '관심 키워드 정하기', '#settings'],
    [state.mode === 'real' && state.hasResult, '오늘의 브리핑 읽기', '#briefing'],
    [Boolean(userId) && [...state.feedback.keys()].some(k => k.startsWith(prefix)), '좋아요·관심없음 남기기', userId ? '#briefing' : '#settings'],
  ];
  if (steps.every(([done]) => done)) return null;
  const card = node('section', 'card steps-card'); card.setAttribute('aria-labelledby', 'steps-title');
  const title = node('h2', '', '이렇게 사용해요'); title.id = 'steps-title';
  const list = node('ol', 'steps');
  steps.forEach(([done, text, href], i) => {
    const li = node('li', done ? 'done' : '');
    const a = link('', href, 'step');
    const num = node('span', 'step-num', done ? '✓' : String(i + 1)); num.setAttribute('aria-hidden', 'true');
    a.append(num, node('span', 'step-text', text));
    if (done) a.append(node('span', 'visually-hidden', ' (완료)'));
    li.append(a); list.append(li);
  });
  card.append(title, list);
  return card;
}
function renderDashBriefing() {
  const card = $('dash-briefing'); if (!card) return;
  const keywords = state.settings.keywords;
  const title = text => { const h = node('h2', 'hero-title', text); h.id = 'dash-hero-title'; h.tabIndex = -1; return h; };
  const chips = () => { const ul = node('ul', 'chips'); ul.setAttribute('aria-label', '관심 키워드'); ul.append(...keywords.map(k => node('li', 'chip', k))); return ul; };
  if (state.busy) {
    card.replaceChildren(node('p', 'overline', '진행 중'), title('브리핑을 만들고 있어요'), node('p', 'lead', $('loading-progress').textContent),
      actions(link('진행 상황 보기', '#briefing', 'secondary')));
    return;
  }
  if (state.mode === 'real' && state.hasResult) {
    const n = state.results.length;
    card.replaceChildren(node('p', 'overline', '오늘의 브리핑'), title(n ? `관심 기사 ${n}건을 골랐어요` : '오늘은 관심 키워드에 맞는 기사가 없어요'), chips());
    if (n) card.append(node('p', 'lead', `약 ${readingMinutes(state.results)}분이면 다 읽어요.`));
    const top = [...state.results].sort((a, b) => b.importance_score - a.importance_score).slice(0, 3);
    if (top.length) {
      const list = node('ol', 'top-list');
      top.forEach((item, i) => {
        const li = node('li'); const copy = node('div', 'top-copy');
        copy.append(node('strong', '', item.title), node('span', '', `${item.source} · 중요도 ${item.importance_score}`));
        li.append(node('span', 'rank', String(i + 1)), copy); list.append(li);
      });
      card.append(list);
    }
    card.append(actions(link(n ? '브리핑 전체 읽기' : '고르지 않은 기사 보기', '#briefing', 'primary')));
    return;
  }
  if (!keywords.length) {
    const suggestions = node('div', 'suggest-list'); suggestions.setAttribute('role', 'group'); suggestions.setAttribute('aria-label', '추천 키워드');
    suggestions.append(...suggestionButtons(() => { renderDashboard(); $('dash-hero-title').focus(); }));
    card.replaceChildren(node('p', 'overline', '시작하기'), title('관심 키워드부터 정해 볼까요?'),
      node('p', 'lead', '관심 있는 주제를 알려 주시면 그 주제의 뉴스만 골라 요약해 드려요.'), suggestions,
      actions(link('키워드 직접 정하기', '#settings', 'secondary')));
    return;
  }
  card.replaceChildren(node('p', 'overline', '오늘의 브리핑'), title('오늘의 브리핑을 만들어 보세요'),
    node('p', 'lead', '언론사 뉴스 중 관심 키워드에 맞는 기사만 모아 요약해 드려요.'), chips(),
    actions(button('브리핑 만들기', 'primary', () => goToBriefing(generate)), link('키워드 바꾸기', '#settings', 'secondary')));
}
async function loadDashPrefs(card) {
  const id = state.settings.userId;
  if (!id) {
    card.append(node('p', 'empty-inline', '구독자 ID를 넣으면 좋아요·관심없음으로 쌓인 내 취향을 보여 드려요.'), link('구독자 ID 넣기', '#settings', 'inline-link'));
    return;
  }
  const status = node('p', 'empty-inline', '내 취향을 불러오고 있어요.'); status.setAttribute('role', 'status'); card.append(status);
  dashController = new AbortController();
  try {
    const data = checkMemory(await api.memory(id, dashController.signal));
    if (!card.isConnected) return;
    const top = Object.entries(data.topic_preferences).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || b[1] - a[1]).slice(0, 4);
    status.remove();
    if (!top.length) card.append(node('p', 'empty-inline', '아직 쌓인 취향이 없어요. 브리핑에서 좋아요·관심없음을 남겨 보세요.'));
    else {
      const changes = recentChanges(data.feedback_history).slice(0, 3);
      card.append(node('p', 'field-hint', `좋아요·관심없음 ${data.feedback_history.length}건이 반영됐어요.`), prefList(top));
      if (changes.length) card.append(node('p', 'trend-line', `최근 7일: ${changes.map(c => `${c.topic} ${signed(c.change)}`).join(', ')}`));
    }
    card.append(link('내 취향 전체 보기', '#memory', 'inline-link'));
  } catch (error) {
    if (error.name === 'AbortError' || !card.isConnected) return;
    status.className = 'field-error'; status.textContent = `내 취향을 불러오지 못했어요. ${error.message}`;
    card.append(button('다시 시도', 'secondary', () => { card.replaceChildren(card.firstChild); loadDashPrefs(card); }));
  }
}

// ---------- Settings & routing ----------

// Keywords save as they are edited; this form only stores the subscriber ID.
// A new ID never clears the current briefing, it just enables feedback on it.
function saveSettings(event) {
  event.preventDefault();
  $('user-id').removeAttribute('aria-invalid');
  const userId = $('user-id').value.trim();
  if (userId.length > 100 || /[\\/]/.test(userId)) {
    $('user-id').setAttribute('aria-invalid', 'true'); $('user-id').focus();
    message('settings-error', '구독자 ID는 100자 이하로 입력하고 슬래시(/, \\)는 빼 주세요.');
    return;
  }
  const previousUserId = state.settings.userId;
  const idChanged = previousUserId !== userId;
  if (idChanged) {
    keywordLoadGeneration++;
    keywordEditRevision++;
  }
  state.settings = {...state.settings,
    userId, keywords: idChanged ? [] : state.settings.keywords};
  const saved = saveToStorage();
  if (idChanged) {
    if (state.hasResult) {
      state.mode = 'real';
      resetResults();
    }
    renderKeywordTags();
    if (userId) loadServerKeywords();
  }
  renderResults(); updateView(); memoryPlaceholder(); message('settings-error');
  notify(!saved ? '이 브라우저에 저장할 수 없어 이번 탭에서만 적용했어요.' :
    userId ? '구독자 ID를 저장했어요. 이제 기사에 좋아요·관심없음을 남길 수 있어요.' : '구독자 ID를 지웠어요.', '#briefing', '브리핑으로 이동');
  $('notice').querySelector('a').focus();
}
function route(focus = true) {
  let name = location.hash.slice(1);
  const views = ['dashboard', 'briefing', 'evening', 'settings', 'memory'];
  if (!views.includes(name)) { name = 'dashboard'; history.replaceState(null, '', '#dashboard'); }
  memoryController?.abort(); dashController?.abort(); state.memoryGeneration++;
  $('memory-loading').hidden = true; message('memory-error'); message('notice');
  for (const view of views) $(`view-${view}`).hidden = view !== name;
  // The evening report sits under the same top tab as the morning briefing.
  const tab = name === 'evening' ? 'briefing' : name;
  document.querySelectorAll('[data-route]').forEach(a => { if (a.dataset.route === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-report]').forEach(a => { if (a.dataset.report === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (name === 'memory') { memoryPlaceholder(); loadMemory(); }
  if (name === 'dashboard') renderDashboard();
  document.title = `${{dashboard: '홈', briefing: '아침 브리핑', evening: '저녁 리포트', settings: '관심사 설정', memory: '내 취향'}[name]} · DayBrief`;
  if (focus) { $('main').focus(); window.scrollTo(0, 0); }
}
async function checkHealth() {
  const status = $('connection-status');
  $('check-health').disabled = true; status.textContent = '연결 확인 중'; status.dataset.state = 'checking';
  try {
    const data = await api.health();
    if (data.status !== 'ok') throw new Error();
    status.textContent = '연결됨'; status.dataset.state = 'ok';
    status.title = '서버 응답 확인 완료. AI 모델과 데이터베이스 연결은 각 기능 사용 시 확인해요.';
  } catch { status.textContent = '연결 안 됨'; status.dataset.state = 'error'; }
  finally { $('check-health').disabled = false; }
}

// ---------- Wiring ----------

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon]; });
document.querySelectorAll('.today').forEach(el => { el.textContent = dateLabel(new Date(), {year: 'numeric', weekday: 'long'}); });
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault(); $('main').focus(); $('main').scrollIntoView();
});
$('settings-form').addEventListener('submit', saveSettings);

const keywordInput = $('keyword-input');
keywordInput.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ',') && !event.isComposing) { event.preventDefault(); addKeywords(keywordInput.value); }
  else if (event.key === 'Backspace' && !keywordInput.value && state.settings.keywords.length) removeKeyword(state.settings.keywords.at(-1));
});
keywordInput.addEventListener('input', () => { if (/[,\n]/.test(keywordInput.value)) addKeywords(keywordInput.value); });
keywordInput.addEventListener('blur', () => addKeywords(keywordInput.value));
$('tag-input').addEventListener('click', event => { if (event.target === event.currentTarget) keywordInput.focus(); });

$('news-file').addEventListener('change', async event => { await importFile(event.target.files[0]); event.target.value = ''; });
const dropzone = $('dropzone');
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.dataset.dragging = 'true'; });
dropzone.addEventListener('dragleave', () => { delete dropzone.dataset.dragging; });
dropzone.addEventListener('drop', event => { event.preventDefault(); delete dropzone.dataset.dragging; importFile(event.dataTransfer.files[0]); });
$('import-json').addEventListener('click', () => importNews($('news-json').value, '붙여넣은 뉴스'));

$('generate').addEventListener('click', generate);
$('cancel-summary').addEventListener('click', () => {
  cancelSummary(); state.hasResult = Boolean(state.results.length || state.excluded.length);
  updateView(); renderResults(); saveSession();
  (state.hasResult ? $('results-title') : $('generate')).focus();
  notify('응답 대기를 중단했어요. 완료된 결과만 표시해요. 서버의 요약 작업은 계속될 수 있어요.');
});
$('new-briefing').addEventListener('click', () => { state.composerOpen = true; updateView(); $('briefing-title').setAttribute('tabindex', '-1'); $('briefing-title').focus(); });
$('back-to-results').addEventListener('click', () => { state.composerOpen = false; updateView(); $('results-title').focus(); });
$('show-demo').addEventListener('click', openDemo);
$('leave-demo').addEventListener('click', () => { state.mode = 'real'; resetResults(); updateView(); announce('예시를 닫았어요.'); $('show-demo').focus(); });
$('search').addEventListener('input', event => { state.query = event.target.value; renderNewsList(); });
$('sort').addEventListener('change', event => { state.sort = event.target.value; renderNewsList(); });
$('check-health').addEventListener('click', checkHealth);
$('refresh-memory').addEventListener('click', loadMemory);
$('clear-settings').addEventListener('click', () => {
  try { storage?.removeItem(STORAGE_KEY); } catch { message('settings-error', '기기 저장소에 접근할 수 없어 설정을 지우지 못했어요.'); return; }
  keywordLoadGeneration++; keywordEditRevision++;
  state.settings = {keywords: [], userId: ''}; state.mode = 'real'; resetResults(); renderKeywordTags(); updateView(); memoryPlaceholder(); message('settings-error');
  notify('이 기기의 키워드와 구독자 ID를 지웠어요. 서버에 저장된 내 취향은 그대로 남아 있어요.');
});
window.addEventListener('hashchange', () => route());
renderKeywordTags(); updateView(); renderResults(); route(false); checkHealth();
loadServerKeywords(true);
