import { useEffect } from 'react';

/**
 * Zachowania kioskowe:
 *  - Fullscreen API po pierwszym tapnięciu (i ponownie, gdyby ktoś wyszedł),
 *  - blokada menu kontekstowego.
 * Selekcja tekstu i overscroll są wyłączone w CSS.
 */
export function useKioskMode(): void {
  useEffect(() => {
    const onPointerDown = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // przeglądarka odmówiła (np. brak gestu) — spróbujemy przy kolejnym tapnięciu
        });
      }
    };
    const onContextMenu = (event: Event) => event.preventDefault();

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}
