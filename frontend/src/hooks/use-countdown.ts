import { useEffect, useState } from 'react';

/** Milliseconds left until `target` (ISO), using the server clock offset. Re-renders every `tickMs`. */
export function useCountdown(target: string | null | undefined, clockOffset: number, tickMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [target, tickMs]);
  if (!target) return 0;
  return Math.max(0, new Date(target).getTime() - (now + clockOffset));
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
