/**
 * Konfiguracja środowiskowa aplikacji tabletowej.
 *
 * `VITE_API_BASE_URL` — bazowy adres backendu (prod: https://detailboost.pl).
 * Pusty string oznacza same-origin (używane w testach e2e z mockiem API).
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'https://detailboost.pl';

/**
 * Endpoint SockJS/STOMP. SockJS wymaga adresu absolutnego.
 *
 * WS idzie przez SAME ORIGIN (tablet.detailboost.pl/ws-registry), nie przez
 * API_BASE_URL (detailboost.pl). Nginx tabletu ma blok /ws-registry który
 * proxy'uje do backendu — dzięki temu SockJS handshake (/info) nie jest
 * cross-origin i nie trafia na blokadę CORS/Spring Security przed STOMP CONNECT.
 */
export function wsRegistryUrl(): string {
  return `${window.location.origin}/ws-registry`;
}

/** Ile ms pokazujemy ekran podziękowania / odmowy przed powrotem do czuwania. */
export const THANK_YOU_MS = 4000;

/** Interwał pollingu `pending`, gdy WebSocket jest rozłączony. */
export const PENDING_POLL_MS = 10_000;

/** Harmonogram backoffu reconnectu STOMP (ostatnia wartość powtarzana w nieskończoność). */
export const WS_RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10_000];

/** Minimalna łączna długość kreski (px CSS), by uznać podpis za niepusty. */
export const MIN_INK_LENGTH_PX = 60;

/** Jak często tablet sprawdza, czy na serwerze jest nowsza powłoka aplikacji. */
export const SHELL_VERSION_CHECK_MS = 15 * 60_000;

/**
 * Ile ms tablet musi nieprzerwanie stać w STANDBY, zanim wykona przeładowanie
 * do nowej wersji. Bufor na sytuację, gdy pracownik właśnie wysyła dokument —
 * przyjście żądania podpisu wychodzi ze STANDBY i anuluje przeładowanie.
 */
export const SHELL_RELOAD_GRACE_MS = 5_000;
