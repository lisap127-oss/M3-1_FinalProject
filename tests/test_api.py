
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

import main

import agents.news_summary_agent as summary_agent



client = TestClient(main.app)


def test_health_check():
    """서버 상태 확인 API가 정상 작동하는지 검사"""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_empty_news():
    """뉴스가 없을 때 빈 결과를 반환하는지 검사"""
    response = client.post(
        "/api/summarize",
        json={
            "user_keywords": ["AI"],
            "news": [],
        },
    )

    assert response.status_code == 200

    data = response.json()
    assert data["results"] == []
    assert data["excluded_news"] == []


def test_invalid_request():
    """필수 뉴스 정보가 누락되면 422를 반환하는지 검사"""
    response = client.post(
        "/api/summarize",
        json={
            "user_keywords": ["AI"],
            "news": [
                {
                    "id": "news-001"
                }
            ],
        },
    )

    assert response.status_code == 422


def test_summarize_news():
    """가짜 AI 응답을 이용해 뉴스 요약 API를 검사"""
    fake_result = {
        "briefing_date": "2026-10-13",
        "results": [
            {
                "id": "news-001",
                "title": "AI 개발 도구 공개",
                "summary": "AI 개발 도구가 공개됐다.",
                "source": "테스트 뉴스",
                "url": "https://example.com/news-001",
                "published_at": "2026-10-13T09:00:00+09:00",
                "matched_keywords": ["AI"],
                "importance_score": 80,
                "selection_reason": "사용자 키워드와 관련성이 높음",
            }
        ],
        "excluded_news": [],
    }

    
    with patch.object(summary_agent, "client") as mock_client:

        mock_client.chat.completions.create.return_value.choices[
            0
        ].message.content = json.dumps(
            fake_result,
            ensure_ascii=False,
        )

        response = client.post(
            "/api/summarize",
            json={
                "user_keywords": ["AI"],
                "news": [
                    {
                        "id": "news-001",
                        "title": "AI 개발 도구 공개",
                        "summary": "AI 개발 도구가 공개됐다.",
                        "source": "테스트 뉴스",
                        "url": "https://example.com/news-001",
                        "published_at": "2026-10-13T09:00:00+09:00",
                    }
                ],
            },
        )

    assert response.status_code == 200

    data = response.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["id"] == "news-001"
    assert data["results"][0]["importance_score"] == 80
    assert data["excluded_news"] == []


def test_summarize_passes_user_preferences():
    """사용자의 장기 기억이 요약 Agent 입력에 전달되는지 확인한다."""
    from unittest.mock import patch

    import main

    user_id = "memory-test-user"
    main.user_preferences[user_id] = {"AI": 3, "스타트업": -1}

    fake_result = {
        "briefing_date": "2026-10-15",
        "results": [],
        "excluded_news": [],
    }

    request_data = {
        "user_id": user_id,
        "user_keywords": ["AI"],
        "news": [
            {
                "id": "news-test-001",
                "title": "AI 뉴스",
                "summary": "AI 관련 테스트 뉴스입니다.",
                "source": "테스트 출처",
                "url": "https://example.com/news-test-001",
                "published_at": "2026-10-15T09:00:00+09:00",
            }
        ],
    }

    with patch("main.generate_summary", return_value=fake_result) as mock_agent:
        response = main.summarize_news(main.SummarizeRequest(**request_data))

    assert response == fake_result

    agent_input = mock_agent.call_args.args[0]
    assert agent_input["topic_preferences"] == {
        "AI": 3,
        "스타트업": -1,
    }

    # 테스트 데이터가 다른 테스트에 영향을 주지 않도록 정리
    main.user_preferences.pop(user_id, None)
