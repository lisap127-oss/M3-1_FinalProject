
import json
from unittest.mock import MagicMock, patch

import pytest

import agents.news_summary_agent as agent


def mock_response(content):
    """Groq API 응답을 흉내 내는 가짜 객체를 만든다."""
    response = MagicMock()
    response.choices[0].message.content = content
    return response


def test_valid_json_response():
    """정상적인 JSON 응답을 처리하는지 확인한다."""
    expected = {
        "results": [],
        "excluded_news": [],
    }

    with patch.object(agent, "client") as mock_client:
        mock_client.chat.completions.create.return_value = (
            mock_response(json.dumps(expected))
        )

        result = agent.generate_summary({"user_id": "test_user", "user_keywords": [], "news": [{"id": "test"}]})

    assert result == expected


def test_empty_response():
    """모델 응답이 비어 있으면 오류가 발생해야 한다."""
    with patch.object(agent, "client") as mock_client:
        mock_client.chat.completions.create.return_value = (
            mock_response(None)
        )

        with pytest.raises(ValueError, match="비어"):
            agent.generate_summary({"user_keywords": [], "news": []})


def test_invalid_json_response():
    """JSON 형식이 잘못되면 파싱 오류가 발생해야 한다."""
    with patch.object(agent, "client") as mock_client:
        mock_client.chat.completions.create.return_value = (
            mock_response("{잘못된 JSON}")
        )

        with pytest.raises(json.JSONDecodeError):
            agent.generate_summary({"user_keywords": [], "news": []})


def test_invalid_response_structure():
    """필수 결과 목록이 없으면 구조 오류가 발생해야 한다."""
    invalid_result = {"results": []}

    with patch.object(agent, "client") as mock_client:
        mock_client.chat.completions.create.return_value = (
            mock_response(json.dumps(invalid_result))
        )

        with pytest.raises(ValueError, match="구조"):
            agent.generate_summary({"user_keywords": [], "news": []})


def test_missing_api_key():
    """API 클라이언트가 없으면 환경 변수 오류가 발생해야 한다."""
    with patch.object(agent, "client", None):
        with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
            agent.generate_summary({"user_keywords": [], "news": []})
