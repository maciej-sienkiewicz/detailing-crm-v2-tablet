import { useEffect, useState } from 'react';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { useOnline } from '../hooks/useOnline';
import { LOCAL_BUILD_ID } from '../shell/update';

/**
 * Wersja powłoki widoczna w rogu ekranu czuwania — ten sam identyfikator,
 * który mechanizm samo-aktualizacji porównuje z /version.json na serwerze.
 * Po deployu wystarczy rzut oka na tablet, by potwierdzić nową wersję.
 * Pełny hash commita skracamy do 7 znaków (konwencja gita).
 */
const SHELL_VERSION = /^[0-9a-f]{40}$/i.test(LOCAL_BUILD_ID)
  ? LOCAL_BUILD_ID.slice(0, 7)
  : LOCAL_BUILD_ID;

interface StandbyProps {
  deviceName: string;
  wsConnected: boolean;
  notice: string | null;
}

const NOTICE_VISIBLE_MS = 10_000;

/**
 * Tryb czuwania: czarny ekran (#000, OLED-friendly), duży zegar HH:MM
 * odświeżany raz na minutę, dyskretne logo i kropka statusu połączenia.
 */
export function Standby({ deviceName, wsConnected, notice }: StandbyProps) {
  const now = useMinuteClock();
  const online = useOnline();
  const [noticeVisible, setNoticeVisible] = useState(false);

  useEffect(() => {
    if (!notice) {
      setNoticeVisible(false);
      return;
    }
    setNoticeVisible(true);
    const timer = setTimeout(() => setNoticeVisible(false), NOTICE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="screen standby-screen">
      {noticeVisible && notice && <div className="standby-notice">{notice}</div>}

      <div className="standby-center">
        <div className="standby-clock">{time}</div>
        <div className="standby-date">{date}</div>
      </div>

      <div className="standby-footer">
        <span className="standby-logo">
          DetailBoost
          <span className="standby-version" title="Wersja powłoki aplikacji">
            {SHELL_VERSION}
          </span>
        </span>
        <span className="standby-status">
          <span
            className={`status-dot ${wsConnected ? 'status-dot--connected' : 'status-dot--polling'}`}
            title={wsConnected ? 'Połączono' : 'Ponowne łączenie / polling'}
          />
          {deviceName}
        </span>
      </div>

      {!online && (
        <div className="offline-banner">Brak połączenia — próbuję ponownie…</div>
      )}
    </div>
  );
}
