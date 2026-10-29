"""Local static frontend + same-origin proxy for the existing DayBrief API.

No backend imports, new API contracts, database access, or third-party packages.
Run: python frontend/server.py --backend http://127.0.0.1:8000
"""

import argparse
import json
import mimetypes
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
ASSETS = {"/": "index.html", "/index.html": "index.html", "/styles.css": "styles.css",
          "/app.js": "app.js", "/api.mjs": "api.mjs", "/domain.mjs": "domain.mjs", "/demo.mjs": "demo.mjs"}
MAX_BODY = 2 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class FrontendHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Avoid logging user IDs embedded in /api/memory paths.
        pass

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Browser cancelled a long-running summary request.

    def error(self, status, detail):
        self.respond(status, json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        # Local-only development server: reject unexpected Host/Origin values.
        allowed_hosts = {"127.0.0.1", "localhost", "[::1]"}
        port = self.server.server_address[1]
        expected = {"%s:%s" % (host, port) for host in allowed_hosts}
        if self.headers.get("Host") not in expected:
            self.error(403, "이 개발 서버는 로컬 주소로만 접근할 수 있습니다.")
            return
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + host for host in expected}:
            self.error(403, "다른 출처의 요청은 허용하지 않습니다.")
            return
        path = urlsplit(self.path).path
        if path in ASSETS and self.command in {"GET", "HEAD"}:
            file = ROOT / ASSETS[path]
            content_type = "text/javascript" if file.suffix in {".js", ".mjs"} else mimetypes.guess_type(str(file))[0]
            self.respond(200, file.read_bytes(), (content_type or "text/plain") + "; charset=utf-8")
            return
        allowed = (path == "/health" or re.fullmatch(r"/api/memory/[^/]+", path)) if self.command == "GET" else self.command == "POST" and path in {"/api/summarize", "/api/feedback"}
        if not allowed:
            self.error(404, "지원하지 않는 경로입니다.")
            return
        body = None
        if self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.error(400, "요청 크기가 올바르지 않습니다.")
                return
            if length <= 0 or length > MAX_BODY:
                self.error(413, "요청은 2MB 이하의 JSON이어야 합니다.")
                return
            if self.headers.get_content_type() != "application/json":
                self.error(415, "JSON 요청만 지원합니다.")
                return
            body = self.rfile.read(length)
        request = Request(self.server.backend + path, data=body, method=self.command,
                          headers={"Content-Type": "application/json", "Accept": "application/json"})
        try:
            with build_opener(NoRedirect).open(request, timeout=180) as response:
                self.respond(response.status, response.read(), response.headers.get("Content-Type", "application/json"))
        except HTTPError as exc:
            self.respond(exc.code, exc.read(), exc.headers.get("Content-Type", "application/json"))
        except (URLError, OSError, TimeoutError):
            self.error(502, "백엔드에 연결하지 못했습니다. API 서버 실행 상태와 --backend 주소를 확인하세요.")


def make_server(port=3000, backend="http://127.0.0.1:8000"):
    parsed = urlsplit(backend)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("백엔드 주소는 http(s)://host:port 형식이어야 합니다.")
    server = ThreadingHTTPServer(("127.0.0.1", port), FrontendHandler)
    server.backend = backend.rstrip("/")
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DayBrief local frontend")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--backend", default=os.environ.get("DAYBRIEF_API_URL", "http://127.0.0.1:8000"))
    args = parser.parse_args()
    server = make_server(args.port, args.backend)
    print("DayBrief frontend: http://127.0.0.1:%s" % server.server_address[1], flush=True)
    print("API proxy: %s (local development only)" % server.backend, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
