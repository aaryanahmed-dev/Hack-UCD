// Response shapes from API_SPEC.md §5 (only what the current screens use).

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

export interface EquippedItems {
  avatar: string | null; // token store item id, e.g. "avatar-rocket"
  frame: string | null; // e.g. "frame-gold"
  banner: string | null;
}

export interface UserSummary {
  id: UUID;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  equipped: EquippedItems;
}

export interface Me extends UserSummary {
  email: string;
  dateOfBirth: ISODate;
  isAdult: boolean;
  googleCalendarConnected: boolean;
  idVerified: boolean;
  verificationRequired: boolean;
  createdAt: ISODateTime;
}

export interface UserStats {
  totalStudyMinutes: number;
  weeklyStudyMinutes: number;
  currentStreakDays: number;
  longestStreakDays: number;
  sessionsCompleted: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageQuizScore: number | null;
  averageFocusPercent: number | null;
  lifetimeTokensEarned: number;
  tokens: number;
  coinsWon: number;
  coinsDonated: number;
}

export type GroupRole = 'owner' | 'admin' | 'member';
export type UserStatus = 'offline' | 'online' | 'studying';

export interface GroupSummary {
  id: UUID;
  name: string;
  description: string | null;
  memberCount: number;
  myRole: GroupRole;
  activeSession: { id: UUID; status: string } | null;
  createdAt: ISODateTime;
}

export interface GroupMember {
  user: UserSummary;
  role: GroupRole;
  status: UserStatus;
  joinedAt: ISODateTime;
}

export interface Milestone {
  id: string;
  title: string;
  metric: 'focus_hours' | 'sessions_completed';
  target: number;
  progress: number;
  achievedAt: ISODateTime | null;
}

export interface GroupDetail extends GroupSummary {
  inviteCode: string;
  members: GroupMember[];
  stats: { totalFocusedMinutes: number; sessionsCompleted: number; averageQuizScore: number | null };
  milestones: Milestone[];
}

export interface ListResponse<T> {
  items: T[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ───────── Study sessions (API_SPEC §5) ─────────

export type SessionStatus =
  | 'lobby'
  | 'studying'
  | 'extension_vote'
  | 'generating_quiz'
  | 'quiz'
  | 'grading'
  | 'review'
  | 'settled'
  | 'cancelled';

export type SessionMode = 'tokens' | 'money';
export type PayoutTarget = 'winners' | 'charity';
export type ThresholdType = 'fixed' | 'top_percent' | 'relative_to_best';
export type FocusState = 'focused' | 'idle' | 'away' | 'offline';

export interface SessionConfig {
  title: string;
  mode: SessionMode;
  stakeAmount: number;
  payoutTarget: PayoutTarget;
  charityId: UUID | null;
  studyMinutes: number;
  extensionMinutes: number;
  maxExtensions: number;
  quizQuestionCount: number;
  minFocusPercent: number;
  maxParticipants: number;
  scheduledFor: ISODateTime | null;
}

export interface AssessmentRule {
  thresholdType: ThresholdType;
  thresholdValue: number;
}

export interface Charity {
  id: UUID;
  name: string;
  description: string;
  logoUrl: string | null;
  websiteUrl: string | null;
}

export interface FocusSummary {
  state: FocusState;
  focusedSeconds: number;
  unfocusedSeconds: number;
  focusPercent: number;
}

export interface QuizProgress {
  answered: number;
  total: number;
  flagged: number;
}

export interface ParticipantResult {
  quizScore: number;
  focusPercent: number;
  flaggedQuestions: number;
  passed: boolean;
  rank: number;
  stakeAmount: number;
  payout: number;
  netAmount: number;
  bonusTokens: number;
  final: boolean;
}

export interface Participant {
  user: UserSummary;
  isHost: boolean;
  isReady: boolean;
  joinedAt: ISODateTime;
  presence: 'online' | 'offline';
  hasVoted: boolean;
  wantsToFinish: boolean;
  focus: FocusSummary | null;
  quizProgress: QuizProgress | null;
  result: ParticipantResult | null;
}

export interface Material {
  id: UUID;
  kind: 'file' | 'text';
  title: string;
  mimeType: string | null;
  sizeBytes: number;
  uploadedBy: UserSummary;
  uploadedAt: ISODateTime;
  approvedBy: UUID[];
  approvedByAll: boolean;
  textStatus: 'processing' | 'ready' | 'failed';
}

export interface StudySession {
  id: UUID;
  group: { id: UUID; name: string };
  status: SessionStatus;
  host: UserSummary;
  config: SessionConfig;
  charity: Charity | null;
  participants: Participant[];
  materials: Material[];
  assessment: {
    votes: { rule: AssessmentRule; count: number }[];
    myVote: AssessmentRule | null;
    decided: AssessmentRule | null;
    decidedBy: 'vote' | 'coin_flip' | null;
  };
  extension: {
    used: number;
    vote: { endsAt: ISODateTime; yes: number; no: number; voted: number; myVote: boolean | null } | null;
    lastOutcome: { extended: boolean; decidedBy: 'vote' | 'coin_flip' } | null;
  };
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  studyEndsAt: ISODateTime | null;
  quizStartsAt: ISODateTime | null;
  quizEndsAt: ISODateTime | null;
  reviewEndsAt: ISODateTime | null;
  settledAt: ISODateTime | null;
  cancelReason: string | null;
  serverTime: ISODateTime;
  me: {
    isHost: boolean;
    isParticipant: boolean;
    isReady: boolean;
    quizProgress: QuizProgress | null;
    reviewDone: boolean;
    wantsToFinish: boolean;
  };
}

export interface SessionSummary {
  id: UUID;
  group: { id: UUID; name: string };
  title: string;
  status: SessionStatus;
  mode: SessionMode;
  stakeAmount: number;
  participantCount: number;
  scheduledFor: ISODateTime | null;
  startedAt: ISODateTime | null;
  settledAt: ISODateTime | null;
  myResult: { passed: boolean; netAmount: number } | null;
}

export interface SessionTodo {
  id: UUID;
  title: string;
  createdBy: UserSummary;
  isDone: boolean;
  completedBy: UserSummary | null;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface QuizQuestion {
  id: UUID;
  index: number;
  type: 'multiple_choice' | 'short_answer';
  prompt: string;
  options: { id: string; text: string }[] | null;
  timeLimitSeconds: number;
}

export interface CurrentQuestion {
  question: QuizQuestion | null;
  number: number;
  total: number;
  deadline: ISODateTime | null;
  serverTime: ISODateTime;
}

export interface Dispute {
  id: UUID;
  questionId: UUID;
  openedBy: UserSummary;
  reason: string;
  dropVotes: number;
  keepVotes: number;
  votesNeeded: number;
  myVote: 'drop' | 'keep' | null;
  outcome: 'open' | 'nullified' | 'kept';
}

export interface QuestionReview {
  question: QuizQuestion;
  correctOptionId: string | null;
  modelAnswer: string | null;
  myAnswer: { optionId: string | null; text: string | null } | null;
  myScore: number;
  flagged: boolean;
  expired: boolean;
  feedback: string | null;
  nullified: boolean;
  dispute: Dispute | null;
}

export interface Review {
  participants: Participant[];
  questions: QuestionReview[];
}

// ───────── Social (API_SPEC §6.3, §6.9, §6.14) ─────────

export interface Friend {
  user: UserSummary;
  status: UserStatus;
  currentSessionId: UUID | null;
  since: ISODateTime;
}

export interface FriendRequest {
  id: UUID;
  user: UserSummary;
  direction: 'incoming' | 'outgoing';
  createdAt: ISODateTime;
}

export interface AppNotification {
  id: UUID;
  type: string; // friend_request | friend_accepted | group_invite | session_invite | session_starting | session_settled
  title: string;
  body: string;
  data: Record<string, string>;
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export type LeaderboardScope = 'friends' | 'global' | 'group';
export type LeaderboardMetric = 'weekly_study' | 'avg_score' | 'tokens';

export interface Amounts {
  tokens: number;
  coins: number;
}

export interface LeaderboardRow {
  rank: number | null;
  user: UserSummary;
  value: number | null;
  weeklyStudyMinutes: number;
  averageQuizScore: number | null;
  tokens: number;
  sessionsCompleted: number;
  wonFromMe: Amounts | null;
  lostToMe: Amounts | null;
}

export interface ActivityDay {
  date: ISODate;
  studyMinutes: number;
  sessions: number;
  todosCompleted: number;
}

// ───────── Productivity (API_SPEC §6.11, §6.12) ─────────

export type Priority = 'low' | 'medium' | 'high';

export interface Subtask {
  id: UUID;
  title: string;
  isDone: boolean;
}

export interface Todo {
  id: UUID;
  title: string;
  notes: string | null;
  priority: Priority;
  tags: string[];
  dueAt: ISODateTime | null;
  isDone: boolean;
  completedAt: ISODateTime | null;
  visibility: 'private' | 'friends';
  subtasks: Subtask[];
  createdAt: ISODateTime;
}

export type EventKind = 'assignment' | 'exam' | 'study_session' | 'other';

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  startsAt: ISODateTime;
  endsAt: ISODateTime | null;
  allDay: boolean;
  notes: string | null;
  source: 'manual' | 'google' | 'session';
  sessionId: UUID | null;
  groupName: string | null;
  htmlLink: string | null;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
}

// ───────── Wallet, payments, verification, store ─────────

export interface CoinPack {
  coins: number;
  amountCents: number;
  currency: string;
  label: string;
}

export interface Wallet {
  tokens: number;
  coins: number;
  lockedTokens: number;
  lockedCoins: number;
  paymentsConfigured: boolean;
  packs: CoinPack[];
}

export interface LedgerEntry {
  id: UUID;
  currency: 'tokens' | 'coins';
  amount: number;
  type: string;
  sessionId: UUID | null;
  counterparty: UserSummary | null;
  description: string;
  createdAt: ISODateTime;
}

export interface Payment {
  id: UUID;
  coins: number;
  amountCents: number;
  currency: string;
  status: 'pending' | 'paid' | 'expired';
  createdAt: ISODateTime;
  paidAt: ISODateTime | null;
}

export interface Verification {
  required: boolean;
  verified: boolean;
  status: 'not_required' | 'unverified' | 'pending' | 'declined' | 'verified';
  verifiedAt: ISODateTime | null;
}

export interface ShopItem {
  id: string;
  kind: 'avatar' | 'frame' | 'streak_freeze';
  name: string;
  description: string;
  priceTokens: number;
  data: Record<string, string>;
  owned: number;
  equipped: boolean;
}
