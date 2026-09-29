import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api/client';
import { DOCUMENT_GONE_MESSAGE, describeError } from './errors';

describe('describeError', () => {
  it('dokument usuniętej wizyty (404) - zdanie dla klienta, nie komunikat serwera', () => {
    expect(describeError(new ApiError(404, 'Wizyta nie została znaleziona'))).toBe(DOCUMENT_GONE_MESSAGE);
    expect(describeError(new ApiError(410, 'Sesja zamknięta'))).toBe(DOCUMENT_GONE_MESSAGE);
  });

  it('pozostałe błędy API zachowują komunikat serwera', () => {
    expect(describeError(new ApiError(409, 'Podpis został już złożony'))).toBe('Podpis został już złożony');
  });

  it('błąd sieci i nieznany', () => {
    expect(describeError(new NetworkError())).toMatch(/Błąd połączenia/);
    expect(describeError(new Error('x'))).toMatch(/nieoczekiwany/);
  });
});
