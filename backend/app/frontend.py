"""Serve the exported Expo web app (frontend/dist) from the API's own origin.

One URL (e.g. the ngrok domain) then serves both the app and /api + /ws, so the browser
talks to the backend directly with no CORS. Build it with `npm run build:web` in frontend/.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from app import config
from app.errors import not_found

# Paths that belong to the API and must never fall back to the web app.
_API_PREFIXES = ("api/", "ws/", "health", "docs", "redoc", "openapi.json")


def mount_frontend(app: FastAPI) -> None:
    dist = Path(config.FRONTEND_DIST).resolve()
    index = dist / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str):
        if path.startswith(_API_PREFIXES):
            raise not_found("Page")
        if not index.is_file():
            if path == "":
                return {"message": "Study Stakes API (web app not built: run `npm run build:web` in frontend/)"}
            raise not_found("Page")
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            # Hashed bundles never change, so they can be cached for good.
            immutable = "/_expo/static/" in candidate.as_posix() or "/assets/" in candidate.as_posix()
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if immutable else None
            return FileResponse(candidate, headers=headers)
        # Client-side routes (/sign-in, /onboarding, …) are all handled by the single-page app.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
