// Explicitly synthetic UI fixture, based on data/test_news.json. Never sent to the API.
export const demoBriefing = {
  results: [
    {id: 'demo-001', title: '국내 기업, 생성형 AI 개발 도구 공개', summary: '코드 작성과 오류 탐지를 지원하는 생성형 AI 개발 도구가 공개됐습니다. 개발자의 반복 작업을 줄이는 것이 목표입니다.', source: '테스트 뉴스', published_at: '2026-10-13T09:00:00+09:00', url: '', matched_keywords: ['AI'], importance_score: 85, selection_reason: '관심 키워드 AI와 직접 관련된 개발 도구 소식입니다. 점수와 선정 이유는 화면 확인용 예시입니다.'},
    {id: 'demo-002', title: '초기 스타트업 투자 시장 동향', summary: '초기 스타트업의 투자 유치 환경을 분석한 보고서가 발표됐습니다. 산업별 투자 규모와 관심 분야의 변화를 다룹니다.', source: '테스트 뉴스', published_at: '2026-10-13T08:30:00+09:00', url: '', matched_keywords: ['스타트업'], importance_score: 78, selection_reason: '스타트업 투자 환경을 이해하는 데 도움이 되는 기사 예시입니다.'},
    {id: 'demo-003', title: '개발자 채용에서 실무 프로젝트 경험 강조', summary: '일부 기업은 개발자 채용에서 실무 프로젝트 경험과 협업 역량을 요구하고 있습니다. 지원자는 프로젝트 결과와 함께 기술 역량을 제시할 수 있습니다.', source: '테스트 뉴스', published_at: '2026-10-13T08:00:00+09:00', url: '', matched_keywords: ['개발자 채용'], importance_score: 72, selection_reason: '채용을 준비하는 독자가 참고할 수 있는 기사 예시입니다.'},
  ],
  excluded_news: [{id: 'demo-004', title: '주말 지역 축제 방문객 증가', reason: '예시 관심 키워드와 관련성이 낮은 기사입니다.'}],
};
