import { ApiError, NetworkError } from './api/client';

/**
 * Dokument, którego już nie ma po stronie serwera (404) albo którego sesja
 * została zamknięta (410). Zgłoszenie z 29.09: szkic wizyty anulowano w CRM,
 * a klient przy podpisie jej protokołu dostawał surowe „Wizyta nie została
 * znaleziona" - zdanie dla pracownika i programisty, nie dla klienta przy ladzie.
 */
export const DOCUMENT_GONE_MESSAGE =
  'Ten dokument nie jest już aktualny. Poproś pracownika o ponowne wysłanie dokumentu.';

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 410) return DOCUMENT_GONE_MESSAGE;
    return error.message;
  }
  if (error instanceof NetworkError) {
    return 'Błąd połączenia z serwerem. Nie ponawiaj — wezwij pracownika (stan sesji widać w CRM).';
  }
  return 'Wystąpił nieoczekiwany błąd. Wezwij pracownika recepcji.';
}
