import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api/client';
import { DOCUMENT_GONE_MESSAGE, describeError } from './errors';

describe('describeError', () => {
  it('dokument usuniętej wizyty (404) - zdanie dla klienta, nie komunikat serwera', () => {
    expect(describeError(new ApiError(404, 'Wizyta nie została znaleziona'))).toBe(DOCUMENT_GONE_MESSAGE);
    expect(describeError(new ApiError(410, 'Sesja zamknięta'))).toBe(DOCUMENT_GONE_MESSAGE);
  });

  it('dokument anulowany przez pracownika (409) - też zdanie dla klienta', () => {
    expect(
      describeError(new ApiError(409, 'Żądanie podpisu zostało już zakończone (status: CANCELLED)')),
    ).toBe(DOCUMENT_GONE_MESSAGE);
  });

  it('pozostałe błędy API zachowują komunikat serwera', () => {
    // Te komunikaty serwer pisze już dla klienta.
    expect(
      describeError(new ApiError(400, 'Żądanie podpisu wygasło — poproś pracownika o ponowne wysłanie dokumentu')),
    ).toBe('Żądanie podpisu wygasło — poproś pracownika o ponowne wysłanie dokumentu');
  });

  it('błąd sieci i nieznany', () => {
    expect(describeError(new NetworkError())).toMatch(/Błąd połączenia/);
    expect(describeError(new Error('x'))).toMatch(/nieoczekiwany/);
  });
});
