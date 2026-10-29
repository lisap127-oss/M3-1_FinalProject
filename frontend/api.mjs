export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export function createApi(fetcher = (...args) => fetch(...args)) {
  async function request(path, {method = 'GET', body, signal, timeout = 190000} = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
    try {
      const response = await fetcher(path, {method, signal: controller.signal, cache: 'no-store',
        headers: body ? {'Content-Type': 'application/json'} : {},
        ...(body ? {body: JSON.stringify(body)} : {})});
      let data;
      try { data = await response.json(); } catch { throw new ApiError('서버가 JSON 응답을 반환하지 않았습니다.', response.status); }
      if (!response.ok) {
        const detail = typeof data.detail === 'string' ? data.detail :
          response.status === 422 ? '입력 정보가 서버 형식과 맞지 않습니다. 뉴스 파일과 사용자 정보를 확인해 주세요.' : '요청을 처리하지 못했습니다.';
        throw new ApiError(`${detail} (HTTP ${response.status})`, response.status);
      }
      return data;
    } catch (error) {
      if (timedOut) throw new ApiError('응답 대기 시간이 지났습니다. 서버 처리는 계속될 수 있어요.');
      if (signal?.aborted) throw new DOMException('요청을 중단했습니다.', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError('API 서버에 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    health: () => request('/health', {timeout: 5000}),
    summarize: (body, signal) => request('/api/summarize', {method: 'POST', body, signal}),
    feedback: body => request('/api/feedback', {method: 'POST', body, timeout: 20000}),
    memory: (id, signal) => request(`/api/memory/${encodeURIComponent(id)}`, {signal, timeout: 20000}),
  };
}
