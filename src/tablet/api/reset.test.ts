import { afterEach, describe, expect, it, vi } from 'vitest';
import { factoryResetTablet } from './reset';

/** Stuby przeglądarkowych API — vitest działa w środowisku node. */
function stubBrowser({ cachesBroken = false } = {}) {
  const localStorageClear = vi.fn();
  const sessionStorageClear = vi.fn();
  const cacheDelete = vi.fn().mockResolvedValue(true);
  const unregister = vi.fn().mockResolvedValue(true);
  const replace = vi.fn();

  vi.stubGlobal('localStorage', { clear: localStorageClear });
  vi.stubGlobal('sessionStorage', { clear: sessionStorageClear });
  vi.stubGlobal('caches', {
    keys: cachesBroken
      ? vi.fn().mockRejectedValue(new Error('cache api broken'))
      : vi.fn().mockResolvedValue(['detailboost-tablet-shell-v1', 'inny-cache']),
    delete: cacheDelete,
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]),
    },
  });
  vi.stubGlobal('window', { location: { replace } });

  return { localStorageClear, sessionStorageClear, cacheDelete, unregister, replace };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('factoryResetTablet', () => {
  it('czyści storage, wszystkie cache i rejestracje SW, po czym przeładowuje na "/"', async () => {
    const stubs = stubBrowser();

    await factoryResetTablet();

    expect(stubs.localStorageClear).toHaveBeenCalledOnce();
    expect(stubs.sessionStorageClear).toHaveBeenCalledOnce();
    expect(stubs.cacheDelete).toHaveBeenCalledWith('detailboost-tablet-shell-v1');
    expect(stubs.cacheDelete).toHaveBeenCalledWith('inny-cache');
    expect(stubs.unregister).toHaveBeenCalledTimes(2);
    expect(stubs.replace).toHaveBeenCalledWith('/');
  });

  it('awaria jednej warstwy (Cache Storage) nie zatrzymuje resetu ani przeładowania', async () => {
    const stubs = stubBrowser({ cachesBroken: true });

    await factoryResetTablet();

    expect(stubs.localStorageClear).toHaveBeenCalledOnce();
    expect(stubs.unregister).toHaveBeenCalledTimes(2);
    expect(stubs.replace).toHaveBeenCalledWith('/');
  });
});
