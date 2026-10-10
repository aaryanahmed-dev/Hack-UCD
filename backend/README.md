# Backend

FastAPI app.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
cp .env.example .env
```

## Run

```bash
fastapi dev app/main.py
```

API at http://localhost:8000, interactive docs at http://localhost:8000/docs.

## Share it (ngrok)

With the server running, in a second terminal:

```bash
ngrok http 127.0.0.1:8000 --url https://unthumped-minda-unilluminant.ngrok-free.dev
```

Public URL: https://unthumped-minda-unilluminant.ngrok-free.dev (docs at `/docs`).
Requests from code should send the header `ngrok-skip-browser-warning: 1` to skip ngrok's interstitial page.
