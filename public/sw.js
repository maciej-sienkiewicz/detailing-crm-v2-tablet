/*
 * Service worker DetailBoost Tablet — cache WYŁĄCZNIE dla powłoki aplikacji.
 *
 * Twarda zasada bezpieczeństwa: żadna odpowiedź z /api/** ani /ws-registry/**
 * nie może trafić do cache (dokumenty PDF są serwowane z Cache-Control: no-store
 * i zawierają dane osobowe). Takie żądania w ogóle nie są przechwytywane.
 */

const SHELL_CACHE = 'detailboost-tablet-shell-v1';
const NEVER_CACHE = /^\/(api|ws-registry)(\/|$)/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Inne originy (backend API, WS) — nie dotykamy, przeglądarka obsłuży sama.
  if (url.origin !== self.location.origin) return;
  // API i WebSocket nigdy nie przechodzą przez cache.
  if (NEVER_CACHE.test(url.pathname)) return;

  // Nawigacja (app shell): network-first z fallbackiem do cache (praca offline).
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', response.clone());
          return response;
        } catch {
          const cached = await caches.match('/');
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Statyczne zasoby powłoki: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? Response.error();
    })(),
  );
});
