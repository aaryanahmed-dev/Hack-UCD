import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
# Also allow any local dev server (localhost / 127.0.0.1 / private LAN IPs, any port), so Expo
# picking a different port doesn't break the web app. Set CORS_ORIGIN_REGEX= (empty) to disable.
CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"https?://(localhost|127\.0\.0\.1|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}"
    r"|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?",
) or None

# Supabase auth: tokens are verified with the project's JWKS (asymmetric keys).
# SUPABASE_JWT_SECRET is only needed for older projects that still sign with HS256.
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
SUPABASE_JWT_AUDIENCE = os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated")

SIGNUP_BONUS_TOKENS = 100

# Exported Expo web app, served at / so app + API share one origin (see app/frontend.py)
FRONTEND_DIST = os.getenv("FRONTEND_DIST", str(Path(__file__).resolve().parents[2] / "frontend" / "dist"))

# Realtime: a socket with no message (ping) for this long is closed (API_SPEC §8)
WS_HEARTBEAT_TIMEOUT_SECONDS = 45
