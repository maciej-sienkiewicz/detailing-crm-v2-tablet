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
/** Submit trwa dłużej — serwer scala PDF i nakłada pieczęć (2–8 s). */
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

/**
 * Wymuszamy dekodowanie UTF-8 niezależnie od charset w Content-Type.
 * Niektóre WebView na tabletach błędnie respektują charset=ISO-8859-1
 * z nagłówka odpowiedzi zamiast zawsze używać UTF-8 (wymaganego przez
 * specyfikację Fetch dla response.json()), co powoduje mojibake w polskich
 * znakach.
 */
async function parseJsonUtf8<T>(response: Response): Promise<T> {
  const buffer = await response.arrayBuffer();
  return JSON.parse(new TextDecoder('utf-8').decode(buffer)) as T;
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

/** GET /api/tablet/signature-requests/pending — 204 → null. */
export async function getPendingRequest(token: string): Promise<PendingSignatureRequest | null> {
  const response = await apiFetch('/api/tablet/signature-requests/pending', { token });
  if (response.status === 204) return null;

  // Klon zanim ciało zostanie skonsumowane — pozwala odczytać je dwukrotnie.
  const diagClone = response.clone();
  const result = await parseJsonUtf8<PendingSignatureRequest>(response);

  // ── Diagnostyka kodowania ──────────────────────────────────────────────────
  // response.text() respektuje charset z Content-Type (może dać mojibake).
  // parseJsonUtf8 powyżej wymusiło UTF-8 przez arrayBuffer()+TextDecoder.
  // Porównanie obu wartości ujawnia czy przeglądarka błędnie interpretuje charset.
  const browserRawText = await diagClone.text();
  console.group('[tablet-api] /pending — diagnostyka kodowania');
  console.info('Content-Type:', diagClone.headers.get('content-type') ?? '(brak)');
  console.info('Ciało (response.text — charset z nagłówka):', browserRawText.slice(0, 400));

  const dt = result.declarationText;
  const latin1Chars = Array.from(dt).filter(c => c.charCodeAt(0) > 0x7f && c.charCodeAt(0) <= 0x00ff);
  const unicodeChars = Array.from(dt).filter(c => c.charCodeAt(0) > 0x00ff);
  const diagnosis =
    unicodeChars.length > 0
      ? '✓ poprawne Unicode (znaki polskie > U+00FF)'
      : latin1Chars.length > 0
        ? '⚠ MOJIBAKE — znaki polskie w zakresie Latin-1 (≤ U+00FF)'
        : '— tylko ASCII, nie można określić';
  console.info(`declarationText [${diagnosis}]:`, dt);
  console.info(
    'Kody znaków (pierwsze 30):',
    Array.from(dt.slice(0, 30))
      .map(c => `'${c}'=U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      .join('  '),
  );
  console.groupEnd();
  // ─────────────────────────────────────────────────────────────────────────

  return result;
}

export interface DocumentPayload {
  /** Dokładne bajty PDF — te same, które hashujemy i renderujemy. */
  buffer: ArrayBuffer;
  /** Wartość nagłówka X-Document-Sha256 (lowercase) lub null, gdy brak. */
  headerSha256: string | null;
}

/**
 * GET /api/tablet/signature-requests/{id}/document — pobiera dokładne bajty PDF.
 * Uwaga: to wywołanie zmienia status sesji na DISPLAYED po stronie serwera —
 * wywołuj dopiero, gdy dokument faktycznie będzie wyświetlony.
 */
export async function getDocument(token: string, requestId: string): Promise<DocumentPayload> {
  const response = await apiFetch(
    `/api/tablet/signature-requests/${encodeURIComponent(requestId)}/document`,
    { token, timeoutMs: 30_000 },
  );
  const headerSha256 = response.headers.get('X-Document-Sha256');
  const buffer = await response.arrayBuffer();
  return { buffer, headerSha256: headerSha256 ? headerSha256.toLowerCase() : null };
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
