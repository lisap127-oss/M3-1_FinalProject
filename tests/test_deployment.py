from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
import main
from deployment import validate_production_settings
from pipelines.daily_briefing import summarize_in_batches


@pytest.fixture(autouse=True)
def local_environment(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'development')


def test_static_assets_same_origin_and_no_source_exposure():
    with TestClient(main.app) as client:
        for path in ('/', '/styles.css', '/app.js', '/api.mjs'):
            response = client.get(path)
            assert response.status_code == 200
            assert response.headers['x-content-type-options'] == 'nosniff'
        assert '브리핑' in client.get('/').text
        for path in ('/.env', '/main.py', '/api/missing', '/frontend/server.py'):
            assert client.get(path).status_code == 404


def test_production_demo_is_public_without_login(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    for key in ('GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'):
        monkeypatch.setenv(key, 'placeholder')
    with TestClient(main.app) as client:
        for path in ('/health', '/', '/docs', '/openapi.json'):
            assert client.get(path).status_code == 200
        assert client.post('/api/feedback', json={}).status_code == 422
        assert client.get('/').headers['x-content-type-options'] == 'nosniff'


def test_production_requires_server_secrets(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    for key in ('GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'):
        monkeypatch.setenv(key, 'placeholder')
    monkeypatch.delenv('SUPABASE_SECRET_KEY')
    with pytest.raises(RuntimeError, match='SUPABASE_SECRET_KEY'):
        validate_production_settings()
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'placeholder')
    validate_production_settings()


def test_feedback_uses_atomic_rpc_and_get_does_not_write():
    db = Mock()
    db.rpc.return_value.execute.return_value = SimpleNamespace(data={
        'user_id': 'u1', 'topic': 'AI', 'previous_score': 0, 'preference_score': 1,
        'duplicate': False})
    with patch.object(main, 'supabase', db), TestClient(main.app) as client:
        response = client.post('/api/feedback', json={
            'user_id': 'u1', 'news_id': 'n1', 'topic': ' AI ', 'feedback_type': 'like'})
        assert response.status_code == 200
        assert response.json()['preference_score'] == 1
        db.rpc.assert_called_once_with('record_feedback', {
            'p_user_id': 'u1', 'p_news_id': 'n1', 'p_topic': 'AI', 'p_feedback_type': 'like'})
        db.table.assert_not_called()
        assert client.get('/api/feedback/link?user_id=u1&news_id=n1&topic=AI&type=like').status_code == 405
        assert db.rpc.call_count == 1


def test_feedback_db_failure_returns_controlled_error():
    db = Mock()
    db.rpc.side_effect = RuntimeError('database unavailable')
    with patch.object(main, 'supabase', db), TestClient(main.app) as client:
        response = client.post('/api/feedback', json={
            'user_id': 'u1', 'news_id': 'n1', 'topic': 'AI', 'feedback_type': 'like'})
        assert response.status_code == 500
        assert 'database unavailable' not in response.text


def test_readiness_reports_missing_db():
    with patch.object(main, 'supabase', None), TestClient(main.app) as client:
        assert client.get('/health').status_code == 200
        assert client.get('/ready').status_code == 503


@pytest.mark.parametrize('status', [401, 403, 429, 500, 503])
def test_configuration_errors_do_not_split_and_retry(status):
    error = httpx.HTTPStatusError('error', request=httpx.Request('POST', 'https://example.com'),
                                 response=httpx.Response(status))
    with patch('pipelines.daily_briefing.request_summary', side_effect=error) as call:
        with pytest.raises(httpx.HTTPStatusError):
            summarize_in_batches('u1', ['AI'], [{'id': str(i)} for i in range(5)])
        assert call.call_count == 1


def test_502_still_splits_batch():
    def summarize(user, keywords, news):
        if len(news) > 1:
            raise httpx.HTTPStatusError('error', request=httpx.Request('POST', 'https://example.com'),
                                        response=httpx.Response(502))
        return {'results': news, 'excluded_news': []}
    with patch('pipelines.daily_briefing.request_summary', side_effect=summarize):
        assert len(summarize_in_batches('u', ['AI'], [{'id': '1'}, {'id': '2'}])['results']) == 2
