/**
 * Pełny reset urządzenia ("wyczyść i sparuj od nowa") — ostatnia deska ratunku,
 * gdy tablet wpadł w zapętlony błąd (np. przestarzała powłoka aplikacji w cache
 * po deployu, uszkodzony wpis parowania, nieaktualny service worker).
 *
 * Czyści KAŻDĄ warstwę lokalnego stanu, po czym twardo przeładowuje stronę:
 *  1. localStorage / sessionStorage — token parowania i wszelkie inne wpisy,
 *  2. Cache Storage — powłoka aplikacji cache'owana przez sw.js,
 *  3. rejestracje service workera — stary SW nie może dłużej serwować
 *     nieistniejących już (starych) assetów,
 *  4. `location.replace('/')` — świeży index.html z sieci; bez parowania
 *     aplikacja wystartuje na ekranie parowania.
 *
 * Każdy krok jest izolowany w try/catch — częściowa awaria (np. brak API
 * `caches` w starym WebView) nie może zatrzymać resetu.
 */
export async function factoryResetTablet(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // np. zablokowany storage — i tak przeładowujemy
  }
  try {
    sessionStorage.clear();
  } catch {
    // jw.
  }

  try {
    if ('caches' in globalThis) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // brak/awaria Cache Storage — nie blokuje resetu
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // brak/awaria SW — nie blokuje resetu
  }

  // replace() zamiast reload(): nie zostawiamy ekranu błędu w historii,
  // a nawigacja po odrejestrowaniu SW zawsze idzie do sieci.
  window.location.replace('/');
}
