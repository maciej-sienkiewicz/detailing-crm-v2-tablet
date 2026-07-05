import { useEffect } from 'react';

/**
 * Screen Wake Lock — ekran tabletu nie może zgasnąć w trybie kiosku.
 * Re-akwizycja po powrocie karty do widoczności (system zwalnia lock
 * przy każdym ukryciu strony).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // odmowa (np. oszczędzanie baterii) — spróbujemy przy następnej okazji
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
