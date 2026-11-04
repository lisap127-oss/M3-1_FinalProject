"""Single-origin team demo hosting. No secrets are sent to browser JavaScript."""
import os
from pathlib import Path

from fastapi.responses import FileResponse, JSONResponse

ASSETS = {"/": "index.html", "/index.html": "index.html", "/styles.css": "styles.css",
          "/app.js": "app.js", "/api.mjs": "api.mjs", "/domain.mjs": "domain.mjs",
          "/demo.mjs": "demo.mjs"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://cdn.jsdelivr.net; "
       "font-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self'; "
       "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")


def validate_production_settings():
    if os.getenv("APP_ENV") != "production":
        return
    required = ("GROQ_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY")
    missing = [key for key in required if not os.getenv(key, "").strip()]
    if missing:
        raise RuntimeError("Missing production settings: " + ", ".join(missing))


def configure_deployment(app, frontend: Path):
    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = CSP
        return response

    @app.get("/ready", include_in_schema=False)
    def ready():
        # Probe table contracts without exposing customer records or key values.
        from main import get_supabase
        try:
            db = get_supabase()
            db.table("user_preferences").select("user_id,topic,score").limit(1).execute()
            db.table("feedback_history").select("user_id,news_id,previous_score,new_score").limit(1).execute()
        except Exception:
            return JSONResponse({"status": "not_ready", "database": "unavailable"}, status_code=503)
        return {"status": "ready", "database": "reachable"}

    def asset_endpoint(filename):
        def serve():
            media_type = "text/javascript" if filename.endswith((".js", ".mjs")) else None
            return FileResponse(frontend / filename, media_type=media_type)
        return serve

    for route, filename in ASSETS.items():
        app.add_api_route(route, asset_endpoint(filename), methods=["GET", "HEAD"], include_in_schema=False)
