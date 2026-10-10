// Response shapes from API_SPEC.md §5 (only what the current screens use).

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

export interface EquippedItems {
  avatar: UUID | null;
  banner: UUID | null;
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

export interface GroupDetail extends GroupSummary {
  inviteCode: string;
  members: GroupMember[];
}

export interface ListResponse<T> {
  items: T[];
}
