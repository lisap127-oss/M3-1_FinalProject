from fastapi.testclient import TestClient
import main

client = TestClient(main.app)


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self):
        self.records = {}
        self.current_id = None
        self.payload = None

    def select(self, *args):
        return self

    def eq(self, key, value):
        self.current_id = value
        return self

    def limit(self, count):
        return self

    def upsert(self, payload, **kwargs):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            self.records[self.payload["user_id"]] = self.payload["keywords"]
            result = [self.payload]
            self.payload = None
            return FakeResponse(result)

        if self.current_id in self.records:
            return FakeResponse([
                {"keywords": self.records[self.current_id]}
            ])

        return FakeResponse([])


class FakeSupabase:
    def __init__(self):
        self.fake_table = FakeTable()

    def table(self, name):
        assert name == "user_keyword_settings"
        return self.fake_table


def test_keyword_save_and_load(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(main, "get_supabase", lambda: fake)

    saved = client.put(
        "/api/keywords/test-user",
        json={"keywords": ["AI", "반도체"]}
    )
    assert saved.status_code == 200

    loaded = client.get("/api/keywords/test-user")
    assert loaded.status_code == 200
    assert loaded.json()["keywords"] == ["AI", "반도체"]
    assert loaded.json()["exists"] is True


def test_keyword_not_found(monkeypatch):
    monkeypatch.setattr(
        main, "get_supabase", lambda: FakeSupabase()
    )

    response = client.get("/api/keywords/new-user")
    assert response.status_code == 200
    assert response.json()["keywords"] == []
    assert response.json()["exists"] is False


def test_duplicate_keywords_rejected():
    response = client.put(
        "/api/keywords/test-user",
        json={"keywords": ["AI", "AI"]}
    )
    assert response.status_code == 422


def test_empty_keyword_rejected():
    response = client.put(
        "/api/keywords/test-user",
        json={"keywords": [""]}
    )
    assert response.status_code == 422


def test_too_many_keywords_rejected():
    response = client.put(
        "/api/keywords/test-user",
        json={"keywords": [f"keyword-{i}" for i in range(21)]}
    )
    assert response.status_code == 422


def test_keyword_update(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(main, "get_supabase", lambda: fake)

    client.put(
        "/api/keywords/test-user",
        json={"keywords": ["AI"]}
    )

    updated = client.put(
        "/api/keywords/test-user",
        json={"keywords": ["경제"]}
    )

    assert updated.status_code == 200

    loaded = client.get("/api/keywords/test-user")
    assert loaded.json()["keywords"] == ["경제"]
