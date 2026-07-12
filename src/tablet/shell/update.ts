/**
 * Wykrywanie nieaktualnej powłoki aplikacji (kiosk nigdy sam nie nawiguje,
 * więc bez tego mechanizmu nowa wersja mogłaby nie załadować się nigdy).
 *
 * Kontrakt: build wstrzykuje ten sam identyfikator w dwa miejsca —
 * do bundla (`__BUILD_ID__`) i do pliku `/version.json` na serwerze.
 * Rozjazd tych wartości oznacza, że serwer ma nowszą powłokę niż ta
 * załadowana na tablecie.
 *
 * Sam moduł jest czystą logiką (testowalną jednostkowo); harmonogram
 * sprawdzeń i warunek "tylko w STANDBY" żyją w hooks/useShellUpdate.ts.
 */

/** Identyfikator powłoki załadowanej na tablecie ('dev' poza buildem Vite). */
export const LOCAL_BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' && __BUILD_ID__ !== '' ? __BUILD_ID__ : 'dev';

/**
 * Guard przed pętlą przeładowań: gdy reload NIE przyniósł nowej powłoki
 * (np. tablet offline dostał powłokę z cache SW), do tej samej wersji
 * docelowej nie próbujemy drugi raz. sessionStorage przeżywa reload,
 * a znika przy zamknięciu karty — kolejna wersja znów dostanie jedną próbę.
 */
const RELOAD_ATTEMPT_KEY = 'detailboost.tablet.shellReloadAttempt';

/** Pobiera identyfikator builda z serwera; null = brak odpowiedzi/nieprawidłowa. */
export async function fetchServerBuildId(): Promise<string | null> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as { buildId?: unknown };
    return typeof data.buildId === 'string' && data.buildId !== '' ? data.buildId : null;
  } catch {
    // offline / błąd serwera / nie-JSON — sprawdzimy przy kolejnym cyklu
    return null;
  }
}

/** Czy serwer ma inną (nowszą) powłokę niż załadowana na tablecie. */
export function isUpdateAvailable(localBuildId: string, serverBuildId: string | null): boolean {
  return serverBuildId !== null && serverBuildId !== localBuildId;
}

/** Czy przeładowanie do tej wersji było już próbowane (i nie pomogło). */
export function wasReloadAttempted(serverBuildId: string): boolean {
  try {
    return sessionStorage.getItem(RELOAD_ATTEMPT_KEY) === serverBuildId;
  } catch {
    return false;
  }
}

export function markReloadAttempt(serverBuildId: string): void {
  try {
    sessionStorage.setItem(RELOAD_ATTEMPT_KEY, serverBuildId);
  } catch {
    // zablokowany storage — reload i tak się wykona, najwyżej bez guardu
  }
}

/** Twarde przeładowanie powłoki — index.html jest no-cache, więc pójdzie do sieci. */
export function reloadShell(): void {
  window.location.reload();
}
