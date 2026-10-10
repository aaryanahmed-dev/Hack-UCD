import type { AssessmentRule, SessionMode, SessionStatus } from '@/lib/types';

/** Tokens as "1,250 tokens"; coins (1 coin = €0.01) as "€12.50". */
export function formatAmount(amount: number, mode: SessionMode): string {
  if (mode === 'money') return `€${(amount / 100).toFixed(2)}`;
  return `${amount.toLocaleString()} ${amount === 1 ? 'token' : 'tokens'}`;
}

export function formatSigned(amount: number, mode: SessionMode): string {
  if (amount === 0) return mode === 'money' ? '€0.00' : '±0';
  return `${amount > 0 ? '+' : '−'}${formatAmount(Math.abs(amount), mode)}`;
}

export function describeRule(rule: AssessmentRule): string {
  switch (rule.thresholdType) {
    case 'fixed':
      return `Score ${rule.thresholdValue}% or more`;
    case 'top_percent':
      return `Top ${rule.thresholdValue}% pass`;
    case 'relative_to_best':
      return `Within ${rule.thresholdValue} points of the best`;
  }
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  lobby: 'Lobby',
  studying: 'Studying',
  extension_vote: 'Extension vote',
  generating_quiz: 'Writing quiz',
  quiz: 'Quiz',
  grading: 'Grading',
  review: 'Review',
  settled: 'Finished',
  cancelled: 'Cancelled',
};

export function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
