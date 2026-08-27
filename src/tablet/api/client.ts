import { API_BASE_URL } from '../config';
import type {
  PairRequest,
  PairResponse,
  PendingSignatureRequest,
  SignatureResultResponse,
  SubmitSignatureRequest,
  TabletContext,
} from './types';

/** Błąd HTTP z API — `status` pozwala mapować na komunikaty i przejścia stanów. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Błąd sieci / timeout — brak odpowiedzi serwera (status nieznany). */
export class NetworkError extends Error {
  constructor(message = 'Błąd połączenia z serwerem') {
    super(message);
    this.name = 'NetworkError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Submit trwa dłużej — serwer scala PDF z podpisem i Kartą Podpisu, po czym wysyła go do S3. */
const SUBMIT_TIMEOUT_MS = 45_000;

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (token) headers['X-Tablet-Token'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new NetworkError();
    }

    console.debug(
      `[tablet-api] ${method} ${path} → ${response.status} | Content-Type: ${response.headers.get('content-type') ?? '(brak)'}`,
    );

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonUtf8<T>(response: Response): Promise<T> {
  const buffer = await response.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buffer)) as T;
}

/**
 * Naprawia mojibake powstały gdy bajty UTF-8 polskich znaków zostały zapisane
 * jako osobne znaki Latin-1 (np. 'ś' [U+015B] → 'Å' [U+00C5] + U+009B).
 *
 * Algorytm: jeśli string zawiera znaki w zakresie U+0080–U+00FF (Latin-1
 * extended), traktuje każdy znak jako jeden bajt i próbuje zdekodować
 * sekwencję jako UTF-8. Przy `fatal: true` błąd oznacza, że string był
 * poprawny (np. 'ó' U+00F3 generuje sekwencję 4-bajtową niemożliwą do
 * ukończenia w obrębie tekstu ASCII) — zwracamy wtedy oryginał bez zmian.
 */
function repairMojibake(str: string): string {
  if (!Array.from(str).some(c => c.charCodeAt(0) > 0x7f && c.charCodeAt(0) <= 0xff)) {
    return str;
  }
  try {
    const bytes = Uint8Array.from(str, c => c.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return str;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await parseJsonUtf8<{ message?: string }>(response);
    if (body && typeof body.message === 'string' && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // brak JSON w odpowiedzi — użyj komunikatu domyślnego
  }
  return `Błąd serwera (${response.status})`;
}

/** POST /api/tablet/pair — parowanie kodem 6-cyfrowym. */
export async function pairTablet(request: PairRequest): Promise<PairResponse> {
  const response = await apiFetch('/api/tablet/pair', { method: 'POST', body: request });
  return parseJsonUtf8<PairResponse>(response);
}

/** GET /api/tablet/context — walidacja tokenu przy starcie (przedłuża TTL). */
export async function getContext(token: string): Promise<TabletContext> {
  const response = await apiFetch('/api/tablet/context', { token });
  return parseJsonUtf8<TabletContext>(response);
}

/** Naprawa mojibake w treści oświadczenia — wspólna dla /pending i /queue. */
function repairRequestEncoding(request: PendingSignatureRequest): PendingSignatureRequest {
  return { ...request, declarationText: repairMojibake(request.declarationText) };
}

/**
 * GET /api/tablet/signature-requests/queue — pełna kolejka FIFO aktywnych żądań,
 * najstarsze pierwsze. Pozycja 0 to bieżący dokument; dalsze pozycje istnieją,
 * żeby tablet mógł pobrać ich bajty w tle, zanim klient skończy czytać pierwszy.
 *
 * Backend sprzed kolejki nie zna tego endpointu (404; powłoka tabletu
 * aktualizuje się sama, więc bywa nowsza niż backend) — każdy błąd HTTP
 * przechodzi w /pending, czyli kolejkę jednoelementową. To bezpieczna
 * degradacja także przy chwilowym 5xx: /pending niesie dokładnie ten dokument,
 * który ma być podpisany teraz, a kolejka to wyłącznie optymalizacja.
 * NetworkError NIE jest maskowany — bez sieci /pending poległby tak samo.
 */
export async function getSignatureQueue(token: string): Promise<PendingSignatureRequest[]> {
  let response: Response;
  try {
    response = await apiFetch('/api/tablet/signature-requests/queue', { token });
  } catch (error) {
    if (error instanceof ApiError) {
      const pending = await getPendingRequest(token);
      return pending ? [pending] : [];
    }
    throw error;
  }
  const result = await parseJsonUtf8<{ requests: PendingSignatureRequest[] }>(response);
  return result.requests.map(repairRequestEncoding);
}

/** GET /api/tablet/signature-requests/pending — 204 → null. */
export async function getPendingRequest(token: string): Promise<PendingSignatureRequest | null> {
  const response = await apiFetch('/api/tablet/signature-requests/pending', { token });
  if (response.status === 204) return null;

  const result = await parseJsonUtf8<PendingSignatureRequest>(response);
  const repairedDeclarationText = repairMojibake(result.declarationText);

  // ── Diagnostyka kodowania ─────────────────────────────────────────────────
  console.group('[tablet-api] /pending — diagnostyka kodowania');
  console.info('Content-Type:', response.headers.get('content-type') ?? '(brak)');

  const rawDt = result.declarationText;
  const wasRepaired = rawDt !== repairedDeclarationText;
  const latin1Chars = Array.from(rawDt).filter(c => c.charCodeAt(0) > 0x7f && c.charCodeAt(0) <= 0xff);
  const unicodeChars = Array.from(rawDt).filter(c => c.charCodeAt(0) > 0xff);
  const rawDiagnosis =
    unicodeChars.length > 0
      ? '✓ poprawne Unicode'
      : latin1Chars.length > 0
        ? '⚠ MOJIBAKE w bazie danych'
        : '— tylko ASCII';
  console.info(`declarationText z bazy [${rawDiagnosis}]:`, rawDt);
  if (wasRepaired) {
    console.info('declarationText po naprawie [✓ repairMojibake]:', repairedDeclarationText);
  }
  console.info(
    'Kody znaków z bazy (pierwsze 30):',
    Array.from(rawDt.slice(0, 30))
      .map(c => `'${c}'=U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      .join('  '),
  );
  console.groupEnd();
  // ─────────────────────────────────────────────────────────────────────────

  return { ...result, declarationText: repairedDeclarationText };
}

export interface DocumentPayload {
  /** Dokładne bajty PDF — te same, które hashujemy i renderujemy. */
  buffer: ArrayBuffer;
  /** Wartość nagłówka X-Document-Sha256 (lowercase) lub null, gdy brak. */
  headerSha256: string | null;
}

/**
 * GET /api/tablet/signature-requests/{id}/document — pobiera dokładne bajty PDF.
 *
 * Bez `prefetch` wywołanie zmienia status sesji na DISPLAYED po stronie
 * serwera — wywołuj dopiero, gdy dokument faktycznie będzie wyświetlony.
 * Z `prefetch: true` schodzą te same bajty, ale status zostaje nietknięty;
 * faktyczne wyświetlenie zgłasza wtedy [markDocumentDisplayed].
 */
export async function getDocument(
  token: string,
  requestId: string,
  options: { prefetch?: boolean } = {},
): Promise<DocumentPayload> {
  const suffix = options.prefetch ? '?prefetch=true' : '';
  const response = await apiFetch(
    `/api/tablet/signature-requests/${encodeURIComponent(requestId)}/document${suffix}`,
    { token, timeoutMs: 30_000 },
  );
  const headerSha256 = response.headers.get('X-Document-Sha256');
  const buffer = await response.arrayBuffer();
  return { buffer, headerSha256: headerSha256 ? headerSha256.toLowerCase() : null };
}

/**
 * POST /api/tablet/signature-requests/{id}/displayed — dokument pobrany
 * prefetchem właśnie pojawił się na ekranie. Idempotentny; w CRM dopiero to
 * wywołanie zapala status „klient widzi dokument".
 */
export async function markDocumentDisplayed(token: string, requestId: string): Promise<void> {
  await apiFetch(`/api/tablet/signature-requests/${encodeURIComponent(requestId)}/displayed`, {
    method: 'POST',
    token,
  });
}

/** POST /api/tablet/signature-requests/{id}/submit — jednorazowy (challenge!). Nie ponawiać. */
export async function submitSignature(
  token: string,
  requestId: string,
  payload: SubmitSignatureRequest,
): Promise<SignatureResultResponse> {
  const response = await apiFetch(
    `/api/tablet/signature-requests/${encodeURIComponent(requestId)}/submit`,
    { method: 'POST', token, body: payload, timeoutMs: SUBMIT_TIMEOUT_MS },
  );
  return parseJsonUtf8<SignatureResultResponse>(response);
}

/** POST /api/tablet/signature-requests/{id}/decline — odmowa podpisu. */
export async function declineSignature(
  token: string,
  requestId: string,
  reason?: string,
): Promise<SignatureResultResponse> {
  const response = await apiFetch(
    `/api/tablet/signature-requests/${encodeURIComponent(requestId)}/decline`,
    { method: 'POST', token, body: reason ? { reason } : {} },
  );
  return parseJsonUtf8<SignatureResultResponse>(response);
}
