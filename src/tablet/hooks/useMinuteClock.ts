import { useEffect, useState } from 'react';

/**
 * Zegar aktualizowany raz na minutę, wyrównany do granicy minuty.
 * Celowo bez sekund i bez częstszych re-renderów — tryb czuwania ma
 * minimalizować pobór mocy i nagrzewanie tabletu (OLED, CPU idle).
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  }, []);

  return now;
}
