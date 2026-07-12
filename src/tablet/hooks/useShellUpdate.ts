import { useCallback, useEffect, useState } from 'react';
import { SHELL_RELOAD_GRACE_MS, SHELL_VERSION_CHECK_MS } from '../config';
import {
  LOCAL_BUILD_ID,
  fetchServerBuildId,
  isUpdateAvailable,
  markReloadAttempt,
  reloadShell,
  wasReloadAttempted,
} from '../shell/update';

/**
 * Samo-aktualizacja powłoki kiosku — WYŁĄCZNIE w trybie czuwania.
 *
 * Sprawdzenie wersji: przy starcie, co SHELL_VERSION_CHECK_MS oraz po każdym
 * ponownym połączeniu WS (deploy zwykle restartuje też backend, więc reconnect
 * to naturalny sygnał "coś się wydarzyło").
 *
 * Przeładowanie: dopiero gdy `readyToReload` (STANDBY) utrzymuje się
 * nieprzerwanie przez SHELL_RELOAD_GRACE_MS. Każde wyjście ze STANDBY —
 * np. żądanie podpisu, które właśnie przyszło — anuluje zaplanowany reload;
 * klient w trakcie przeglądania dokumentu lub podpisywania nigdy nie
 * zobaczy restartu aplikacji.
 */
export function useShellUpdate(wsConnected: boolean, readyToReload: boolean): void {
  const [pendingBuildId, setPendingBuildId] = useState<string | null>(null);

  const check = useCallback(async () => {
    const serverBuildId = await fetchServerBuildId();
    if (
      serverBuildId !== null &&
      isUpdateAvailable(LOCAL_BUILD_ID, serverBuildId) &&
      !wasReloadAttempted(serverBuildId)
    ) {
      setPendingBuildId(serverBuildId);
    }
  }, []);

  // Start + cykliczne sprawdzanie.
  useEffect(() => {
    void check();
    const interval = setInterval(() => void check(), SHELL_VERSION_CHECK_MS);
    return () => clearInterval(interval);
  }, [check]);

  // Dodatkowe sprawdzenie po każdym odzyskaniu połączenia WS.
  useEffect(() => {
    if (wsConnected) void check();
  }, [wsConnected, check]);

  // Reload odroczony o okres karencji; cleanup anuluje go przy wyjściu ze STANDBY.
  useEffect(() => {
    if (pendingBuildId === null || !readyToReload) return;
    const timer = setTimeout(() => {
      markReloadAttempt(pendingBuildId);
      reloadShell();
    }, SHELL_RELOAD_GRACE_MS);
    return () => clearTimeout(timer);
  }, [pendingBuildId, readyToReload]);
}
