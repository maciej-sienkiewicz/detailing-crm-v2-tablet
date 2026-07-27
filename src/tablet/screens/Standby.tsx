import { useEffect, useRef, useState } from 'react';
import { factoryResetTablet } from '../api/reset';
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
 * Wejście serwisowe dla pracownika: RESET_TAP_COUNT szybkich tapnięć w logo
 * (okno RESET_TAP_WINDOW_MS) otwiera potwierdzenie rozparowania. Celowo bez
 * widocznego przycisku — klient zostający sam z tabletem nie może przypadkiem
 * (ani z ciekawości) wyczyścić urządzenia.
 */
const RESET_TAP_COUNT = 5;
const RESET_TAP_WINDOW_MS = 3_000;

/**
 * Tryb czuwania: czarny ekran (#000, OLED-friendly), duży zegar HH:MM
 * odświeżany raz na minutę, dyskretne logo i kropka statusu połączenia.
 */
export function Standby({ deviceName, wsConnected, notice }: StandbyProps) {
  const now = useMinuteClock();
  const online = useOnline();
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [resetting, setResetting] = useState(false);
  const tapsRef = useRef<number[]>([]);

  const handleLogoTap = () => {
    const cutoff = Date.now() - RESET_TAP_WINDOW_MS;
    tapsRef.current = [...tapsRef.current.filter((t) => t > cutoff), Date.now()];
    if (tapsRef.current.length >= RESET_TAP_COUNT) {
      tapsRef.current = [];
      setResetConfirmVisible(true);
    }
  };

  const handleReset = () => {
    setResetting(true);
    // factoryResetTablet czyści storage/cache/SW i przeładowuje na ekran
    // parowania; stan lokalny nie ma już znaczenia.
    void factoryResetTablet();
  };

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

      <img
        className="standby-car"
        src="/porsche.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          console.info('[standby] porsche.png załadowane OK', img.naturalWidth, 'x', img.naturalHeight);
        }}
        onError={async () => {
          try {
            const res = await fetch('/porsche.png', { cache: 'no-store' });
            const ct = res.headers.get('content-type') ?? '(brak)';
            console.error(
              `[standby] porsche.png błąd obrazka | HTTP ${res.status} | Content-Type: ${ct}`,
              ct.includes('text/html') ? '← serwer zwrócił HTML zamiast PNG (plik nie istnieje w build)' : '',
            );
          } catch (err) {
            console.error('[standby] porsche.png błąd obrazka | fetch nie powiódł się:', err);
          }
        }}
      />

      <div className="standby-footer">
        <span className="standby-logo" onClick={handleLogoTap}>
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

      {resetConfirmVisible && (
        <div className="reset-overlay" role="alertdialog" aria-label="Rozparowanie tabletu">
          <div className="reset-dialog">
            <h2 className="reset-title">Rozparować tablet?</h2>
            <p className="reset-text">
              Urządzenie <strong>{deviceName}</strong> zostanie wyczyszczone
              (parowanie, pamięć podręczna) i wróci do ekranu parowania.
              Do ponownego połączenia potrzebny będzie nowy kod z CRM.
            </p>
            <div className="reset-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setResetConfirmVisible(false)}
                disabled={resetting}
              >
                Anuluj
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? 'Czyszczenie…' : 'Wyczyść i rozparuj'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
