import {createApi} from './api.mjs';
import {parseNews, parseKeywords, visibleNews, validateSummary, loadSettings, safeUrl, STORAGE_KEY, MAX_FILE_BYTES} from './domain.mjs';
import {demoBriefing} from './demo.mjs';

const $ = id => document.getElementById(id);
const api = createApi();
let storage;
try { storage = window.localStorage; } catch { /* Restricted browsers still work in memory. */ }
const state = {settings: loadSettings(storage), news: [], results: [], excluded: [], mode: 'real',
  hasResult: false, query: '', keyword: '', sort: 'importance', busy: false, generation: 0,
  feedback: new Map(), memoryGeneration: 0, sourceName: '', composerOpen: false};
let summaryController, memoryController;

// Static, trusted icon markup only. Never interpolate user or server text here.
const ICONS = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0L8 8m4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/></svg>',
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
  message('summary-error'); message('summary-error-compose'); renderResults();
}

// ---------- Composer ----------

function renderKeywordTags() {
  $('keyword-tags').replaceChildren(...state.settings.keywords.map(keyword => {
    const li = node('li', 'tag'); li.append(node('span', '', keyword));
    const remove = button('', 'tag-remove', () => { removeKeyword(keyword); $('keyword-input').focus(); });
    remove.setAttribute('aria-label', `${keyword} 키워드 삭제`); remove.append(icon('x'));
    li.append(remove); return li;
  }));
  $('keywords').value = state.settings.keywords.join(', ');
  $('user-id').value = state.settings.userId;
}
function setKeywords(keywords) {
  state.settings = {...state.settings, keywords};
  // A briefing made with the old keywords is stale; clear it as the settings page does.
  if (state.hasResult) resetResults();
  saveToStorage(); renderKeywordTags(); updateView();
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

  $('dropzone').hidden = hasNews;
  $('file-row').hidden = !hasNews;
  $('file-name').textContent = state.sourceName;
  $('file-count').textContent = `기사 ${state.news.length}건`;

  $('generate').disabled = state.busy || !hasKeywords || !hasNews;
  $('generate').textContent = hasNews ? `브리핑 만들기 · 기사 ${state.news.length}건` : '브리핑 만들기';
  $('generate-hint').textContent = !hasKeywords && !hasNews ? '관심 키워드와 뉴스 파일을 넣으면 시작할 수 있어요.' :
    !hasKeywords ? '관심 키워드를 하나 이상 추가하세요.' :
    !hasNews ? '뉴스 파일을 불러오세요.' :
    `5건씩 나눠 요약하며 AI API 사용량이 발생해요. ${state.settings.userId ? '저장된 선호도도 함께 참고해요.' : '사용자 ID가 없어 키워드로만 골라요.'}`;
}

async function generate() {
  if (state.busy || state.mode !== 'real' || !state.news.length || !state.settings.keywords.length) return;
  resetResults();
  state.busy = true;
  summaryController = new AbortController();
  const signal = summaryController.signal;
  const run = state.generation;
  const snapshot = {user_id: state.settings.userId || null, user_keywords: [...state.settings.keywords]};
  const batches = [];
  for (let i = 0; i < state.news.length; i += 5) batches.push(state.news.slice(i, i + 5));
  setProgress(0, batches.length);
  updateView(); $('cancel-summary').focus();
  $('results').setAttribute('aria-busy', 'true');
  let succeeded = 0;
  const failed = [];
  try {
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
      updateView(); renderResults(); renderDashBriefing();
      // The progress card disappears, so move focus to what replaced it.
      if (state.hasResult) $('results-title').focus(); else $('generate').focus();
    }
  }
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
  $('results-title').textContent = demo ? `예시 기사 ${state.results.length}건` : `선별한 기사 ${state.results.length}건`;
  $('results-meta').textContent = demo ? '저장소의 테스트 기사 · 2026년 10월 13일' :
    state.hasResult ? `${state.sourceName}의 ${state.news.length}건 중 ${state.results.length}건 · 키워드 ${state.settings.keywords.join(', ')}` : '';
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
  hint.hidden = !state.results.length || demo || Boolean(state.settings.userId);
  hint.append('피드백을 남기려면 ', link('관심사 설정', '#settings'), '에서 사용자 ID를 입력하세요.');

  renderNewsList();
  $('excluded').hidden = !state.excluded.length;
  $('excluded-label').textContent = `선정되지 않은 기사 ${state.excluded.length}건`;
  $('excluded-list').replaceChildren(...state.excluded.map(n => {
    const li = node('li'); li.append(node('strong', '', n.title), node('p', '', n.reason)); return li;
  }));
}
function renderNewsList() {
  const news = visibleNews(state.results, state.query, state.keyword, state.sort);
  $('news-list').replaceChildren(...news.map((n, i) => story(n, i)));
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
  reason.append(node('summary', '', 'AI 선정 이유'), node('p', '', news.selection_reason || '서버가 선정 이유를 제공하지 않았어요.'));

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
    state.feedback.set(requestKey, {type, pending: true, message: '저장하고 있어요.'}); update();
    // Disabled buttons drop focus; keep keyboard users at the result message.
    status.tabIndex = -1; status.focus();
    try {
      const data = await api.feedback({user_id: userId, news_id: news.id, topic: value, feedback_type: type});
      if (!Number.isInteger(data.preference_score) || data.preference_score < -5 || data.preference_score > 5) throw new Error('저장 결과를 확인하지 못했어요.');
      state.feedback.set(requestKey, {type, tone: 'success', message: `${value} 선호도 ${data.preference_score > 0 ? '+' : ''}${data.preference_score}로 반영했어요.`});
    } catch (error) {
      // The backend is cumulative and lacks idempotency. Do not offer a blind retry after an ambiguous failure.
      state.feedback.set(requestKey, {type, tone: 'error', message: `${error.message} 저장 여부는 피드백 기록에서 확인하세요. 중복 반영을 막으려고 다시 보내지 않아요.`});
    }
    update();
    if (!wrap.isConnected && state.mode === 'real' && state.settings.userId === userId) renderNewsList();
  };
  const like = button('', 'vote', () => send('like'));
  const dislike = button('', 'vote', () => send('dislike'));
  like.append(icon('up'), node('span', '', '좋아요')); dislike.append(icon('down'), node('span', '', '싫어요'));
  like.setAttribute('aria-label', `${news.title} 좋아요`); dislike.setAttribute('aria-label', `${news.title} 싫어요`);
  control?.addEventListener('change', update); control?.addEventListener('input', update);
  if (control) row.append(control);
  row.append(like, dislike); wrap.append(row, status); update(); return wrap;
}

// ---------- Memory ----------

function memoryPlaceholder() {
  const id = state.settings.userId;
  $('memory-user').textContent = id ? `사용자 ID ${id}의 주제별 선호도와 피드백 이력이에요.` : '피드백을 남기면 주제별 선호도로 저장돼 다음 뉴스 선정에 참고돼요.';
  $('refresh-memory').hidden = !id;
  const empty = node('div', 'card empty-card');
  if (id) empty.append(node('h2', '', '기록을 불러와 확인하세요'), node('p', '', '기록 불러오기를 누르면 서버에 저장된 실제 기록을 조회해요.'));
  else empty.append(node('h2', '', '사용자 ID가 필요해요'), node('p', '', '팀에서 발급받은 사용자 ID를 설정하면 기록을 볼 수 있어요.'), link('관심사 설정으로 이동', '#settings', 'secondary'));
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
function renderMemory(data) {
  const preferences = Object.entries(data.topic_preferences).sort((a, b) => b[1] - a[1]);
  const prefCard = node('section', 'card memory-card');
  const prefHead = node('div', 'card-head'); prefHead.append(node('h2', '', '주제별 선호도'), node('span', 'field-hint', '좋아요 +1 · 싫어요 −1 · 범위 −5~+5'));
  prefCard.append(prefHead);
  if (!preferences.length) prefCard.append(node('p', 'empty-inline', '아직 저장된 선호도가 없어요. 브리핑에서 첫 피드백을 남겨 보세요.'));
  const prefList = node('ul', 'pref-list');
  for (const [topic, score] of preferences) {
    const row = node('li', 'pref-row');
    row.append(node('strong', 'pref-topic', topic), preferenceBar(topic, score), node('span', `pref-score ${score < 0 ? 'negative' : ''}`, `${score > 0 ? '+' : ''}${score}`));
    prefList.append(row);
  }
  if (preferences.length) prefCard.append(prefList);

  const historyCard = node('section', 'card memory-card');
  const historyHead = node('div', 'card-head'); historyHead.append(node('h2', '', '피드백 이력'), node('span', 'field-hint', `${data.feedback_history.length}건`));
  historyCard.append(historyHead);
  if (!data.feedback_history.length) historyCard.append(node('p', 'empty-inline', '아직 남긴 피드백이 없어요.'));
  const list = node('ol', 'history-list');
  for (const item of data.feedback_history) {
    const li = node('li');
    const like = item.feedback_type === 'like';
    const badge = icon(like ? 'up' : 'down', `history-icon ${like ? 'like' : 'dislike'}`);
    const copy = node('div', 'history-copy');
    copy.append(node('strong', '', `${item.topic} · ${like ? '좋아요' : '싫어요'}`), node('p', '', `기사 ${item.news_id} · 반영 후 선호도 ${item.new_score > 0 ? '+' : ''}${item.new_score}`));
    li.append(badge, copy, node('time', 'history-time', dateLabel(item.created_at, {hour: '2-digit', minute: '2-digit'})));
    list.append(li);
  }
  if (data.feedback_history.length) historyCard.append(list);
  $('memory-content').replaceChildren(prefCard, historyCard);
}

// ---------- Dashboard ----------

let dashController;
function dashCard(title, id) {
  const card = node('section', 'card dash-card'); if (id) card.id = id;
  const head = node('div', 'card-head'); head.append(node('h2', '', title)); card.append(head);
  return card;
}
function stat(label, value, unit = '') {
  const tile = node('div', 'stat');
  const number = node('p', 'stat-value', String(value)); if (unit) number.append(node('span', 'stat-unit', unit));
  tile.append(node('p', 'stat-label', label), number);
  return tile;
}
function renderDashboard() {
  dashController?.abort();
  const card = dashCard('오늘의 브리핑', 'dash-briefing');
  const keywords = dashCard('키워드별 선별 기사');
  const prefs = dashCard('내 관심 주제', 'dash-prefs');
  const delivery = dashCard('이메일 브리핑');
  $('dashboard-content').replaceChildren(card, node('div', 'dash-grid'), delivery);
  $('dashboard-content').children[1].append(keywords, prefs);
  renderDashBriefing();

  // Keyword distribution from the current briefing (real results only, never the example).
  const results = state.mode === 'real' && state.hasResult ? state.results : [];
  const counts = state.settings.keywords.map(k => [k, results.filter(r => r.matched_keywords.includes(k)).length]).sort((a, b) => b[1] - a[1]);
  if (!state.settings.keywords.length) keywords.append(node('p', 'empty-inline', '관심 키워드를 추가하면 키워드별 기사 수를 보여 드려요.'), link('키워드 추가하기', '#briefing', 'inline-link'));
  else if (!results.length) keywords.append(node('p', 'empty-inline', `브리핑을 만들면 키워드 ${state.settings.keywords.length}개의 기사 수가 표시돼요.`));
  else {
    const max = Math.max(1, ...counts.map(c => c[1]));
    const list = node('ul', 'bar-list');
    for (const [keyword, count] of counts) {
      const li = node('li', 'bar-row');
      const track = node('span', 'bar-track'); track.setAttribute('aria-hidden', 'true');
      const fill = node('span', 'bar-fill'); fill.style.width = `${count / max * 100}%`; track.append(fill);
      li.append(node('span', 'bar-label', keyword), track, node('span', 'bar-value', `${count}건`));
      list.append(li);
    }
    keywords.append(list);
  }

  loadDashPrefs(prefs);

  // Fixed schedule from .github/workflows/daily-briefing.yml (cron 30 22 * * * UTC).
  const dl = node('dl', 'facts');
  for (const [term, desc] of [['발송 시간', '매일 오전 7:30 (한국 시간)'], ['받는 사람', '팀에서 관리하는 구독자 목록'], ['설정 변경', '구독 API가 연결되면 이곳에서 바꿀 수 있어요']]) {
    const row = node('div', 'fact'); row.append(node('dt', '', term), node('dd', '', desc)); dl.append(row);
  }
  delivery.append(dl);
}
function renderDashBriefing() {
  const card = $('dash-briefing'); if (!card) return;
  card.replaceChildren(card.firstChild);
  if (state.busy) {
    card.append(node('p', 'dash-status', '뉴스를 요약하고 있어요.'), node('p', 'field-hint', $('loading-progress').textContent), link('진행 상황 보기', '#briefing', 'secondary'));
    return;
  }
  if (state.mode === 'real' && state.hasResult) {
    const avg = state.results.length ? Math.round(state.results.reduce((s, r) => s + r.importance_score, 0) / state.results.length) : 0;
    const stats = node('div', 'stats');
    stats.append(stat('선별 기사', state.results.length, '건'), stat('제외 기사', state.excluded.length, '건'), stat('평균 중요도', state.results.length ? avg : '–', state.results.length ? '/100' : ''));
    card.append(node('p', 'field-hint', `${state.sourceName}의 기사 ${state.news.length}건을 요약했어요.`), stats);
    const top = [...state.results].sort((a, b) => b.importance_score - a.importance_score).slice(0, 3);
    if (top.length) {
      const list = node('ol', 'top-list');
      top.forEach((n, i) => {
        const li = node('li'); const copy = node('div', 'top-copy');
        copy.append(node('strong', '', n.title), node('span', '', `${n.source} · 중요도 ${n.importance_score}`));
        li.append(node('span', 'rank', String(i + 1)), copy); list.append(li);
      });
      card.append(node('h3', 'dash-sub', '중요도 상위 기사'), list);
    }
    card.append(link('전체 브리핑 보기', '#briefing', 'secondary'));
    return;
  }
  const hasKeywords = state.settings.keywords.length > 0, hasNews = state.news.length > 0;
  const checklist = node('ul', 'checklist');
  for (const [done, text] of [[hasKeywords, hasKeywords ? `관심 키워드 ${state.settings.keywords.length}개` : '관심 키워드 추가'], [hasNews, hasNews ? `뉴스 파일 ${state.news.length}건` : '뉴스 파일 불러오기']]) {
    const li = node('li', done ? 'done' : ''); li.append(node('span', 'check-mark', done ? '완료' : '필요'), node('span', '', text)); checklist.append(li);
  }
  card.append(node('p', 'dash-status', '아직 오늘 브리핑이 없어요.'), checklist, link(hasKeywords && hasNews ? '브리핑 만들기' : '브리핑 준비하기', '#briefing', 'primary'));
}
async function loadDashPrefs(card) {
  const id = state.settings.userId;
  if (!id) {
    card.append(node('p', 'empty-inline', '사용자 ID를 설정하면 피드백으로 쌓인 주제별 선호도를 보여 드려요.'), link('사용자 ID 설정하기', '#settings', 'inline-link'));
    return;
  }
  const status = node('p', 'empty-inline', '선호도를 불러오고 있어요.'); status.setAttribute('role', 'status'); card.append(status);
  dashController = new AbortController();
  try {
    const data = checkMemory(await api.memory(id, dashController.signal));
    if (!card.isConnected) return;
    const history = data.feedback_history;
    const likes = history.filter(h => h.feedback_type === 'like').length;
    const top = Object.entries(data.topic_preferences).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || b[1] - a[1]).slice(0, 4);
    status.remove();
    const stats = node('div', 'stats compact');
    stats.append(stat('피드백', history.length, '건'), stat('좋아요', likes, '건'), stat('싫어요', history.length - likes, '건'));
    card.append(stats);
    if (!top.length) card.append(node('p', 'empty-inline', '아직 저장된 선호도가 없어요. 브리핑에서 첫 피드백을 남겨 보세요.'));
    else {
      const list = node('ul', 'pref-list');
      for (const [topic, score] of top) {
        const row = node('li', 'pref-row');
        row.append(node('strong', 'pref-topic', topic), preferenceBar(topic, score), node('span', `pref-score ${score < 0 ? 'negative' : ''}`, `${score > 0 ? '+' : ''}${score}`));
        list.append(row);
      }
      card.append(list);
    }
    card.append(link('전체 기록 보기', '#memory', 'inline-link'));
  } catch (error) {
    if (error.name === 'AbortError' || !card.isConnected) return;
    status.className = 'field-error'; status.textContent = `선호도를 불러오지 못했어요. ${error.message}`;
    card.append(button('다시 시도', 'secondary', () => { card.replaceChildren(card.firstChild); loadDashPrefs(card); }));
  }
}

// ---------- Settings & routing ----------

function saveSettings(event) {
  event.preventDefault();
  $('keywords').removeAttribute('aria-invalid');
  $('user-id').removeAttribute('aria-invalid');
  try {
    let keywords;
    try { keywords = parseKeywords($('keywords').value); }
    catch (error) { $('keywords').setAttribute('aria-invalid', 'true'); $('keywords').focus(); throw error; }
    const userId = $('user-id').value.trim();
    if (userId.length > 100 || /[\\/]/.test(userId)) {
      $('user-id').setAttribute('aria-invalid', 'true'); $('user-id').focus();
      throw new Error('사용자 ID는 100자 이하로 입력하고 슬래시(/, \\)는 빼 주세요. 기록 조회 주소에 쓸 수 없어요.');
    }
    state.settings = {keywords, userId};
    const saved = saveToStorage();
    state.mode = 'real'; resetResults(); renderKeywordTags(); updateView(); memoryPlaceholder(); message('settings-error');
    notify(saved ? '이 브라우저에 저장했어요. 이메일 구독 설정에는 반영되지 않아요.' : '이 브라우저에 저장할 수 없어 이번 탭에서만 적용했어요.', '#briefing', '브리핑으로 이동');
    $('notice').querySelector('a').focus();
  } catch (error) { message('settings-error', error.message); }
}
function route(focus = true) {
  let name = location.hash.slice(1);
  if (!['dashboard', 'briefing', 'settings', 'memory'].includes(name)) { name = 'dashboard'; history.replaceState(null, '', '#dashboard'); }
  memoryController?.abort(); dashController?.abort(); state.memoryGeneration++;
  $('memory-loading').hidden = true; message('memory-error'); message('notice');
  for (const view of ['dashboard', 'briefing', 'settings', 'memory']) $(`view-${view}`).hidden = view !== name;
  document.querySelectorAll('[data-route]').forEach(a => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (name === 'memory') memoryPlaceholder();
  if (name === 'dashboard') renderDashboard();
  document.title = `${{dashboard: '대시보드', briefing: '나의 브리핑', settings: '관심사 설정', memory: '피드백 기록'}[name]} · DayBrief`;
  if (focus) { $('main').focus(); window.scrollTo(0, 0); }
}
async function checkHealth() {
  const status = $('connection-status');
  $('check-health').disabled = true; status.textContent = '연결 확인 중'; status.dataset.state = 'checking';
  try {
    const data = await api.health();
    if (data.status !== 'ok') throw new Error();
    status.textContent = 'API 연결됨'; status.dataset.state = 'ok';
    status.title = '서버 응답 확인 완료. AI 모델과 데이터베이스 연결은 각 기능 사용 시 확인해요.';
  } catch { status.textContent = 'API 연결 안 됨'; status.dataset.state = 'error'; }
  finally { $('check-health').disabled = false; }
}

// ---------- Wiring ----------

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon]; });
document.querySelectorAll('.today').forEach(el => { el.textContent = dateLabel(new Date(), {year: 'numeric', weekday: 'long'}); });
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault(); $('main').focus(); $('main').scrollIntoView();
});
$('keywords').setAttribute('aria-describedby', 'keywords-help settings-error');
$('user-id').setAttribute('aria-describedby', 'user-help settings-error');
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
  updateView(); renderResults();
  (state.hasResult ? $('results-title') : $('generate')).focus();
  notify('응답 대기를 중단했어요. 완료된 결과만 표시해요. 서버의 요약 작업은 계속될 수 있어요.');
});
$('new-briefing').addEventListener('click', () => { state.composerOpen = true; updateView(); $('briefing-title').setAttribute('tabindex', '-1'); $('briefing-title').focus(); });
$('back-to-results').addEventListener('click', () => { state.composerOpen = false; updateView(); $('results-title').focus(); });
$('show-demo').addEventListener('click', () => {
  resetResults(); state.mode = 'demo'; state.results = structuredClone(demoBriefing.results); state.excluded = structuredClone(demoBriefing.excluded_news); state.hasResult = true;
  updateView(); renderResults(); announce('예시 브리핑을 열었어요. 실제 API는 호출하지 않았어요.'); $('results-title').focus();
});
$('leave-demo').addEventListener('click', () => { state.mode = 'real'; resetResults(); updateView(); announce('예시를 닫았어요.'); $('show-demo').focus(); });
$('search').addEventListener('input', event => { state.query = event.target.value; renderNewsList(); });
$('sort').addEventListener('change', event => { state.sort = event.target.value; renderNewsList(); });
$('check-health').addEventListener('click', checkHealth);
$('refresh-memory').addEventListener('click', loadMemory);
$('clear-settings').addEventListener('click', () => {
  try { storage?.removeItem(STORAGE_KEY); } catch { message('settings-error', '기기 저장소에 접근할 수 없어 설정을 지우지 못했어요.'); return; }
  state.settings = {keywords: [], userId: ''}; state.mode = 'real'; resetResults(); renderKeywordTags(); updateView(); memoryPlaceholder(); message('settings-error');
  notify('이 기기의 키워드와 사용자 ID를 지웠어요. 서버의 피드백 기록은 그대로 남아 있어요.');
});
window.addEventListener('hashchange', () => route());
renderKeywordTags(); updateView(); renderResults(); route(false); checkHealth();
