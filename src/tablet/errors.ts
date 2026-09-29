import { ApiError, NetworkError } from './api/client';

/**
 * Dokument, którego już nie ma po stronie serwera (404), którego sesja została
 * zamknięta (410) albo zakończona inaczej niż tym podpisem (409: anulowana przez
 * pracownika, odrzucona, protokół już nie czeka na podpis). Zgłoszenie z 29.09:
 * szkic wizyty anulowano w CRM, a klient przy podpisie jej protokołu dostawał
 * surowe „Wizyta nie została znaleziona" - zdanie dla pracownika i programisty,
 * nie dla klienta przy ladzie. Przy zerwanym WebSockecie ten sam przypadek kończy
 * się 409 „Żądanie podpisu zostało już zakończone (status: CANCELLED)" - wyszło
 * w pełnym teście tablet + backend (e2e-fullstack).
 */
export const DOCUMENT_GONE_MESSAGE =
  'Ten dokument nie jest już aktualny. Poproś pracownika o ponowne wysłanie dokumentu.';

const DOCUMENT_GONE_STATUSES = new Set([404, 409, 410]);

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (DOCUMENT_GONE_STATUSES.has(error.status)) return DOCUMENT_GONE_MESSAGE;
    return error.message;
  }
  if (error instanceof NetworkError) {
    return 'Błąd połączenia z serwerem. Nie ponawiaj — wezwij pracownika (stan sesji widać w CRM).';
  }
  return 'Wystąpił nieoczekiwany błąd. Wezwij pracownika recepcji.';
}
