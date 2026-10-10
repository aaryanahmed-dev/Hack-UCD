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

# Stripe (sandbox / test mode keys: sk_test_..., whsec_...). 1 coin = €0.01.
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
COIN_PACKS = [500, 1000, 2000, 5000]

# Persona ID verification (sandbox): https://app.withpersona.com → API keys / Inquiry templates
PERSONA_API_KEY = os.getenv("PERSONA_API_KEY", "")
PERSONA_TEMPLATE_ID = os.getenv("PERSONA_TEMPLATE_ID", "")  # itmpl_...
PERSONA_ENVIRONMENT_ID = os.getenv("PERSONA_ENVIRONMENT_ID", "")  # env_... (sandbox environment)

# Exported Expo web app, served at / so app + API share one origin (see app/frontend.py)
FRONTEND_DIST = os.getenv("FRONTEND_DIST", str(Path(__file__).resolve().parents[2] / "frontend" / "dist"))

# Realtime: a socket with no message (ping) for this long is closed (API_SPEC §8)
WS_HEARTBEAT_TIMEOUT_SECONDS = 45

# Study sessions (API_SPEC §7)
UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(Path(__file__).resolve().parents[1] / "uploads"))
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_MATERIALS_PER_SESSION = 10
EXTENSION_VOTE_SECONDS = 30
QUIZ_SECONDS_PER_QUESTION = 20
QUIZ_ANSWER_GRACE_SECONDS = 2
QUIZ_EXTRA_SECONDS = 120  # slack on top of questions × 20 s before the quiz hard-closes
REVIEW_SECONDS = 180
WINNER_BONUS_MULTIPLIER = 1.5  # winner bonus tokens = floor(focused minutes × this)
ENGINE_TICK_SECONDS = 1.0
SESSION_REMINDER_MINUTES = 15

# Public URL of this API (ngrok) — used for the Google OAuth callback
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

# Google Calendar (Google Cloud → APIs & Services → Credentials → OAuth client ID, type "Web application",
# redirect URI = PUBLIC_BASE_URL + /api/calendar/google/callback)
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
# Encrypts stored Google tokens and signs OAuth state. Generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")

# AI via OpenRouter (quiz generation + grading short answers)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
QUIZ_MODEL = os.getenv("QUIZ_MODEL", "google/gemma-4-31b-it:free")
GRADING_MODEL = os.getenv("GRADING_MODEL", "google/gemma-4-31b-it:free")
AI_TIMEOUT_SECONDS = 90
QUIZ_GENERATION_ATTEMPTS = 3
MAX_MATERIAL_CHARS_FOR_QUIZ = 120_000
