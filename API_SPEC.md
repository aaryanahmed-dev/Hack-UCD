# Study Stakes — Backend API Spec

The single source of truth for how the FastAPI backend behaves and how the React Native (Expo) frontend talks to it.
Frontend code must follow this contract exactly; backend code must implement it exactly. If something needs to change, change this file first.

> **Status:** planned. Implemented so far: `GET /health`, `GET /health/db`, MySQL connection, Alembic. Everything else below is the target design.

---

## 1. Product summary

Friends create a **study room**, agree on study material (uploaded files), study together while the app tracks focus, then take an **AI-generated quiz** on the material. Each member puts up a **stake** (points, or real-money coins for over-18s). Members who fail the agreed threshold lose their stake to the winners (or to charity). Everyone builds a profile with points, stats, a to-do list, a calendar and a friends leaderboard.

## 2. Architecture

```
Expo app ──(Supabase JS)──► Supabase Auth          (sign up / log in only)
    │
    └──(HTTPS + WebSocket, Bearer token)──► FastAPI ──► MySQL (all app data)
                                               ├──► local disk  (uploaded study files)
                                               ├──► Gemini      (generate quiz questions)
                                               ├──► OpenRouter  (grade free-text answers)
                                               └──► Stripe      (buy coins, test mode)
```

- **Supabase is used for authentication only.** No Supabase database, storage or realtime.
- **The API owns everything else.** The frontend never talks to MySQL, Gemini, OpenRouter or Stripe directly (except opening a Stripe Checkout URL the API returns).
- One backend process (one Uvicorn worker) — realtime connections are kept in memory.

## 3. Global conventions

### 3.1 Base URLs

| Environment | Base URL |
|---|---|
| Local | `http://localhost:8000` |
| Shared (ngrok) | `https://unthumped-minda-unilluminant.ngrok-free.dev` |

- All application endpoints are under **`/api`** (e.g. `GET /api/me`). Health checks live at `/health`, `/health/db`.
- WebSockets are under **`/ws`** (`ws://` locally, `wss://` via ngrok).
- Interactive docs: `GET /docs`. The OpenAPI schema at `/openapi.json` can be used to generate TS types.

### 3.2 Required headers (every request)

| Header | Value |
|---|---|
| `Authorization` | `Bearer <supabase access_token>` — required on everything except `/health*`, `/api/webhooks/*`, `/api/charities` |
| `ngrok-skip-browser-warning` | `1` — always send it; otherwise ngrok returns an HTML warning page instead of JSON |
| `Content-Type` | `application/json` (except file uploads: `multipart/form-data`) |

### 3.3 JSON format

- **camelCase** keys in all request and response bodies (`displayName`, `studyEndsAt`). Query parameters are camelCase too.
- **IDs** are UUID strings (`"3f1c…"`). User IDs are the Supabase user ID.
- **Timestamps** are ISO 8601 in UTC with a `Z` suffix: `"2026-10-10T14:03:00Z"`. Dates without time (date of birth) are `"YYYY-MM-DD"`. The frontend converts to local time for display.
- **Amounts** are integers. `points` and `coins` are both whole numbers; **1 coin = €0.01**. Never floats.
- **Percentages** are integers `0–100`.
- **Enums** are lowercase snake_case strings (see §11).
- `null` means "not set"; optional fields are always present in responses (as `null`), never omitted.
- `PATCH` bodies are partial: send only the fields being changed.

### 3.4 Lists and pagination

- Every list response is wrapped: `{ "items": [...] }`.
- Paginated lists (marked **[paged]**) add a cursor:
  - Request: `?limit=20&cursor=<opaque string>` (`limit` default 20, max 100).
  - Response: `{ "items": [...], "nextCursor": "abc" | null }`. `null` = no more pages.

### 3.5 Errors

All errors (including validation) use one shape:

```json
{
  "error": {
    "code": "insufficient_balance",
    "message": "You need 500 coins to join this room.",
    "details": null
  }
}
```

- `code` — stable machine-readable string; the frontend switches on this.
- `message` — human-readable, safe to show to the user.
- `details` — optional extra data. For `validation_error` it is a list: `[{ "field": "stakeAmount", "message": "must be ≥ 0" }]`.

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed request not covered below |
| 401 | `unauthenticated` | Missing/invalid/expired token → frontend refreshes session or signs out |
| 403 | `forbidden` | Authenticated but not allowed (e.g. not a room member, not host) |
| 403 | `age_restricted` | Money feature used by an under-18 user |
| 404 | `not_found` | Resource doesn't exist or isn't visible to the caller |
| 404 | `profile_not_found` | Valid token but the user hasn't created a profile yet (see §4) |
| 409 | `username_taken` | |
| 409 | `invalid_room_state` | Action not allowed in the room's current `status` |
| 409 | `room_full` | |
| 409 | `already_member` | |
| 409 | `already_submitted` | Quiz already submitted |
| 409 | `insufficient_balance` | Not enough points/coins |
| 409 | `conflict` | Other state conflicts (duplicate friend request, etc.) |
| 413 | `file_too_large` | Upload > 20 MB |
| 415 | `unsupported_file_type` | |
| 422 | `validation_error` | Body/query failed validation |
| 429 | `rate_limited` | |
| 500 | `internal_error` | Bug; message is generic |
| 502 | `upstream_error` | Gemini / OpenRouter / Stripe failed |

Successful responses: `200` (read/update), `201` (created, returns the created object), `204` (no body, e.g. delete).

## 4. Authentication & onboarding

1. Expo uses `@supabase/supabase-js` to sign up / log in (email + password; OAuth optional later). Supabase stores credentials — **the API never handles passwords**.
2. Every API call sends `Authorization: Bearer <session.access_token>`. Get the token from `supabase.auth.getSession()` right before each request (supabase-js refreshes it automatically).
3. The API verifies the JWT locally using the Supabase project's JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), checks `aud = "authenticated"` and expiry, and takes the user ID from the `sub` claim.
4. **After login, the app calls `GET /api/me`:**
   - `200` → profile exists → go to the home screen.
   - `404 profile_not_found` → show onboarding → `POST /api/me` with username, display name, date of birth → home screen.
5. On `401 unauthenticated`: try `supabase.auth.refreshSession()` once and retry; if it fails again, sign out.

Age: `isAdult` is computed server-side from `dateOfBirth` (≥ 18 today). Date of birth can't be changed after onboarding. Under-18s can only use `points` mode and can never see/buy coins.

## 5. Core objects (TypeScript notation)

These are the exact response shapes. `?` is never used — nullable fields are typed `| null`.

```ts
type UUID = string;
type ISODateTime = string; // "2026-10-10T14:03:00Z"
type ISODate = string;     // "2006-04-21"

interface UserSummary {            // embedded wherever a user appears
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  equipped: EquippedItems;
}

interface Me extends UserSummary { // GET /api/me only
  dateOfBirth: ISODate;
  isAdult: boolean;
  createdAt: ISODateTime;
}

interface EquippedItems {
  avatarFrame: UUID | null;        // ShopItem ids
  theme: UUID | null;
  title: UUID | null;
}

interface UserStats {
  totalStudyMinutes: number;       // focused minutes across all settled rooms
  roomsCompleted: number;
  roomsWon: number;                // rooms where the user passed
  roomsLost: number;
  averageQuizScore: number | null; // 0–100
  averageFocusPercent: number | null;
  currentStreakDays: number;       // consecutive days with a completed room
  totalPoints: number;             // current points balance
}

interface Friendship {
  id: UUID;
  user: UserSummary;               // the *other* person
  status: "pending" | "accepted";
  direction: "incoming" | "outgoing";  // who sent the request (relative to me)
  createdAt: ISODateTime;
}

interface RoomSettings {
  name: string;                    // 1–60 chars
  mode: "points" | "money";        // money requires every member isAdult
  stakeAmount: number;             // points or coins per member, ≥ 0 (money: ≥ 100)
  thresholdType: "absolute" | "relative_to_best";
  thresholdValue: number;          // 0–100, see §7.4
  minFocusPercent: number;         // 0–100; 0 = focus not required to pass
  payoutTarget: "winners" | "charity";
  charityId: UUID | null;          // required when payoutTarget = "charity" or for the no-winner case in money mode
  studyMinutes: number;            // 5–240
  quizQuestionCount: number;       // 5–20
  quizMinutes: number;             // 2–60, time allowed to submit the quiz
  maxMembers: number;              // 2–10
}

interface Room {
  id: UUID;
  status: RoomStatus;
  inviteCode: string;              // 6 chars, uppercase A–Z0–9, used to join
  host: UserSummary;
  settings: RoomSettings;
  members: RoomMember[];
  materials: Material[];
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;   // when studying began
  studyEndsAt: ISODateTime | null;
  quizStartsAt: ISODateTime | null;
  quizEndsAt: ISODateTime | null;
  settledAt: ISODateTime | null;
  me: {                            // the caller's own view
    isHost: boolean;
    isReady: boolean;
    hasSubmittedQuiz: boolean;
  };
}

type RoomStatus =
  | "lobby"            // joining, uploading/approving materials, readying up
  | "studying"         // timer running, focus tracked
  | "generating_quiz"  // waiting on Gemini (usually < 30 s)
  | "quiz"             // members answering
  | "grading"          // waiting on grading/settlement
  | "settled"          // results final, payouts done
  | "cancelled";       // host cancelled in lobby, or quiz generation failed (stakes refunded)

interface RoomSummary {            // list item
  id: UUID;
  name: string;
  status: RoomStatus;
  mode: "points" | "money";
  stakeAmount: number;
  memberCount: number;
  host: UserSummary;
  createdAt: ISODateTime;
  settledAt: ISODateTime | null;
  myResult: { passed: boolean; netAmount: number } | null; // only when settled
}

interface RoomMember {
  user: UserSummary;
  role: "host" | "member";
  isReady: boolean;
  joinedAt: ISODateTime;
  presence: "online" | "offline";  // connected to the room WebSocket
  focus: FocusSummary | null;      // null in lobby
  result: MemberResult | null;     // null until settled
}

interface FocusSummary {
  state: "focused" | "away" | "offline";
  focusedSeconds: number;
  awaySeconds: number;
  focusPercent: number;            // focused / elapsed study time, 0–100
}

interface Material {
  id: UUID;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: UserSummary;
  uploadedAt: ISODateTime;
  approvedBy: UUID[];              // user ids who approved
  approvedByAll: boolean;
  textStatus: "processing" | "ready" | "failed"; // text extraction for the quiz
}

interface QuizQuestion {           // sent during "quiz" — never contains answers
  id: UUID;
  index: number;                   // 0-based display order
  type: "multiple_choice" | "short_answer";
  prompt: string;
  options: { id: string; text: string }[] | null; // multiple_choice only
}

interface QuizAnswerInput {
  questionId: UUID;
  optionId: string | null;         // multiple_choice
  text: string | null;             // short_answer, ≤ 1000 chars
}

interface MemberResult {
  quizScore: number;               // 0–100
  focusPercent: number;
  passed: boolean;
  rank: number;                    // 1 = best quiz score
  stakeAmount: number;
  payout: number;                  // amount received back (stake refund + winnings)
  netAmount: number;               // payout − stake (negative = lost)
  pointsAwarded: number;           // bonus points (see §7.5)
}

interface QuizReview {             // after settlement, per question, for the caller
  question: QuizQuestion;
  correctOptionId: string | null;
  modelAnswer: string | null;      // short_answer
  myAnswer: QuizAnswerInput | null;
  isCorrect: boolean;
  score: number;                   // 0–1 (short answers can get partial credit)
  feedback: string | null;         // AI feedback on short answers
}

interface Wallet {
  points: number;
  coins: number;                   // always 0 for under-18s
  lockedPoints: number;            // currently staked in active rooms
  lockedCoins: number;
}

interface LedgerEntry {
  id: UUID;
  currency: "points" | "coins";
  amount: number;                  // signed: + received, − spent
  type: LedgerEntryType;
  room: { id: UUID; name: string } | null;
  counterparty: UserSummary | null; // who you won from / lost to
  description: string;
  createdAt: ISODateTime;
}

type LedgerEntryType =
  | "signup_bonus" | "stake" | "stake_refund" | "winnings" | "charity_donation"
  | "pass_reward" | "purchase" | "withdrawal" | "shop_purchase" | "adjustment";

interface Charity { id: UUID; name: string; description: string; logoUrl: string | null; }

interface LeaderboardRow {
  rank: number;
  user: UserSummary;               // includes me
  totalPoints: number;
  coinsNet: number;                // lifetime coins won − lost in rooms (0 for under-18s)
  studyMinutes: number;
  roomsWon: number;
  wonFromMe: number;               // coins+points this user has won from me (0 on my own row)
  lostToMe: number;                // coins+points I have won from this user
}

interface Todo {
  id: UUID;
  title: string;                   // 1–200 chars
  notes: string | null;
  dueAt: ISODateTime | null;
  isDone: boolean;
  completedAt: ISODateTime | null;
  visibility: "private" | "friends";
  createdAt: ISODateTime;
}

interface CalendarEvent {
  id: UUID;
  title: string;
  kind: "assignment" | "exam" | "study" | "other";
  startsAt: ISODateTime;
  endsAt: ISODateTime | null;
  allDay: boolean;
  notes: string | null;
  source: "manual" | "google";     // google = imported later
}

interface ShopItem {
  id: UUID;
  name: string;
  kind: "avatar_frame" | "theme" | "title";
  pricePoints: number;
  previewUrl: string | null;
  owned: boolean;
}
```

## 6. Endpoints

`[paged]` = paginated (§3.4). All require auth unless noted.

### 6.1 Health (no auth)

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/health/db` | `{ "status": "ok" }` |

### 6.2 Me & users

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/me` | — | `Me` or `404 profile_not_found` |
| POST | `/api/me` | `{ username, displayName, dateOfBirth }` | `201 Me`. Grants 100 `signup_bonus` points |
| PATCH | `/api/me` | `{ displayName?, avatarUrl?, equipped? }` | `Me` |
| GET | `/api/me/stats` | — | `UserStats` |
| GET | `/api/users?search=ali` | — | `{ items: UserSummary[] }` — username prefix match, max 20 |
| GET | `/api/users/{userId}` | — | `UserSummary` |
| GET | `/api/users/{userId}/stats` | — | `UserStats` (friends only, else 403) |

Username rules: 3–20 chars, `a–z`, `0–9`, `_`, stored lowercase, unique. Display name: 1–40 chars.

### 6.3 Friends

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/friends` | — | `{ items: Friendship[] }` (accepted only) |
| GET | `/api/friends/requests` | — | `{ items: Friendship[] }` (pending, both directions) |
| POST | `/api/friends/requests` | `{ username }` | `201 Friendship`. If they already requested you, it auto-accepts |
| POST | `/api/friends/requests/{friendshipId}/accept` | — | `Friendship` |
| DELETE | `/api/friends/requests/{friendshipId}` | — | `204` (decline or cancel) |
| DELETE | `/api/friends/{userId}` | — | `204` (unfriend) |

### 6.4 Rooms

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/rooms` | `RoomSettings` | `201 Room` (caller is host and first member) |
| GET | `/api/rooms?scope=active` [paged] | — | `{ items: RoomSummary[], nextCursor }`. `scope`: `active` (not settled/cancelled) or `past` |
| GET | `/api/rooms/{roomId}` | — | `Room` (members only) |
| PATCH | `/api/rooms/{roomId}` | partial `RoomSettings` | `Room`. Host only, `lobby` only. **Un-readies everyone.** |
| DELETE | `/api/rooms/{roomId}` | — | `204`. Host only, `lobby` only → `cancelled` |
| POST | `/api/rooms/join` | `{ inviteCode }` | `Room`. `lobby` only |
| POST | `/api/rooms/{roomId}/leave` | — | `204`. `lobby` only. If the host leaves, host passes to the earliest-joined member; if nobody is left → `cancelled` |
| POST | `/api/rooms/{roomId}/ready` | `{ isReady: boolean }` | `Room` |
| POST | `/api/rooms/{roomId}/start` | — | `Room` (now `studying`). Host only |
| GET | `/api/rooms/{roomId}/quiz` | — | `{ items: QuizQuestion[] }`. Only in `quiz` |
| POST | `/api/rooms/{roomId}/quiz/submission` | `{ answers: QuizAnswerInput[] }` | `204`. Once per member, before `quizEndsAt` |
| GET | `/api/rooms/{roomId}/results` | — | `{ members: RoomMember[], review: QuizReview[] }`. Only in `settled` |
| POST | `/api/rooms/{roomId}/focus-events` | `{ state: "focused" \| "away", at: ISODateTime }` | `204`. REST fallback for §8 when the WebSocket is down |

### 6.5 Materials

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/rooms/{roomId}/materials` | multipart, field **`file`** | `201 Material`. `lobby` only. **Un-readies everyone.** Uploader auto-approves |
| GET | `/api/rooms/{roomId}/materials/{materialId}/file` | — | the file bytes (members only) |
| POST | `/api/rooms/{roomId}/materials/{materialId}/approve` | `{ approved: boolean }` | `Material` |
| DELETE | `/api/rooms/{roomId}/materials/{materialId}` | — | `204`. Uploader or host, `lobby` only. Un-readies everyone |

Allowed files: PDF, TXT, MD, DOCX, PPTX. Max 20 MB each, max 10 per room. Text is extracted in the background (`textStatus`); scanned PDFs without text → `failed`.

### 6.6 Wallet & money

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/wallet` | — | `Wallet` |
| GET | `/api/wallet/transactions?currency=coins` [paged] | — | `{ items: LedgerEntry[], nextCursor }`; `currency` optional |
| POST | `/api/wallet/checkout` | `{ coins: 500 \| 1000 \| 2000 \| 5000 }` | `{ checkoutUrl }`. Adults only. Stripe **test mode** |
| POST | `/api/wallet/withdrawals` | `{ coins }` | `201 { id, coins, status: "pending" }`. Adults only. Not actually paid out during the hackathon |
| GET | `/api/charities` (no auth) | — | `{ items: Charity[] }` |
| POST | `/api/webhooks/stripe` (no auth, Stripe signature) | Stripe event | `200`. Credits coins on `checkout.session.completed` |

Buying coins: open `checkoutUrl` with `expo-web-browser`. Stripe redirects to `studystakes://wallet?checkout=success` (or `=cancelled`). Coins arrive via the webhook, usually within seconds — the app refetches `GET /api/wallet` after the redirect (poll every 2 s for up to 20 s).

### 6.7 Leaderboard

| Method | Path | Response |
|---|---|---|
| GET | `/api/leaderboard?sort=points` | `{ items: LeaderboardRow[] }` — me + accepted friends. `sort`: `points` \| `coins` \| `studyMinutes` |

### 6.8 To-dos

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/todos?isDone=false` | — | `{ items: Todo[] }` sorted by `dueAt` (nulls last), then `createdAt` |
| POST | `/api/todos` | `{ title, notes?, dueAt?, visibility? }` | `201 Todo` (`visibility` default `private`) |
| PATCH | `/api/todos/{todoId}` | partial `{ title, notes, dueAt, isDone, visibility }` | `Todo` |
| DELETE | `/api/todos/{todoId}` | — | `204` |
| GET | `/api/users/{userId}/todos` | — | `{ items: Todo[] }` — a friend's `friends`-visible todos |

### 6.9 Calendar

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/calendar/events?from=…&to=…` | — | `{ items: CalendarEvent[] }` (both params required, ISO datetimes, max 93-day range) |
| POST | `/api/calendar/events` | `{ title, kind, startsAt, endsAt?, allDay?, notes? }` | `201 CalendarEvent` |
| PATCH | `/api/calendar/events/{eventId}` | partial | `CalendarEvent` |
| DELETE | `/api/calendar/events/{eventId}` | — | `204` |

Google Calendar import is a later phase (`source: "google"` is reserved for it).

### 6.10 Shop

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/shop/items` | — | `{ items: ShopItem[] }` |
| POST | `/api/shop/items/{itemId}/purchase` | — | `ShopItem` (`owned: true`). Spends points (`shop_purchase`) |

Equip owned items with `PATCH /api/me { equipped: { theme: "<itemId>" } }` (`null` to unequip).

## 7. Room lifecycle (the core game)

### 7.1 State machine

```
lobby ──start──► studying ──studyEndsAt──► generating_quiz ──► quiz ──all submitted / quizEndsAt──► grading ──► settled
  │                                              │
  └──host cancels / everyone leaves──► cancelled ◄──generation failed (after 2 retries)
```

The **server** drives every transition after `start` (timers run on the backend). The frontend never assumes a transition — it reacts to `room.updated` events (§8) or refetches `GET /api/rooms/{id}`.

### 7.2 Lobby

- Join with the 6-character `inviteCode` (share it, or as a deep link `studystakes://join/ABC123`).
- Any member can upload materials; every member must approve every material.
- `POST /ready { isReady: true }` requires: the caller has approved all materials, all materials have `textStatus: "ready"`, and (money mode) the caller is an adult with `coins ≥ stakeAmount` (points mode: `points ≥ stakeAmount`).
- Changing settings, uploading or deleting a material **un-readies everyone**, so nobody is committed to terms they didn't see.
- `POST /start` (host) requires: ≥ 2 members, all ready, ≥ 1 material, every material `approvedByAll`. Errors use `invalid_room_state` with a message saying what's missing.

### 7.3 Studying

- On start the server **locks every member's stake** (`stake` ledger entry, negative) and sets `studyEndsAt = startedAt + studyMinutes`.
- Clients report focus (§8). The server accumulates `focusedSeconds` / `awaySeconds` per member.
- At `studyEndsAt` → `generating_quiz`. Gemini creates `quizQuestionCount` questions from the extracted material text (≈ 70% multiple choice, 30% short answer). Then → `quiz` with `quizEndsAt = quizStartsAt + quizMinutes`.

### 7.4 Quiz & grading

- All members get the same questions. Each member submits once. Unanswered questions score 0; members who never submit score 0.
- When everyone has submitted, or at `quizEndsAt` → `grading`. Multiple choice is graded exactly; short answers are graded by OpenRouter (score 0–1 + one-line feedback).
- `quizScore` = average question score × 100, rounded to an integer.
- **Pass rule** — a member passes if both hold:
  - `thresholdType = "absolute"`: `quizScore ≥ thresholdValue`
    `thresholdType = "relative_to_best"`: `quizScore ≥ bestQuizScore − thresholdValue`
  - `focusPercent ≥ minFocusPercent`

### 7.5 Settlement (all in one DB transaction)

1. Every **winner** gets their own stake back (`stake_refund`).
2. Each **loser's** stake goes:
   - `payoutTarget = "winners"`: split equally among winners (`winnings`, `counterparty` = the loser). Leftover units from rounding go to the highest-scoring winner.
   - `payoutTarget = "charity"`: to the room's charity (`charity_donation`).
3. **No winners:** money mode → all stakes go to the charity; points mode → stakes are lost (burned).
4. **Pass reward:** every winner also gets `pass_reward` points = focused minutes (rounded down). This is the points compensation that makes up for money that can't be fully returned after Stripe fees.
5. Status → `settled`; `GET /results` becomes available.

## 8. Realtime (WebSocket)

**Connect:** `GET /ws/rooms/{roomId}?token=<supabase access_token>` (the token goes in the query string because WebSockets can't send custom headers from browsers). Connect when the room screen opens, disconnect when it closes.

Close codes: `4401` bad/expired token (refresh and reconnect), `4403` not a member, `4404` room not found. On any other disconnect, reconnect with backoff (1 s, 2 s, 5 s, then every 10 s) and refetch `GET /api/rooms/{id}`.

All messages are JSON: `{ "type": string, "data": object }`.

**Server → client**

| `type` | `data` | When |
|---|---|---|
| `room.updated` | `Room` | On connect, and after **any** change (member joined/left/readied, material uploaded/approved, status change, settings change, result ready). The frontend just replaces its room state with this. |
| `member.focus` | `{ userId, focus: FocusSummary }` | A member's focus state changes, plus every 15 s during `studying` |
| `member.presence` | `{ userId, presence }` | A member connects/disconnects |
| `pong` | `{}` | Reply to `ping` |
| `error` | `{ code, message }` | Bad client message |

**Client → server**

| `type` | `data` | When |
|---|---|---|
| `focus.update` | `{ state: "focused" \| "away" }` | Immediately when the app goes background/foreground during `studying` (Expo `AppState`: `active` = focused, anything else = away) |
| `ping` | `{}` | Every 15 s. Doubles as a heartbeat: **no ping for 45 s during `studying` counts as `away`** |

If the socket is down, send `POST /api/rooms/{roomId}/focus-events` instead.

## 9. Frontend integration checklist

- **One API client module** that: prefixes the base URL, adds `Authorization` + `ngrok-skip-browser-warning` headers, parses the error shape (§3.5) into a typed error with `code`, and handles the 401 refresh/retry (§4).
- Base URL comes from an env var (`EXPO_PUBLIC_API_URL`), not hard-coded.
- Generate TS types from `/openapi.json` (e.g. `openapi-typescript`) once endpoints exist; until then use §5.
- Switch on `error.code`, never on `message` text.
- Show amounts as: points → `"1,250 pts"`, coins → euros (`coins / 100`, `"€12.50"`).
- Hide everything money-related when `me.isAdult === false`.
- File uploads: `expo-document-picker`, send as `multipart/form-data` with field name `file`.
- Deep links (app scheme `studystakes`): `studystakes://join/{inviteCode}`, `studystakes://wallet?checkout=success|cancelled`.
- Room screen: render by `room.status`; keep a WebSocket open; drive timers from server timestamps (`studyEndsAt`, `quizEndsAt`) — never from local timers alone.

## 10. Backend conventions (for building the API)

### 10.1 Layout

```
backend/
├── app/
│   ├── main.py            # app, CORS, error handlers, routers
│   ├── db.py              # engine, SessionLocal, Base, get_db
│   ├── config.py          # env vars
│   ├── auth.py            # Supabase JWT verification; get_current_user_id, get_current_user
│   ├── errors.py          # ApiError(status, code, message, details) + exception handlers
│   ├── models/            # SQLAlchemy tables, one file per area
│   ├── schemas/           # Pydantic request/response models (CamelModel base)
│   ├── routers/           # thin HTTP layer, one file per §6 section, plus ws.py
│   └── services/          # business logic: rooms (state machine), settlement, ledger,
│                          #   quiz_gen (Gemini), grading (OpenRouter), storage, stripe, realtime
├── alembic/               # migrations
└── uploads/               # stored material files (gitignored)
```

### 10.2 Rules

- **Routers are thin**: parse input, call a service, return a schema. No business logic in routers.
- **Room status only changes inside `services/rooms.py`**, which also broadcasts `room.updated`.
- **All points/coins movements go through `services/ledger.py`** and happen in the same DB transaction as the action that caused them. Balances are `SUM(amount)` over `ledger_entries` — there is no mutable balance column. Lock the user row (`SELECT … FOR UPDATE`) before spending.
- **Every route declares a `response_model`.** All schemas extend a `CamelModel` base (Pydantic `alias_generator=to_camel`, `populate_by_name=True`) so JSON is camelCase while Python stays snake_case.
- Raise `ApiError(...)` for every expected error; never return error dicts by hand. FastAPI's validation errors are converted to the §3.5 shape.
- IDs: `CHAR(36)` UUIDs generated server-side (`uuid4`), except `users.id` = Supabase `sub`.
- Times: stored as UTC `DATETIME(6)`, serialized with `Z`.
- Every schema change ships as an Alembic migration in the same commit.
- Background work (text extraction, quiz generation, grading, timers) runs as asyncio tasks in the single process; on startup the server resumes any room whose timer has passed.

### 10.3 Tables

| Table | Key columns |
|---|---|
| `users` | id (Supabase sub), username (unique), display_name, date_of_birth, avatar_url, equipped_* , created_at |
| `friendships` | id, requester_id, addressee_id, status, created_at — unique pair |
| `rooms` | id, host_id, invite_code (unique), status, all `RoomSettings` columns, timestamps |
| `room_members` | room_id, user_id, role, is_ready, joined_at, focused_seconds, away_seconds, quiz_score, passed, rank, payout — unique (room_id, user_id) |
| `materials` | id, room_id, uploaded_by, filename, mime_type, size_bytes, storage_path, extracted_text (LONGTEXT), text_status |
| `material_approvals` | material_id, user_id, approved — unique pair |
| `focus_events` | id, room_id, user_id, state, at |
| `quiz_questions` | id, room_id, index, type, prompt, options (JSON), correct_option_id, model_answer |
| `quiz_submissions` | id, room_id, user_id, submitted_at — unique (room_id, user_id) |
| `quiz_answers` | submission_id, question_id, option_id, text, score, feedback |
| `ledger_entries` | id, user_id, currency, amount (signed BIGINT), type, room_id, counterparty_user_id, charity_id, stripe_ref, description, created_at |
| `payments` | id, user_id, stripe_session_id (unique), coins, amount_cents, status |
| `withdrawals` | id, user_id, coins, status |
| `charities` | id, name, description, logo_url |
| `todos` | id, user_id, title, notes, due_at, is_done, completed_at, visibility |
| `calendar_events` | id, user_id, title, kind, starts_at, ends_at, all_day, notes, source, external_id |
| `shop_items` / `user_items` | items catalogue / ownership |

### 10.4 Environment variables (`backend/.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `mysql+pymysql://user:pass@127.0.0.1:3306/hackathondb?charset=utf8mb4` |
| `CORS_ORIGINS` | Comma-separated web origins (Expo web: `http://localhost:8081`) |
| `SUPABASE_URL` | `https://<project>.supabase.co` — for JWKS |
| `GEMINI_API_KEY` | Quiz generation |
| `OPENROUTER_API_KEY` | Short-answer grading |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Test-mode keys |
| `APP_SCHEME` | `studystakes` (Stripe redirect deep links) |
| `UPLOAD_DIR` | Default `uploads` |

## 11. Enum reference

| Enum | Values |
|---|---|
| `RoomStatus` | `lobby`, `studying`, `generating_quiz`, `quiz`, `grading`, `settled`, `cancelled` |
| `RoomMode` | `points`, `money` |
| `ThresholdType` | `absolute`, `relative_to_best` |
| `PayoutTarget` | `winners`, `charity` |
| `MemberRole` | `host`, `member` |
| `FocusState` | `focused`, `away`, `offline` |
| `Presence` | `online`, `offline` |
| `QuestionType` | `multiple_choice`, `short_answer` |
| `TextStatus` | `processing`, `ready`, `failed` |
| `Currency` | `points`, `coins` |
| `LedgerEntryType` | `signup_bonus`, `stake`, `stake_refund`, `winnings`, `charity_donation`, `pass_reward`, `purchase`, `withdrawal`, `shop_purchase`, `adjustment` |
| `FriendshipStatus` | `pending`, `accepted` |
| `TodoVisibility` | `private`, `friends` |
| `CalendarKind` | `assignment`, `exam`, `study`, `other` |
| `ShopItemKind` | `avatar_frame`, `theme`, `title` |

## 12. Build order

Each phase leaves the frontend with something working end to end.

1. **Foundation** — errors, CamelModel, Supabase auth, `users`, `/api/me` (+ onboarding), `/api/users`.
2. **Rooms (lobby)** — create/join/leave/ready/settings, materials upload + approval + text extraction, `room.updated` over WebSocket.
3. **Studying** — start, stake locking (points mode), focus tracking, timers.
4. **Quiz + settlement** — Gemini generation, submission, grading, settlement, results. *(Full game loop playable in points mode — demo-ready.)*
5. **Social** — friends, wallet + transactions, leaderboard, stats.
6. **Productivity** — to-dos, calendar, shop.
7. **Money** — Stripe test-mode checkout + webhook, money rooms, withdrawals (stubbed).

> **Real money caveat:** holding users' money and paying it to other users based on outcomes can count as money transmission or gambling depending on jurisdiction, and Stripe requires Connect + identity verification for payouts. Keep money mode in Stripe test mode for the hackathon and pitch it as a future feature.
