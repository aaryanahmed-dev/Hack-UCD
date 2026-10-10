# Study Stakes — Backend API Spec

The single source of truth for how the FastAPI backend behaves and how the React Native (Expo) frontend talks to it.
Frontend code must follow this contract exactly; backend code must implement it exactly. If something needs to change, change this file first.

> **Status:** Phase 1 (Foundation) implemented: error format, camelCase schemas, Supabase auth, `/api/me` (+ onboarding, stats), `/api/users`. Stats that depend on sessions return zeros until those phases land. Everything else below is the target design.

---

## 1. Product summary

Friends form **groups** (e.g. "Organic Chemistry Squad") and start live **study sessions** inside them. Before a session, members agree on the study material (uploaded files or pasted text), the stake (**tokens**, or real-money **coins** for over-18s), where lost stakes go (winners or charity), and — by **live vote** — how the quiz is passed. During the session a shared timer runs, focus is monitored and members tick off a shared to-do list; when the timer ends the group can **vote to extend**. Then everyone takes an **AI-generated, timed quiz** with anti-cheat, can **dispute** bad questions, and the system **settles**: failers' stakes go to the winners (proportional to score) or to charity, and winners earn bonus tokens. Around this: profiles and stats, friends with live status, global/friends/group leaderboards, a to-do list, Google Calendar sync, a token shop, charity receipts and AI session summaries.

## 2. Architecture

```
Expo app ──(Supabase JS)──► Supabase Auth          (email + Google sign-in only)
    │
    └──(HTTPS + WebSocket, Bearer token)──► FastAPI ──► MySQL (all app data)
                                               ├──► local disk       (uploaded study files)
                                               ├──► OpenRouter       (quiz generation with a Gemini model, answer grading, summaries)
                                               ├──► Stripe           (buy coins, test mode)
                                               ├──► Google Calendar  (read events, add session events + reminders)
                                               └──► Resend           (session summary emails)
```

- **Supabase is used for authentication only.** No Supabase database, storage or realtime.
- **The API owns everything else.** The frontend never talks to MySQL, OpenRouter, Google Calendar, Resend or Stripe directly (except opening URLs the API returns).
- All AI calls go through **OpenRouter**; quiz generation uses a Gemini model via OpenRouter (model names are config, §11.4).
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
| `Authorization` | `Bearer <supabase access_token>` — required on everything except routes marked **(public)** |
| `ngrok-skip-browser-warning` | `1` — always send it; otherwise ngrok returns an HTML warning page instead of JSON |
| `Content-Type` | `application/json` (except file uploads: `multipart/form-data`) |

### 3.3 JSON format

- **camelCase** keys in all request and response bodies (`displayName`, `studyEndsAt`). Query parameters are camelCase too.
- **IDs** are UUID strings. User IDs are the Supabase user ID.
- **Timestamps** are ISO 8601 in UTC with a `Z` suffix: `"2026-10-10T14:03:00Z"`. Dates without time (date of birth) are `"YYYY-MM-DD"`. The frontend converts to local time for display.
- **Amounts** are integers. `tokens` and `coins` are both whole numbers; **1 coin = €0.01**. Never floats.
- **Percentages** are integers `0–100`.
- **Enums** are lowercase snake_case strings (see §12).
- `null` means "not set"; nullable fields are always present in responses, never omitted.
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
    "message": "You need 500 coins to join this session.",
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
| 403 | `forbidden` | Authenticated but not allowed (not a member, wrong role, …) |
| 403 | `age_restricted` | Money feature used by an under-18 user |
| 404 | `not_found` | Resource doesn't exist or isn't visible to the caller |
| 404 | `profile_not_found` | Valid token but the user hasn't completed onboarding (§4) |
| 409 | `username_taken` | |
| 409 | `invalid_session_state` | Action not allowed in the session's current `status` |
| 409 | `session_full` / `group_full` | |
| 409 | `already_member` | |
| 409 | `already_voted` | Vote already cast and votes in this context can't change |
| 409 | `question_expired` | Quiz answer arrived after the question's deadline (§7.6) |
| 409 | `insufficient_balance` | Not enough tokens/coins |
| 409 | `google_not_connected` | Calendar action needs Google connected |
| 409 | `conflict` | Other state conflicts (duplicate friend request, etc.) |
| 413 | `file_too_large` | Upload > 20 MB |
| 415 | `unsupported_file_type` | |
| 422 | `validation_error` | Body/query failed validation |
| 429 | `rate_limited` | |
| 500 | `internal_error` | Bug; message is generic |
| 502 | `upstream_error` | OpenRouter / Stripe / Google / Resend failed |

Successful responses: `200` (read/update), `201` (created, returns the created object), `204` (no body).

## 4. Authentication & onboarding (age gate)

1. Expo uses `@supabase/supabase-js` to sign up / log in with **email + password** or **Google OAuth**. Supabase stores credentials — **the API never handles passwords**.
2. Every API call sends `Authorization: Bearer <session.access_token>`. Get the token from `supabase.auth.getSession()` right before each request (supabase-js refreshes it automatically).
3. The API verifies the JWT locally using the Supabase project's JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), checks `aud = "authenticated"` and expiry, and takes the user ID from `sub` and the email from `email`.
4. **After login, the app calls `GET /api/me`:**
   - `200` → onboarding done → home screen.
   - `404 profile_not_found` → **onboarding screen (mandatory)**: username, display name, **date of birth** → `POST /api/me` → home screen.
5. On `401 unauthenticated`: try `supabase.auth.refreshSession()` once and retry; if it fails again, sign out.

**Age gate:** `isAdult` is computed server-side from `dateOfBirth` (≥ 18 today). Date of birth **cannot be changed** after onboarding.
- Under 18 → **token mode only**. Coins, money sessions and the wallet's money features are hidden and return `403 age_restricted`.
- 18+ → can choose token mode or money mode per session.

## 5. Core objects (TypeScript notation)

Exact response shapes. Nullable fields are typed `| null` and always present.

```ts
type UUID = string;
type ISODateTime = string; // "2026-10-10T14:03:00Z"
type ISODate = string;     // "2006-04-21"

// ───────── Users ─────────

interface UserSummary {            // embedded wherever a user appears
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  equipped: EquippedItems;
}

interface Me extends UserSummary { // GET /api/me only
  email: string;
  dateOfBirth: ISODate;
  isAdult: boolean;
  googleCalendarConnected: boolean;
  createdAt: ISODateTime;
}

interface EquippedItems {
  avatar: UUID | null;             // ShopItem ids
  banner: UUID | null;             // shown on profile and in sessions you host
}

interface UserStats {
  totalStudyMinutes: number;       // focused minutes across all settled sessions
  weeklyStudyMinutes: number;      // since Monday 00:00 UTC
  currentStreakDays: number;       // consecutive days with a settled session (streak freezes count)
  longestStreakDays: number;
  sessionsCompleted: number;
  wins: number;                    // sessions passed
  losses: number;
  winRate: number | null;          // 0–100, null before first session
  averageQuizScore: number | null; // 0–100
  averageFocusPercent: number | null;
  lifetimeTokensEarned: number;    // sum of all positive token ledger entries
  tokens: number;                  // current token balance
  coinsWon: number;                // lifetime coins won from others (0 for under-18s)
  coinsDonated: number;            // lifetime coins routed to charity
}

type UserStatus = "offline" | "online" | "studying"; // live status shown to friends

interface Friend {
  user: UserSummary;
  status: UserStatus;
  currentSessionId: UUID | null;   // set when status = "studying" and you share a group
  since: ISODateTime;
}

interface FriendRequest {
  id: UUID;
  user: UserSummary;               // the other person
  direction: "incoming" | "outgoing";
  createdAt: ISODateTime;
}

// ───────── Groups ─────────

interface GroupSummary {
  id: UUID;
  name: string;                    // 1–60 chars
  description: string | null;
  memberCount: number;
  myRole: GroupRole;
  activeSession: { id: UUID; status: SessionStatus } | null;
  createdAt: ISODateTime;
}

interface Group extends GroupSummary {
  inviteCode: string;              // 6 chars, A–Z0–9; owner/admin can regenerate
  members: GroupMember[];
  stats: {
    totalFocusedMinutes: number;
    sessionsCompleted: number;
    averageQuizScore: number | null;
  };
  milestones: Milestone[];
}

type GroupRole = "owner" | "admin" | "member";

interface GroupMember {
  user: UserSummary;
  role: GroupRole;
  status: UserStatus;
  joinedAt: ISODateTime;
}

interface Milestone {
  id: string;                      // e.g. "focus_hours_50"
  title: string;                   // "50 hours studied together"
  metric: "focus_hours" | "sessions_completed";
  target: number;
  progress: number;
  achievedAt: ISODateTime | null;
}

// ───────── Study sessions ─────────

type SessionStatus =
  | "lobby"            // joining, materials, config, assessment vote, readying up
  | "studying"         // shared timer running, focus tracked, shared to-dos
  | "extension_vote"   // timer ended; 30 s vote to extend
  | "generating_quiz"  // waiting on the AI (usually < 30 s)
  | "quiz"             // members answering, one timed question at a time
  | "grading"          // grading short answers
  | "review"           // provisional results; disputes + nullification votes
  | "settled"          // results final, payouts done
  | "cancelled";       // cancelled in lobby, or quiz generation failed (stakes refunded)

interface SessionConfig {          // set by the session host in the lobby
  title: string;                   // 1–60 chars
  mode: "tokens" | "money";        // money requires every participant isAdult
  stakeAmount: number;             // per participant; tokens ≥ 0, coins ≥ 100
  payoutTarget: "winners" | "charity";
  charityId: UUID | null;          // required when mode = "money" (also used if nobody passes)
  studyMinutes: number;            // 5–240
  extensionMinutes: number;        // 5–60, length of one extension (default 10)
  maxExtensions: number;           // 0–3 (default 2)
  quizQuestionCount: number;       // 5–10
  minFocusPercent: number;         // 0–100; 0 = focus not required to pass
  maxParticipants: number;         // 2–10
  scheduledFor: ISODateTime | null;// optional planned start (calendar + reminders)
}

interface AssessmentRule {
  thresholdType: "fixed" | "top_percent" | "relative_to_best";
  thresholdValue: number;          // 0–100, meaning per type in §7.3
}

interface StudySession {
  id: UUID;
  group: { id: UUID; name: string };
  status: SessionStatus;
  host: UserSummary;
  config: SessionConfig;
  participants: Participant[];
  materials: Material[];
  assessment: {
    votes: { rule: AssessmentRule; count: number }[]; // live tally, grouped by identical rule
    myVote: AssessmentRule | null;
    decided: AssessmentRule | null;                   // set at start
    decidedBy: "vote" | "coin_flip" | null;
  };
  extension: {
    used: number;                  // extensions granted so far
    vote: {                        // non-null only during "extension_vote"
      endsAt: ISODateTime;
      yes: number;
      no: number;
      myVote: boolean | null;
    } | null;
    lastOutcome: { extended: boolean; decidedBy: "vote" | "coin_flip" } | null;
  };
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  studyEndsAt: ISODateTime | null;     // moves when extended
  quizStartsAt: ISODateTime | null;
  quizEndsAt: ISODateTime | null;      // hard cut-off for the whole quiz
  reviewEndsAt: ISODateTime | null;
  settledAt: ISODateTime | null;
  me: {
    isHost: boolean;
    isParticipant: boolean;
    isReady: boolean;
    quizProgress: { answered: number; total: number } | null;
    reviewDone: boolean;
  };
}

interface SessionSummary {         // list item
  id: UUID;
  group: { id: UUID; name: string };
  title: string;
  status: SessionStatus;
  mode: "tokens" | "money";
  stakeAmount: number;
  participantCount: number;
  scheduledFor: ISODateTime | null;
  startedAt: ISODateTime | null;
  settledAt: ISODateTime | null;
  myResult: { passed: boolean; netAmount: number } | null; // only when settled
}

interface Participant {
  user: UserSummary;
  isHost: boolean;
  isReady: boolean;
  joinedAt: ISODateTime;
  presence: "online" | "offline";  // connected to the session WebSocket
  focus: FocusSummary | null;      // null in lobby
  quizProgress: { answered: number; total: number; flagged: number } | null;
  result: ParticipantResult | null;// provisional in "review", final in "settled"
}

interface FocusSummary {
  state: "focused" | "idle" | "away" | "offline";
  focusedSeconds: number;
  unfocusedSeconds: number;        // idle + away + offline
  focusPercent: number;            // focused / elapsed study time, 0–100
}

interface Material {
  id: UUID;
  kind: "file" | "text";
  title: string;                   // filename for files, user-given title for pasted text
  mimeType: string | null;         // files only
  sizeBytes: number;
  uploadedBy: UserSummary;
  uploadedAt: ISODateTime;
  approvedBy: UUID[];              // user ids who approved
  approvedByAll: boolean;          // all current participants approved
  textStatus: "processing" | "ready" | "failed"; // text extraction for the quiz
}

interface SessionTodo {            // shared, real-time list during a session
  id: UUID;
  title: string;                   // 1–200 chars
  createdBy: UserSummary;
  isDone: boolean;
  completedBy: UserSummary | null;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// ───────── Quiz ─────────

interface QuizQuestion {           // never contains answers before review
  id: UUID;
  index: number;                   // 0-based
  type: "multiple_choice" | "short_answer";
  prompt: string;
  options: { id: string; text: string }[] | null; // multiple_choice only
  timeLimitSeconds: number;        // 20
}

interface CurrentQuestion {        // GET /quiz/current
  question: QuizQuestion | null;   // null = you've finished
  number: number;                  // 1-based position
  total: number;
  deadline: ISODateTime | null;    // server deadline for this question
}

interface ParticipantResult {
  quizScore: number;               // 0–100, over non-nullified questions
  focusPercent: number;
  flaggedQuestions: number;        // anti-cheat flags
  passed: boolean;
  rank: number;                    // 1 = best quiz score
  stakeAmount: number;
  payout: number;                  // stake refund + winnings
  netAmount: number;               // payout − stake (negative = lost)
  bonusTokens: number;             // winner's bonus (§7.8)
  final: boolean;                  // false during "review"
}

interface QuestionReview {         // available from "review" onwards
  question: QuizQuestion;
  correctOptionId: string | null;
  modelAnswer: string | null;      // short_answer
  myAnswer: { optionId: string | null; text: string | null } | null;
  myScore: number;                 // 0–1 (short answers can get partial credit)
  flagged: boolean;                // I left the app during this question → scored 0
  feedback: string | null;         // AI feedback on short answers
  nullified: boolean;              // dropped by dispute vote
  dispute: Dispute | null;
}

interface Dispute {
  id: UUID;
  questionId: UUID;
  openedBy: UserSummary;
  reason: string;                  // 1–300 chars
  dropVotes: number;
  keepVotes: number;
  votesNeeded: number;             // ceil(2/3 × participants)
  myVote: "drop" | "keep" | null;
  outcome: "open" | "nullified" | "kept";
}

interface SessionAiSummary {
  status: "generating" | "ready" | "failed";
  recap: string | null;            // markdown
  missedConcepts: string[];        // concepts I got wrong
  emailedAt: ISODateTime | null;
}

// ───────── Money, tokens, charity ─────────

interface Wallet {
  tokens: number;
  coins: number;                   // always 0 for under-18s
  lockedTokens: number;            // staked in active sessions
  lockedCoins: number;
}

interface LedgerEntry {
  id: UUID;
  currency: "tokens" | "coins";
  amount: number;                  // signed: + received, − spent
  type: LedgerEntryType;
  session: { id: UUID; title: string } | null;
  counterparty: UserSummary | null;// who you won from / lost to
  description: string;
  createdAt: ISODateTime;
}

type LedgerEntryType =
  | "signup_bonus" | "stake" | "stake_refund" | "winnings" | "charity_donation"
  | "winner_bonus" | "purchase" | "withdrawal" | "shop_purchase" | "adjustment";

interface Charity { id: UUID; name: string; description: string; logoUrl: string | null; websiteUrl: string | null; }

interface Donation {               // a charity impact receipt
  id: UUID;
  charity: Charity;
  coins: number;
  session: { id: UUID; title: string };
  createdAt: ISODateTime;
  badgeUrl: string;                // public PNG, shareable (§6.10)
  shareUrl: string;                // public web page for the badge
}

// ───────── Leaderboards ─────────

interface LeaderboardRow {
  rank: number;
  user: UserSummary;               // includes me
  value: number;                   // the selected metric
  weeklyStudyMinutes: number;
  averageQuizScore: number | null;
  tokens: number;
  wonFromMe: number | null;        // friends scope only: coins this user won from me (tokens in tokens-only accounts)
  lostToMe: number | null;         // friends scope only
}

// ───────── Productivity ─────────

interface Todo {
  id: UUID;
  title: string;                   // 1–200 chars
  notes: string | null;
  priority: "low" | "medium" | "high";
  tags: string[];                  // each 1–20 chars, max 5
  dueAt: ISODateTime | null;
  isDone: boolean;
  completedAt: ISODateTime | null;
  visibility: "private" | "friends";
  subtasks: Subtask[];
  createdAt: ISODateTime;
}

interface Subtask { id: UUID; title: string; isDone: boolean; }

interface CalendarEvent {
  id: string;                      // UUID for manual/session; Google's id for google
  title: string;
  kind: "assignment" | "exam" | "study_session" | "other";
  startsAt: ISODateTime;
  endsAt: ISODateTime | null;
  allDay: boolean;
  notes: string | null;
  source: "manual" | "google" | "session"; // only "manual" is editable
  sessionId: UUID | null;          // source = "session"
}

// ───────── Shop & notifications ─────────

interface ShopItem {
  id: UUID;
  name: string;
  kind: "avatar" | "banner" | "streak_freeze";
  priceTokens: number;
  previewUrl: string | null;
  owned: number;                   // count owned (streak freezes stack; others 0 or 1)
}

interface Notification {
  id: UUID;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;    // ids for navigation, e.g. { sessionId }
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

type NotificationType =
  | "friend_request" | "friend_accepted" | "group_invite" | "session_invite"
  | "session_starting" | "session_settled" | "dispute_opened" | "milestone_reached";
```

## 6. Endpoints

`[paged]` = paginated (§3.4). All require auth unless marked **(public)**.

### 6.1 Health (public)

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/health/db` | `{ "status": "ok" }` |

### 6.2 Me & users

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/me` | — | `Me` or `404 profile_not_found` |
| POST | `/api/me` | `{ username, displayName, dateOfBirth }` | `201 Me`. Grants 100 `signup_bonus` tokens |
| PATCH | `/api/me` | `{ displayName?, avatarUrl?, equipped? }` | `Me` |
| GET | `/api/me/stats` | — | `UserStats` |
| GET | `/api/users?search=ali` | — | `{ items: UserSummary[] }` — username prefix match, max 20 |
| GET | `/api/users/{userId}` | — | `UserSummary` |
| GET | `/api/users/{userId}/stats` | — | `UserStats` (friends only, else 403; coin fields are 0 unless it's you) |

Username: 3–20 chars, `a–z`, `0–9`, `_`, stored lowercase, unique. Display name: 1–40 chars.

### 6.3 Friends

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/friends` | — | `{ items: Friend[] }` (includes live `status`) |
| GET | `/api/friends/requests` | — | `{ items: FriendRequest[] }` |
| POST | `/api/friends/requests` | `{ username }` | `201 FriendRequest`. If they already requested you, it auto-accepts and returns `200 Friend` |
| POST | `/api/friends/requests/{requestId}/accept` | — | `Friend` |
| DELETE | `/api/friends/requests/{requestId}` | — | `204` (decline or cancel) |
| DELETE | `/api/friends/{userId}` | — | `204` (unfriend) |

Study invites to friends are sent per group or per session (§6.4, §6.5).

### 6.4 Groups

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/groups` | — | `{ items: GroupSummary[] }` (my groups) |
| POST | `/api/groups` | `{ name, description? }` | `201 Group` (caller is owner) |
| GET | `/api/groups/{groupId}` | — | `Group` (members only) |
| PATCH | `/api/groups/{groupId}` | `{ name?, description? }` | `Group`. Owner/admin |
| DELETE | `/api/groups/{groupId}` | — | `204`. Owner, no active session |
| POST | `/api/groups/join` | `{ inviteCode }` | `Group` |
| POST | `/api/groups/{groupId}/invite-code` | — | `Group` with a new `inviteCode`. Owner/admin |
| POST | `/api/groups/{groupId}/invites` | `{ userId }` | `204`. Sends a `group_invite` notification containing the invite code. Any member, friends only |
| PATCH | `/api/groups/{groupId}/members/{userId}` | `{ role: "admin" \| "member" }` | `GroupMember`. Owner only |
| DELETE | `/api/groups/{groupId}/members/{userId}` | — | `204`. Owner/admin removes a member (not during their active session); or anyone removes themself (= leave). If the owner leaves, the oldest admin (else oldest member) becomes owner |
| GET | `/api/groups/{groupId}/sessions?scope=active` [paged] | — | `{ items: SessionSummary[], nextCursor }`. `scope`: `active` \| `scheduled` \| `past` |

**Permissions:** `owner` — everything, including roles. `admin` — edit group, regenerate invite code, remove members. `member` — create/join sessions, invite friends. Max 50 members per group. A group has at most **one active session** at a time (status not `settled`/`cancelled`).

### 6.5 Study sessions

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/groups/{groupId}/sessions` | `SessionConfig` | `201 StudySession`. Creator is host and first participant |
| GET | `/api/sessions?scope=active` [paged] | — | `{ items: SessionSummary[], nextCursor }` — sessions I'm in, across groups. `scope`: `active` \| `scheduled` \| `past` |
| GET | `/api/sessions/{sessionId}` | — | `StudySession` (group members) |
| PATCH | `/api/sessions/{sessionId}` | partial `SessionConfig` | `StudySession`. Host, `lobby` only. **Un-readies everyone** |
| DELETE | `/api/sessions/{sessionId}` | — | `204`. Host, `lobby` only → `cancelled` |
| POST | `/api/sessions/{sessionId}/join` | — | `StudySession`. Group members, `lobby` only |
| POST | `/api/sessions/{sessionId}/leave` | — | `204`. `lobby` only. If the host leaves, the earliest-joined participant becomes host; if nobody is left → `cancelled` |
| POST | `/api/sessions/{sessionId}/invites` | `{ userIds: UUID[] }` | `204`. Sends `session_invite` notifications to group members |
| PUT | `/api/sessions/{sessionId}/assessment-vote` | `AssessmentRule` | `StudySession`. `lobby` only; can change until start |
| POST | `/api/sessions/{sessionId}/ready` | `{ isReady: boolean }` | `StudySession` |
| POST | `/api/sessions/{sessionId}/start` | — | `StudySession` (now `studying`). Host only |
| POST | `/api/sessions/{sessionId}/extension-vote` | `{ extend: boolean }` | `StudySession`. `extension_vote` only, once |
| POST | `/api/sessions/{sessionId}/focus-events` | `{ state: "focused" \| "idle" \| "away", at }` | `204`. REST fallback for §8 when the WebSocket is down |

**Shared session to-dos** (participants; real-time via `session.todos` events):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/sessions/{sessionId}/todos` | — | `{ items: SessionTodo[] }` |
| POST | `/api/sessions/{sessionId}/todos` | `{ title }` | `201 SessionTodo` |
| PATCH | `/api/sessions/{sessionId}/todos/{todoId}` | `{ title?, isDone? }` | `SessionTodo` |
| DELETE | `/api/sessions/{sessionId}/todos/{todoId}` | — | `204` |

### 6.6 Materials

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/sessions/{sessionId}/materials` | multipart, field **`file`** | `201 Material`. `lobby` only |
| POST | `/api/sessions/{sessionId}/materials/text` | `{ title, text }` | `201 Material`. Pasted notes, ≤ 100,000 chars. `lobby` only |
| GET | `/api/sessions/{sessionId}/materials/{materialId}/content` | — | file bytes, or `text/plain` for pasted text (participants) |
| POST | `/api/sessions/{sessionId}/materials/{materialId}/approve` | `{ approved: boolean }` | `Material` |
| DELETE | `/api/sessions/{sessionId}/materials/{materialId}` | — | `204`. Uploader or host, `lobby` only |

Adding or deleting material **un-readies everyone**; the uploader auto-approves their own. Files: PDF, TXT, MD, DOCX, PPTX, max 20 MB each, max 10 materials per session. Text is extracted in the background (`textStatus`); scanned PDFs without text → `failed` (delete it or paste the text instead).

### 6.7 Quiz, review & results

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/sessions/{sessionId}/quiz/current` | — | `CurrentQuestion`. `quiz` only. First fetch of a question starts its timer |
| POST | `/api/sessions/{sessionId}/quiz/answers` | `{ questionId, optionId, text }` | `CurrentQuestion` (the next one). `409 question_expired` if late |
| GET | `/api/sessions/{sessionId}/review` | — | `{ participants: Participant[], questions: QuestionReview[] }`. `review` and `settled` |
| POST | `/api/sessions/{sessionId}/disputes` | `{ questionId, reason }` | `201 Dispute`. `review` only; one per question; opener's vote counts as `drop` |
| POST | `/api/sessions/{sessionId}/disputes/{disputeId}/vote` | `{ vote: "drop" \| "keep" }` | `Dispute`. Once per participant |
| POST | `/api/sessions/{sessionId}/review/done` | — | `204`. "I'm done reviewing" — review ends early when every participant is done |
| GET | `/api/sessions/{sessionId}/summary` | — | `SessionAiSummary`. `settled` only |

### 6.8 Wallet & money (adults only for coin features)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/wallet` | — | `Wallet` |
| GET | `/api/wallet/transactions?currency=coins` [paged] | — | `{ items: LedgerEntry[], nextCursor }`; `currency` optional |
| POST | `/api/wallet/checkout` | `{ coins: 500 \| 1000 \| 2000 \| 5000 }` | `{ checkoutUrl }`. Stripe **test mode** |
| POST | `/api/wallet/withdrawals` | `{ coins }` | `201 { id, coins, status: "pending" }`. Not actually paid out during the hackathon |
| POST | `/api/webhooks/stripe` **(public, Stripe signature)** | Stripe event | `200`. Credits coins on `checkout.session.completed` |

Buying coins: open `checkoutUrl` with `expo-web-browser`. Stripe redirects to `studystakes://wallet?checkout=success` (or `=cancelled`). Coins arrive via the webhook — refetch `GET /api/wallet` after the redirect (poll every 2 s for up to 20 s). Coins are the **escrow**: staking moves them into `lockedCoins` until settlement.

### 6.9 Leaderboards

| Method | Path | Response |
|---|---|---|
| GET | `/api/leaderboard?scope=friends&metric=weekly_study&groupId=` | `{ items: LeaderboardRow[], me: LeaderboardRow }` |

- `scope`: `friends` (me + accepted friends) \| `global` (top 100) \| `group` (requires `groupId`, members only).
- `metric`: `weekly_study` (minutes this week) \| `avg_score` (average quiz score, min 3 sessions) \| `tokens` (current balance).
- `wonFromMe` / `lostToMe` are filled only for `scope=friends` ("how much your friend made from you").
- `me` is always returned, even if outside the top 100.

### 6.10 Charities & donation receipts

| Method | Path | Response |
|---|---|---|
| GET | `/api/charities` **(public)** | `{ items: Charity[] }` — the approved list |
| GET | `/api/donations` [paged] | `{ items: Donation[], nextCursor }` — my receipts |
| GET | `/api/donations/{donationId}/badge.png` **(public)** | shareable PNG badge ("Alex donated €5.00 to Red Cross via Study Stakes") |
| GET | `/share/donations/{donationId}` **(public)** | small HTML page with the badge, for share links |

A `Donation` is created for each failed participant whose stake goes to charity (money mode).

### 6.11 To-dos (personal)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/todos?isDone=false&tag=exam&priority=high` | — | `{ items: Todo[] }` sorted by `dueAt` (nulls last), then priority, then `createdAt`. All filters optional |
| POST | `/api/todos` | `{ title, notes?, priority?, tags?, dueAt?, visibility?, subtasks?: { title }[] }` | `201 Todo` (defaults: `medium`, `private`) |
| PATCH | `/api/todos/{todoId}` | partial `{ title, notes, priority, tags, dueAt, isDone, visibility }` | `Todo` |
| DELETE | `/api/todos/{todoId}` | — | `204` |
| POST | `/api/todos/{todoId}/subtasks` | `{ title }` | `201 Subtask` |
| PATCH | `/api/todos/{todoId}/subtasks/{subtaskId}` | `{ title?, isDone? }` | `Subtask` |
| DELETE | `/api/todos/{todoId}/subtasks/{subtaskId}` | — | `204` |
| GET | `/api/users/{userId}/todos` | — | `{ items: Todo[] }` — a friend's `friends`-visible todos |

### 6.12 Calendar & Google

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/calendar/events?from=…&to=…` | — | `{ items: CalendarEvent[] }` — merged manual + Google + my scheduled/past sessions. Both params required, max 93 days |
| POST | `/api/calendar/events` | `{ title, kind, startsAt, endsAt?, allDay?, notes? }` | `201 CalendarEvent` (`source: "manual"`) |
| PATCH | `/api/calendar/events/{eventId}` | partial | `CalendarEvent` (manual only) |
| DELETE | `/api/calendar/events/{eventId}` | — | `204` (manual only) |
| POST | `/api/calendar/google/connect` | — | `{ authUrl }` — open in `expo-web-browser` |
| GET | `/api/calendar/google/callback` **(public, OAuth `state`)** | — | redirects to `studystakes://calendar?google=connected` (or `=error`) |
| DELETE | `/api/calendar/google` | — | `204` disconnect |

With Google connected: Google events are read live (not stored), and every session I join with a `scheduledFor` time is added to my Google Calendar with a **15-minute popup reminder**. The API also sends a `session_starting` notification 15 minutes before `scheduledFor`.

### 6.13 Shop

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/shop/items` | — | `{ items: ShopItem[] }` |
| POST | `/api/shop/items/{itemId}/purchase` | — | `ShopItem` (updated `owned`). Spends tokens (`shop_purchase`) |

Equip avatars/banners with `PATCH /api/me { equipped: { banner: "<itemId>" } }` (`null` to unequip). **Streak freezes** are used automatically: if a day passes without a settled session and you own one, it is consumed and the streak continues.

### 6.14 Notifications

| Method | Path | Response |
|---|---|---|
| GET | `/api/notifications?unreadOnly=true` [paged] | `{ items: Notification[], nextCursor }` |
| POST | `/api/notifications/read` | body `{ ids: UUID[] }` or `{ all: true }` → `204` |

New notifications are also pushed live over `/ws/me` (§8.1).

## 7. Session lifecycle (the core engine)

### 7.1 State machine

```
lobby ─start─► studying ─timer ends─► extension_vote ─┬─ extend (≤ maxExtensions) ─► studying
  │                                                   └─ don't extend ─► generating_quiz ─► quiz ─► grading ─► review ─► settled
  │                                                                            │
  └─ host cancels / everyone leaves ─► cancelled ◄── generation failed (after 2 retries; stakes refunded)
```

The **server** drives every transition after `start` (timers run on the backend). The frontend never assumes a transition — it reacts to `session.updated` events (§8.2) or refetches `GET /api/sessions/{id}`. If `maxExtensions` is reached, `extension_vote` is skipped.

### 7.2 Lobby (Phase A — configuration)

- Group members join the session; the host sets `SessionConfig` (duration, stake type and amount, payout destination, charity from the approved list).
- Anyone can add materials (upload or paste); every participant must approve every material.
- **Assessment vote** — each participant votes for one `AssessmentRule` (§7.3) with `PUT /assessment-vote`. The live tally is in `session.assessment.votes`.
- `POST /ready { isReady: true }` requires: the caller has voted, approved all materials, all materials have `textStatus: "ready"`, and has enough balance (`tokens ≥ stakeAmount`, or money mode: is adult and `coins ≥ stakeAmount`).
- Changing config, or adding/deleting a material, **un-readies everyone** so nobody is committed to terms they didn't see.
- `POST /start` (host) requires ≥ 2 participants, all ready, ≥ 1 material, all materials `approvedByAll`. Errors use `invalid_session_state` with a message saying what's missing.
- On start the server **resolves the assessment vote**: the `thresholdType` with the most votes wins; its `thresholdValue` is the median of the values voted for that type (rounded down). A tie between types is broken by a **coin flip** (`decidedBy: "coin_flip"`). Then it **locks every stake** (`stake` ledger entries) and sets `studyEndsAt = startedAt + studyMinutes`.

### 7.3 Assessment rules

| `thresholdType` | `thresholdValue` means | A participant's quiz passes if |
|---|---|---|
| `fixed` | pass mark, e.g. 75 | `quizScore ≥ thresholdValue` |
| `top_percent` | % of participants who pass, e.g. 50 | they're in the top `ceil(n × value / 100)` by score (min 1); anyone tied with the last passing score also passes |
| `relative_to_best` | max points behind the best, e.g. 15 | `quizScore ≥ bestScore − thresholdValue` |

A participant **passes** if their quiz passes **and** `focusPercent ≥ minFocusPercent`.

### 7.4 Studying (Phase B — focus block)

- Shared countdown: every client renders from the server's `studyEndsAt`.
- Clients report focus (§8.2). The server accumulates `focusedSeconds` / `unfocusedSeconds`. States: `focused` (app/tab active), `idle` (active but no interaction for 3 min — web only), `away` (app backgrounded / tab hidden), `offline` (no heartbeat for 45 s).
- Participants share a real-time to-do list (`/todos`, `session.todos` events).

### 7.5 Extension vote

At `studyEndsAt` (if `extension.used < maxExtensions`) the status becomes `extension_vote` for **30 seconds**. Each participant votes once; non-voters count as **no**. It ends early when everyone has voted.

- **2 participants:** extend only if **both** vote yes.
- **3+ participants:** extend if yes > no; if yes = no, a **coin flip** decides.

If extended: `studyEndsAt += extensionMinutes`, `extension.used += 1`, back to `studying`. Otherwise → `generating_quiz`.

### 7.6 Quiz (Phase C) & anti-cheat

- The AI (Gemini via OpenRouter) generates `quizQuestionCount` questions (5–10) from the extracted material text: ≈ 70% multiple choice, 30% short answer. All participants get the same questions **in the same order**.
- **One question at a time.** `GET /quiz/current` returns the next unanswered question; the first fetch starts its **20-second timer** (`deadline`). The answer must reach the server by `deadline + 2 s` grace, otherwise `409 question_expired` and the question scores 0 (the next `GET /quiz/current` moves on). No going back.
- **Tab-focus tracking:** the client keeps sending focus updates during the quiz. If the participant leaves the app/tab while a question is open, that question is **flagged and scores 0**; flags are visible to everyone in the review.
- `quizEndsAt = quizStartsAt + questions × 20 s + 2 min` is the hard cut-off. Unanswered questions score 0.
- When everyone has finished, or at `quizEndsAt` → `grading`. Multiple choice is graded exactly; short answers by the AI (score 0–1 + one-line feedback).

### 7.7 Review — disputes & nullification

- Status `review` lasts **3 minutes** (`reviewEndsAt`), or ends early once everyone calls `POST /review/done`.
- Everyone sees provisional results and every question with its correct answer.
- Any participant can **dispute** a question (one dispute per question). Other participants vote `drop` or `keep`.
- A question is **nullified** as soon as `dropVotes ≥ ceil(2/3 × participants)`. Nullified questions are removed from everyone's score; results are recomputed live (`session.updated`).
- Disputes still open at the end of review are `kept`.

### 7.8 Settlement (one DB transaction)

1. Final `quizScore` = average of non-nullified question scores × 100, rounded. Pass/fail per §7.3.
2. Every **winner** gets their own stake back (`stake_refund`).
3. Each **loser's** stake goes:
   - `payoutTarget = "winners"`: split among winners **in proportion to their quiz scores** (`winnings`, `counterparty` = the loser). Rounding uses the largest-remainder method so nothing is lost.
   - `payoutTarget = "charity"`: to the session's charity (`charity_donation` + a `Donation` receipt). Token stakes "donated" are burned.
4. **Nobody passes:** money → all stakes go to the charity; tokens → burned. **Everybody passes:** everyone just gets their stake back.
5. **Winner's bonus:** every winner gets `winner_bonus` tokens = `floor(focusedMinutes × 1.5)` — in money mode too, as compensation for Stripe fees that can't be returned.
6. Status → `settled`; send `session_settled` notifications; update streaks and milestones; generate the **AI session summary** (recap + concepts each participant missed), show it in-app and email it to each participant.

## 8. Realtime (WebSockets)

All messages are JSON: `{ "type": string, "data": object }`. The token goes in the query string because WebSockets can't send custom headers from browsers.

Close codes: `4401` bad/expired token (refresh and reconnect), `4403` not allowed, `4404` not found. On any other disconnect, reconnect with backoff (1 s, 2 s, 5 s, then every 10 s) and refetch the relevant REST resource.

Both sockets accept `{ "type": "ping" }` and reply `{ "type": "pong" }`. Send a ping **every 15 s**.

### 8.1 User socket — `/ws/me?token=…`

Open for the whole time the app is in the foreground. Being connected makes you `online` to friends.

| Server → client | `data` | When |
|---|---|---|
| `notification.created` | `Notification` | Any new notification |
| `friend.status` | `{ userId, status: UserStatus, currentSessionId }` | A friend goes online/offline/studying |
| `wallet.updated` | `Wallet` | Balance changed (stake locked, settlement, coin purchase) |

### 8.2 Session socket — `/ws/sessions/{sessionId}?token=…`

Open while a session screen is open (group members only).

| Server → client | `data` | When |
|---|---|---|
| `session.updated` | `StudySession` | On connect and after **any** change (join/leave, ready, config, materials, votes, status change, extension, quiz progress, disputes, results). The frontend replaces its state with this. |
| `participant.focus` | `{ userId, focus: FocusSummary }` | A participant's focus state changes, plus every 15 s during `studying` |
| `participant.presence` | `{ userId, presence }` | A participant connects/disconnects |
| `session.todos` | `{ items: SessionTodo[] }` | Shared to-do list changed |
| `error` | `{ code, message }` | Bad client message |

| Client → server | `data` | When |
|---|---|---|
| `focus.update` | `{ state: "focused" \| "idle" \| "away" }` | Immediately when the app/tab changes state during `studying` **and `quiz`** (Expo `AppState`: `active` = focused, else away; web: `visibilitychange` + 3 min without input = idle) |
| `ping` | `{}` | Every 15 s. **No ping for 45 s during `studying`/`quiz` counts as `offline`** |

If the socket is down, send `POST /api/sessions/{id}/focus-events` instead.

## 9. Screens → endpoints

| Screen | Uses |
|---|---|
| Login / register | Supabase (email, Google) → `GET /api/me` |
| Onboarding (age gate) | `POST /api/me` |
| Home | `GET /api/sessions?scope=active`, `GET /api/groups`, `/ws/me` |
| Profile & stats | `GET /api/me`, `/api/me/stats`, `/api/donations`, `PATCH /api/me` |
| Friends (leaderboard + money from friends) | `/api/friends*`, `GET /api/leaderboard?scope=friends`, `GET /api/users?search=` |
| Global leaderboard | `GET /api/leaderboard?scope=global` |
| Groups list / group hub | `/api/groups*`, `GET /api/leaderboard?scope=group`, group sessions |
| Session lobby | `GET/PATCH /api/sessions/{id}`, materials, assessment vote, ready, start, invites, `/ws/sessions/{id}` |
| Live session | focus over WS, session to-dos, extension vote |
| Quiz | `GET /quiz/current`, `POST /quiz/answers` |
| Review & results | `GET /review`, disputes, `review/done`, `GET /summary` |
| Wallet | `/api/wallet*` (adults: buy/withdraw coins) |
| To-do list | `/api/todos*` |
| Calendar | `/api/calendar/*` |
| Shop | `/api/shop/*` |
| Notifications | `/api/notifications*`, `/ws/me` |

## 10. Frontend integration checklist

- **One API client module** that prefixes the base URL, adds `Authorization` + `ngrok-skip-browser-warning`, parses the error shape (§3.5) into a typed error with `code`, and does the 401 refresh/retry (§4).
- Base URL from `EXPO_PUBLIC_API_URL`, never hard-coded.
- Generate TS types from `/openapi.json` (e.g. `openapi-typescript`) once endpoints exist; until then use §5.
- Switch on `error.code`, never on `message`.
- Display: tokens → `"1,250 tokens"`; coins → euros (`coins / 100` → `"€12.50"`).
- Hide everything money-related when `me.isAdult === false`.
- Uploads: `expo-document-picker` → `multipart/form-data`, field `file`.
- Deep links (scheme `studystakes`): `studystakes://groups/join/{inviteCode}`, `studystakes://sessions/{sessionId}`, `studystakes://wallet?checkout=success|cancelled`, `studystakes://calendar?google=connected|error`.
- Timers (study countdown, extension vote, quiz question, review) are always rendered from **server timestamps**, never local timers alone.
- Session screen: render by `session.status`; keep `/ws/sessions/{id}` open; report focus during `studying` and `quiz`.

## 11. Backend conventions (for building the API)

### 11.1 Layout

```
backend/
├── app/
│   ├── main.py            # app, CORS, error handlers, routers, startup recovery
│   ├── db.py              # engine, SessionLocal, Base, get_db
│   ├── config.py          # env vars
│   ├── auth.py            # Supabase JWT verification; get_current_user_id, get_current_user
│   ├── errors.py          # ApiError(status, code, message, details) + exception handlers
│   ├── models/            # SQLAlchemy tables, one file per area
│   ├── schemas/           # Pydantic request/response models (CamelModel base)
│   ├── routers/           # thin HTTP layer, one file per §6 section, plus ws.py
│   └── services/          # business logic: sessions (state machine), voting, quiz, grading,
│                          #   settlement, ledger, materials (extraction), ai (OpenRouter), stripe,
│                          #   google_calendar, email, realtime (socket manager), notifications, badges
├── alembic/
└── uploads/               # stored material files (gitignored)
```

### 11.2 Rules

- **Routers are thin**: parse input, call a service, return a schema.
- **Session status only changes inside `services/sessions.py`**, which also broadcasts `session.updated`.
- **All tokens/coins movements go through `services/ledger.py`**, in the same DB transaction as the action that caused them. Balances are `SUM(amount)` over `ledger_entries` — no mutable balance column. Lock the user row (`SELECT … FOR UPDATE`) before spending.
- **Coin flips** use `secrets.randbelow(2)` and are stored with the vote they decided.
- **Every route declares a `response_model`.** All schemas extend `CamelModel` (Pydantic `alias_generator=to_camel`, `populate_by_name=True`).
- Raise `ApiError(...)` for every expected error. FastAPI validation errors are converted to the §3.5 shape.
- IDs: `CHAR(36)` UUIDs generated server-side (`uuid4`), except `users.id` = Supabase `sub`.
- Times: stored as UTC `DATETIME(6)`, serialized with `Z`.
- Every schema change ships as an Alembic migration in the same commit.
- Background work (text extraction, quiz generation, grading, timers, summaries, emails, reminders) runs as asyncio tasks in the single process; on startup the server resumes any session whose timer has already passed.
- Quiz answers and correct answers are **never** serialized before `review`.

### 11.3 Tables

| Table | Key columns |
|---|---|
| `users` | id (Supabase sub), email, username (unique), display_name, date_of_birth, avatar_url, equipped_avatar_id, equipped_banner_id, created_at |
| `friendships` | id, requester_id, addressee_id, status (`pending`/`accepted`), created_at, accepted_at — unique pair |
| `groups` | id, name, description, invite_code (unique), owner_id, created_at |
| `group_members` | group_id, user_id, role, joined_at — unique pair |
| `sessions` | id, group_id, host_id, status, all `SessionConfig` columns, decided threshold_type/value, decided_by, extensions_used, timestamps |
| `session_participants` | session_id, user_id, is_ready, joined_at, focused_seconds, unfocused_seconds, quiz_score, flagged_count, passed, rank, payout, bonus_tokens, review_done — unique pair |
| `assessment_votes` | session_id, user_id, threshold_type, threshold_value — unique pair |
| `extension_votes` | session_id, round, user_id, extend — unique (session_id, round, user_id) |
| `materials` | id, session_id, uploaded_by, kind, title, mime_type, size_bytes, storage_path, extracted_text (LONGTEXT), text_status |
| `material_approvals` | material_id, user_id, approved — unique pair |
| `focus_events` | id, session_id, user_id, state, at |
| `session_todos` | id, session_id, title, created_by, is_done, completed_by, completed_at |
| `quiz_questions` | id, session_id, index, type, prompt, options (JSON), correct_option_id, model_answer, nullified |
| `quiz_answers` | id, session_id, user_id, question_id, served_at, deadline, answered_at, option_id, text, score, flagged, feedback — unique (user_id, question_id) |
| `disputes` | id, session_id, question_id (unique), opened_by, reason, outcome |
| `dispute_votes` | dispute_id, user_id, vote — unique pair |
| `session_summaries` | session_id, user_id, status, recap, missed_concepts (JSON), emailed_at |
| `ledger_entries` | id, user_id, currency, amount (signed BIGINT), type, session_id, counterparty_user_id, charity_id, stripe_ref, description, created_at |
| `payments` | id, user_id, stripe_session_id (unique), coins, amount_cents, status |
| `withdrawals` | id, user_id, coins, status |
| `charities` | id, name, description, logo_url, website_url, is_active |
| `donations` | id, user_id, charity_id, session_id, coins, created_at |
| `todos` | id, user_id, title, notes, priority, tags (JSON), due_at, is_done, completed_at, visibility |
| `subtasks` | id, todo_id, title, is_done, position |
| `calendar_events` | id, user_id, title, kind, starts_at, ends_at, all_day, notes |
| `google_accounts` | user_id, refresh_token (encrypted), calendar_id, connected_at |
| `shop_items` / `user_items` | catalogue / ownership with quantity |
| `streak_days` | user_id, day, source (`session`/`freeze`) — unique pair |
| `group_milestones` | group_id, milestone_id, achieved_at — unique pair |
| `notifications` | id, user_id, type, title, body, data (JSON), read_at, created_at |

### 11.4 Environment variables (`backend/.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `mysql+pymysql://user:pass@127.0.0.1:3306/hackathondb?charset=utf8mb4` |
| `CORS_ORIGINS` | Comma-separated web origins (Expo web: `http://localhost:8081`) |
| `PUBLIC_BASE_URL` | Public URL of the API (ngrok) — for badge/share links and OAuth callback |
| `SUPABASE_URL` | `https://<project>.supabase.co` — for JWKS |
| `OPENROUTER_API_KEY` | All AI calls |
| `QUIZ_MODEL` / `GRADING_MODEL` / `SUMMARY_MODEL` | OpenRouter model ids (quiz: a Gemini model) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Test-mode keys |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Calendar OAuth |
| `TOKEN_ENCRYPTION_KEY` | Encrypts Google refresh tokens |
| `RESEND_API_KEY`, `EMAIL_FROM` | Summary emails |
| `APP_SCHEME` | `studystakes` (deep links) |
| `UPLOAD_DIR` | Default `uploads` |

## 12. Enum reference

| Enum | Values |
|---|---|
| `SessionStatus` | `lobby`, `studying`, `extension_vote`, `generating_quiz`, `quiz`, `grading`, `review`, `settled`, `cancelled` |
| `SessionMode` | `tokens`, `money` |
| `ThresholdType` | `fixed`, `top_percent`, `relative_to_best` |
| `PayoutTarget` | `winners`, `charity` |
| `GroupRole` | `owner`, `admin`, `member` |
| `UserStatus` | `offline`, `online`, `studying` |
| `FocusState` | `focused`, `idle`, `away`, `offline` |
| `Presence` | `online`, `offline` |
| `QuestionType` | `multiple_choice`, `short_answer` |
| `MaterialKind` | `file`, `text` |
| `TextStatus` | `processing`, `ready`, `failed` |
| `DisputeVote` / `DisputeOutcome` | `drop`, `keep` / `open`, `nullified`, `kept` |
| `Currency` | `tokens`, `coins` |
| `LedgerEntryType` | `signup_bonus`, `stake`, `stake_refund`, `winnings`, `charity_donation`, `winner_bonus`, `purchase`, `withdrawal`, `shop_purchase`, `adjustment` |
| `LeaderboardScope` / `Metric` | `friends`, `global`, `group` / `weekly_study`, `avg_score`, `tokens` |
| `TodoPriority` / `TodoVisibility` | `low`, `medium`, `high` / `private`, `friends` |
| `CalendarKind` / `CalendarSource` | `assignment`, `exam`, `study_session`, `other` / `manual`, `google`, `session` |
| `ShopItemKind` | `avatar`, `banner`, `streak_freeze` |
| `NotificationType` | `friend_request`, `friend_accepted`, `group_invite`, `session_invite`, `session_starting`, `session_settled`, `dispute_opened`, `milestone_reached` |

## 13. Build order

Each phase leaves the frontend with something working end to end.

1. **Foundation** — errors, CamelModel, Supabase auth, `users`, `/api/me` + age-gate onboarding, `/api/users`.
2. **Groups** — create/join/invite code, members & roles, `/ws/me` presence.
3. **Session lobby** — create/join/leave, config, materials (upload + paste + extraction + approval), assessment vote, ready, `/ws/sessions`.
4. **Studying** — start, stake locking (tokens), focus tracking, shared to-dos, extension vote.
5. **Quiz → settlement** — AI generation, timed one-at-a-time quiz with anti-cheat, grading, review & disputes, settlement. *(Full game loop playable in token mode — demo-ready.)*
6. **Social** — friends with live status, notifications, wallet + transactions, leaderboards, stats, group milestones.
7. **Productivity** — personal to-dos with subtasks, calendar (manual), shop + streak freezes.
8. **Integrations** — AI session summaries + email, Google Calendar sync + reminders, charity receipts/badges.
9. **Money** — Stripe test-mode checkout + webhook, money sessions, withdrawals (stubbed).

> **Real money caveat:** holding users' money and paying it to other users based on outcomes can count as money transmission or gambling depending on jurisdiction, and Stripe requires Connect + identity verification for payouts. Keep money mode in Stripe test mode for the hackathon and pitch it as a future feature.
