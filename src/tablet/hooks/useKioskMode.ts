import { useEffect, useRef } from 'react';

/**
 * Czy aplikacja działa jako zainstalowana powłoka (ekran początkowy /
 * standalone / fullscreen z manifestu)? Wtedy Fullscreen API jest zbędne —
 * i lepiej go NIE dotykać: warstwa fullscreen Safari ma własne gesty
 * systemowe (patrz niżej).
 */
function isInstalledStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Zachowania kioskowe:
 *  - Fullscreen API po pierwszym tapnięciu (i ponownie, gdyby ktoś wyszedł),
 *    ale tylko gdy aplikacja działa w karcie Safari — zainstalowana powłoka
 *    (manifest display: fullscreen) już jest pełnoekranowa,
 *  - blokada menu kontekstowego,
 *  - blokada pinch-zoom strony na iOS (Safari ignoruje user-scalable=no;
 *    przybliżona strona „pływa" pod palcem i uniemożliwia podpis).
 * Selekcja tekstu i overscroll są wyłączone w CSS.
 *
 * `suppressFullscreen` — na czas ekranu podpisu WYCHODZIMY z fullscreenu
 * Safari i nie wchodzimy ponownie. Warstwa fullscreen na iPadOS ma
 * SYSTEMOWY gest „przeciągnij, by wyjść": ruch palca po niescrollowalnej
 * treści łapie cały widok i przesuwa go jak okno. Gest działa na poziomie
 * natywnym (WebKit/UIKit) — preventDefault ani touch-action go nie blokują,
 * więc jedynym wyjściem jest brak warstwy fullscreen podczas rysowania.
 * Zainstalowanej powłoki to nie dotyczy (nie używa Fullscreen API).
 */
export function useKioskMode(suppressFullscreen: boolean): void {
  const suppressRef = useRef(suppressFullscreen);
  suppressRef.current = suppressFullscreen;

  // Wyjście z fullscreenu na czas ekranu podpisu (tylko tryb karty Safari).
  useEffect(() => {
    if (suppressFullscreen && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        // odmowa wyjścia — trudno, gest systemowy pozostaje ryzykiem
      });
    }
  }, [suppressFullscreen]);

  useEffect(() => {
    // Pole edycji (input/textarea/contenteditable) — samo lub jako aktualny
    // właściciel focusa. Żądanie fullscreenu podczas wpisywania tekstu
    // wywołuje na iPadOS walkę z klawiaturą ekranową: przejście w fullscreen
    // chowa klawiaturę, otwarcie klawiatury wybija z fullscreenu i każde
    // tapnięcie zaczyna cykl od nowa (ekran „skacze", nie da się pisać).
    const isEditable = (node: unknown): boolean =>
      node instanceof Element &&
      node.closest('input, textarea, [contenteditable]') !== null;

    // Fullscreen dopiero na pointerup (to też ważny gest aktywacji):
    // wejście w fullscreen na pointerdown przerywało trwający ruch palca
    // (pointercancel) i zmieniało rozmiar layoutu W TRAKCIE kreski podpisu.
    const onPointerUp = (event: PointerEvent) => {
      if (suppressRef.current || isInstalledStandalone()) return;
      if (isEditable(event.target) || isEditable(document.activeElement)) return;
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // przeglądarka odmówiła (np. brak gestu) — spróbujemy przy kolejnym tapnięciu
        });
      }
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    // Zdarzenia gesture* są specyficzne dla WebKit — jedyny skuteczny sposób
    // na wyłączenie natywnego pinch-zoomu strony na iPadzie. Pinch w PDF
    // obsługujemy sami w PdfViewer (touchmove), więc nic nie tracimy.
    const onGesture = (event: Event) => event.preventDefault();

    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('gesturestart', onGesture);
    window.addEventListener('gesturechange', onGesture);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('gesturechange', onGesture);
    };
  }, []);
}
