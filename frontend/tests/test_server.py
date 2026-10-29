"""Local HTTP integration tests. No API keys, external network or email delivery."""
import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location("frontend_server", Path(__file__).resolve().parents[1] / "server.py")
frontend_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend_server)


class FakeBackend(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.requests.append(("GET", self.path, None))
        payload = {"status": "ok"} if self.path == "/health" else {"detail": "Supabase missing"}
        self.send_response(200 if self.path == "/health" else 500)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.requests.append(("POST", self.path, body))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"echo": body}).encode())


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
        cls.frontend = frontend_server.make_server(0, "http://127.0.0.1:%s" % cls.backend.server_port)
        for server in (cls.backend, cls.frontend):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%s" % cls.frontend.server_port

    @classmethod
    def tearDownClass(cls):
        for server in (cls.frontend, cls.backend):
            server.shutdown()
            server.server_close()

    def get(self, path):
        return urlopen(self.base + path, timeout=5)

    def test_static_and_module_mime(self):
        with self.get("/") as response:
            self.assertIn(b"DayBrief", response.read())
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        with self.get("/api.mjs") as response:
            self.assertIn("javascript", response.headers["Content-Type"])

    def test_private_files_and_unknown_routes_are_not_exposed(self):
        for path in ("/.env", "/server.py", "/../main.py", "/api/subscribe", "/api/feedback/link"):
            with self.assertRaises(HTTPError) as ctx:
                self.get(path)
            self.assertEqual(ctx.exception.code, 404)

    def test_proxy_preserves_payload_and_status(self):
        with self.get("/health") as response:
            self.assertEqual(json.load(response), {"status": "ok"})
        body = {"user_id": None, "user_keywords": ["AI"], "news": []}
        request = Request(self.base + "/api/summarize", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=5) as response:
            self.assertEqual(json.load(response)["echo"], body)
        with self.assertRaises(HTTPError) as ctx:
            self.get("/api/memory/test-user")
        self.assertEqual(ctx.exception.code, 500)
        self.assertEqual(json.load(ctx.exception)["detail"], "Supabase missing")

    def test_cross_origin_mutation_is_rejected(self):
        request = Request(self.base + "/api/feedback", data=b"{}", headers={"Content-Type": "application/json", "Origin": "https://untrusted.example"})
        with self.assertRaises(HTTPError) as ctx:
            urlopen(request, timeout=5)
        self.assertEqual(ctx.exception.code, 403)

    def test_unavailable_backend_returns_json_error(self):
        unavailable = frontend_server.make_server(0, "http://127.0.0.1:1")
        thread = threading.Thread(target=unavailable.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(HTTPError) as ctx:
                urlopen("http://127.0.0.1:%s/health" % unavailable.server_port, timeout=5)
            self.assertEqual(ctx.exception.code, 502)
            self.assertIn("detail", json.load(ctx.exception))
        finally:
            unavailable.shutdown()
            unavailable.server_close()


if __name__ == "__main__":
    unittest.main()
