# Frontend

Expo (React Native + web) app. The API contract is in [`../API_SPEC.md`](../API_SPEC.md).

## Setup

```bash
npm install
cp .env.example .env   # then fill in EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

## Develop (hot reload)

```bash
npm run web            # http://localhost:8081 — talks to the API at EXPO_PUBLIC_API_URL (localhost:8000)
```

For a phone with Expo Go (`npx expo start`), set `EXPO_PUBLIC_API_URL` to the ngrok URL.

## Share it on one URL (ngrok)

The backend serves the exported web app, so the app and the API share one origin:

```bash
npm run build:web      # exports to dist/ (uses .env.production: API = same origin)
# backend running on :8000, then:
ngrok http 127.0.0.1:8000 --url https://unthumped-minda-unilluminant.ngrok-free.dev
```

Open https://unthumped-minda-unilluminant.ngrok-free.dev. Re-run `npm run build:web` after frontend changes
(no restart of the backend needed).

## Checks

```bash
npm run typecheck
npm run lint
```
