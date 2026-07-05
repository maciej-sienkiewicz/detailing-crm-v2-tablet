import { useEffect, useState } from 'react';

interface CountdownProps {
  /** ISO timestamp końca ważności sesji podpisu. */
  expiresAt: string;
}

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

/** Licznik ważności sesji (mm:ss); poniżej minuty zmienia kolor na ostrzegawczy. */
export function Countdown({ expiresAt }: CountdownProps) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(expiresAt));

  useEffect(() => {
    setSeconds(remainingSeconds(expiresAt));
    const timer = setInterval(() => setSeconds(remainingSeconds(expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <span className={`countdown${seconds < 60 ? ' countdown--warning' : ''}`}>
      {mm}:{ss}
    </span>
  );
}
