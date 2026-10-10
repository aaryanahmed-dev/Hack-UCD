import type { Href } from 'expo-router';

import type { AppNotification } from './types';

/** Where tapping a notification should take you. */
export function notificationHref(n: AppNotification): Href {
  switch (n.type) {
    case 'coins_purchased':
      return '/wallet';
    case 'friend_request':
    case 'friend_accepted':
      return '/friends';
    case 'session_invite':
    case 'session_starting':
    case 'session_settled':
      return n.data.sessionId ? `/sessions/${n.data.sessionId}` : '/notifications';
    default:
      return '/notifications';
  }
}

export const NOTIFICATION_ICON: Record<string, 'person-add' | 'people' | 'enter' | 'time' | 'trophy' | 'notifications' | 'wallet'> = {
  coins_purchased: 'wallet',
  friend_request: 'person-add',
  friend_accepted: 'people',
  group_invite: 'enter',
  session_invite: 'enter',
  session_starting: 'time',
  session_settled: 'trophy',
};
