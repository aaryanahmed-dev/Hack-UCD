# Backend

FastAPI app. The API contract (endpoints, JSON conventions, session lifecycle, realtime) is in [`../API_SPEC.md`](../API_SPEC.md).

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements-dev.txt
cp .env.example .env
```

## Run

```bash
fastapi dev app/main.py
```

API at http://localhost:8000, interactive docs at http://localhost:8000/docs.
`GET /health/db` checks the MySQL connection.

## Database (MySQL + Alembic)

Needs a local MySQL 8 with a `hackathondb` database; set `DATABASE_URL` in `.env`.

- Models go in `app/models/` (subclass `app.db.Base`) and must be imported in `app/models/__init__.py`.
- Routes get a session with `db: Session = Depends(get_db)`.
- After changing models:

```bash
alembic revision --autogenerate -m "describe change"   # review the file in alembic/versions/
alembic upgrade head
```

Teammates run `alembic upgrade head` after pulling.

## Tests

```bash
python -m pytest
```

Tests use an in-memory SQLite database and locally signed tokens — no MySQL or Supabase needed.

## Share it (ngrok)

With the server running, in a second terminal:

```bash
ngrok http 127.0.0.1:8000 --url https://unthumped-minda-unilluminant.ngrok-free.dev
```

Public URL: https://unthumped-minda-unilluminant.ngrok-free.dev (docs at `/docs`).
Requests from code should send the header `ngrok-skip-browser-warning: 1` to skip ngrok's interstitial page.
