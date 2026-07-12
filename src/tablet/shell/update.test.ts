import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchServerBuildId,
  isUpdateAvailable,
  markReloadAttempt,
  reloadShell,
  wasReloadAttempted,
} from './update';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchServerBuildId', () => {
  it('zwraca buildId z poprawnej odpowiedzi i pomija cache przeglądarki', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'abc123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchServerBuildId()).resolves.toBe('abc123');
    expect(fetchMock).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
  });

  it('zwraca null przy odpowiedzi nie-2xx (np. 404 na starym deployu)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchServerBuildId()).resolves.toBeNull();
  });

  it('zwraca null przy błędzie sieci (tablet offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    await expect(fetchServerBuildId()).resolves.toBeNull();
  });

  it('zwraca null, gdy odpowiedź nie jest JSON-em (np. SPA fallback z HTML)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('unexpected token <')),
      }),
    );
    await expect(fetchServerBuildId()).resolves.toBeNull();
  });

  it('zwraca null przy nieprawidłowym kształcie payloadu', async () => {
    for (const payload of [{}, { buildId: '' }, { buildId: 42 }]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }),
      );
      await expect(fetchServerBuildId()).resolves.toBeNull();
    }
  });
});

describe('isUpdateAvailable', () => {
  it('brak odpowiedzi serwera → brak aktualizacji', () => {
    expect(isUpdateAvailable('abc', null)).toBe(false);
  });

  it('ta sama wersja → brak aktualizacji', () => {
    expect(isUpdateAvailable('abc', 'abc')).toBe(false);
  });

  it('inna wersja na serwerze → aktualizacja dostępna', () => {
    expect(isUpdateAvailable('abc', 'def')).toBe(true);
  });
});

describe('guard przed pętlą przeładowań (sessionStorage)', () => {
  function stubSessionStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    return store;
  }

  it('wersja bez wcześniejszej próby → można przeładować', () => {
    stubSessionStorage();
    expect(wasReloadAttempted('v2')).toBe(false);
  });

  it('po oznaczeniu próby ta sama wersja jest blokowana, ale nowsza już nie', () => {
    stubSessionStorage();
    markReloadAttempt('v2');
    expect(wasReloadAttempted('v2')).toBe(true);
    expect(wasReloadAttempted('v3')).toBe(false);
  });

  it('zablokowany sessionStorage nie wysadza logiki', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });
    expect(() => markReloadAttempt('v2')).not.toThrow();
    expect(wasReloadAttempted('v2')).toBe(false);
  });
});

describe('reloadShell', () => {
  it('wykonuje twarde przeładowanie strony', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    reloadShell();
    expect(reload).toHaveBeenCalledOnce();
  });
});
