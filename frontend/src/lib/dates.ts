// Date helpers. The API speaks UTC ISO strings; the UI works in the device's local time.

export const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
}

export function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local date + minutes after midnight → UTC ISO string for the API. */
export function atMinutes(day: Date, minutesAfterMidnight: number): string {
  const d = startOfDay(day);
  d.setMinutes(minutesAfterMidnight);
  return d.toISOString();
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatMinutesOfDay(minutes: number): string {
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return formatTime(d);
}

export function weekdayShort(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short' });
}

export function formatDayLabel(d: Date, today = new Date()): string {
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, addDays(today, 1))) return 'Tomorrow';
  if (sameDay(d, addDays(today, -1))) return 'Yesterday';
  const withinWeek = Math.abs(startOfDay(d).getTime() - startOfDay(today).getTime()) < 6 * DAY_MS;
  return withinWeek
    ? d.toLocaleDateString([], { weekday: 'long' })
    : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Due today 5:00 PM", "Overdue · Mon", "Due Fri 12 Oct". */
export function formatDue(iso: string, now = new Date()): { label: string; tone: 'overdue' | 'soon' | 'normal' } {
  const d = new Date(iso);
  const hasTime = !(d.getHours() === 23 && d.getMinutes() === 59);
  const time = hasTime ? ` ${formatTime(d)}` : '';
  if (d.getTime() < now.getTime()) return { label: `Overdue · ${formatDayLabel(d, now)}${time}`, tone: 'overdue' };
  const soon = d.getTime() - now.getTime() < DAY_MS;
  return { label: `${formatDayLabel(d, now)}${time}`, tone: soon ? 'soon' : 'normal' };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** 6×7 grid of dates for a month view, weeks starting Monday. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
