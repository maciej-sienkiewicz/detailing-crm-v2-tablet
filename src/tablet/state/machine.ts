import type { PendingSignatureRequest } from '../api/types';

/**
 * Maszyna stanów aplikacji tabletowej (czysty reducer — testowalny jednostkowo).
 *
 * UNPAIRED → CONNECTING → STANDBY → DOCUMENT_REVIEW → SIGNATURE_PAD → SUBMITTING
 *   → THANK_YOU → STANDBY (oraz gałęzie: DECLINED_INFO, ERROR_SCREEN, powroty).
 *   Gdy w kolejce czeka następny dokument, THANK_YOU przechodzi wprost
 *   w DOCUMENT_REVIEW (REQUEST_RECEIVED), z pominięciem STANDBY.
 *
 * Reducer trzyma wyłącznie metadane (request z challenge, hash hex, znaczniki
 * czasu). Bufor PDF i bitmapa podpisu żyją poza maszyną (DocumentStore /
 * canvas) i są niszczone przy każdym wyjściu z przepływu podpisu.
 */

export type AppState =
  | { name: 'UNPAIRED'; errorMessage: string | null }
  | { name: 'CONNECTING' }
  | { name: 'STANDBY'; notice: string | null }
  | {
      name: 'DOCUMENT_REVIEW';
      request: PendingSignatureRequest;
      /** Hash policzony na tablecie nad pobranymi bajtami; null = dokument w trakcie ładowania. */
      verifiedSha256: string | null;
      declarationAccepted: boolean;
      declarationAcceptedAt: string | null;
    }
  | {
      name: 'SIGNATURE_PAD';
      request: PendingSignatureRequest;
      verifiedSha256: string;
      declarationAcceptedAt: string;
    }
  | { name: 'SUBMITTING'; request: PendingSignatureRequest }
  | { name: 'THANK_YOU' }
  | { name: 'DECLINED_INFO' }
  | { name: 'ERROR_SCREEN'; message: string };

export type AppEvent =
  | { type: 'PAIR_SUCCESS' }
  | { type: 'PAIR_FAILURE'; message: string }
  | { type: 'CONTEXT_OK' }
  | { type: 'TOKEN_REJECTED'; message?: string }
  | { type: 'REQUEST_RECEIVED'; request: PendingSignatureRequest }
  | { type: 'DOCUMENT_VERIFIED'; sha256: string }
  | { type: 'DECLARATION_SET'; accepted: boolean; at: string | null }
  | { type: 'PROCEED_TO_SIGNATURE' }
  | { type: 'BACK_TO_DOCUMENT' }
  | { type: 'SUBMIT_STARTED' }
  | { type: 'SUBMIT_SUCCEEDED' }
  | { type: 'DECLINED' }
  | { type: 'REQUEST_FAILED'; message: string }
  | { type: 'REQUEST_CANCELLED'; requestId: string; notice: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'DISMISS' };

export const EXPIRED_NOTICE =
  'Sesja podpisu wygasła. Poproś pracownika o ponowne wysłanie dokumentu.';

export function initialState(hasStoredToken: boolean): AppState {
  return hasStoredToken ? { name: 'CONNECTING' } : { name: 'UNPAIRED', errorMessage: null };
}

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'PAIR_SUCCESS':
      return state.name === 'UNPAIRED' ? { name: 'CONNECTING' } : state;

    case 'PAIR_FAILURE':
      return state.name === 'UNPAIRED'
        ? { name: 'UNPAIRED', errorMessage: event.message }
        : state;

    case 'CONTEXT_OK':
      return state.name === 'CONNECTING' ? { name: 'STANDBY', notice: null } : state;

    case 'TOKEN_REJECTED':
      // Token odwołany/wygasły — z dowolnego stanu wracamy do parowania.
      return { name: 'UNPAIRED', errorMessage: event.message ?? null };

    case 'REQUEST_RECEIVED':
      // Wybudzenie z czuwania albo prosto z ekranu podziękowania — po podpisie
      // następny dokument z kolejki wchodzi bez powrotu do STANDBY i bez udziału
      // pracownika. Trwający przepływ (przegląd, podpis, submit) nie może zostać
      // wywłaszczony; DECLINED_INFO też nie — po odmowie klient najpierw widzi
      // jej potwierdzenie, a kolejny dokument dopiero ze STANDBY.
      return state.name === 'STANDBY' || state.name === 'THANK_YOU'
        ? {
            name: 'DOCUMENT_REVIEW',
            request: event.request,
            verifiedSha256: null,
            declarationAccepted: false,
            declarationAcceptedAt: null,
          }
        : state;

    case 'DOCUMENT_VERIFIED':
      return state.name === 'DOCUMENT_REVIEW' ? { ...state, verifiedSha256: event.sha256 } : state;

    case 'DECLARATION_SET':
      if (state.name !== 'DOCUMENT_REVIEW') return state;
      return {
        ...state,
        declarationAccepted: event.accepted,
        declarationAcceptedAt: event.accepted ? event.at : null,
      };

    case 'PROCEED_TO_SIGNATURE':
      if (
        state.name !== 'DOCUMENT_REVIEW' ||
        !state.declarationAccepted ||
        state.verifiedSha256 === null ||
        state.declarationAcceptedAt === null
      ) {
        return state;
      }
      return {
        name: 'SIGNATURE_PAD',
        request: state.request,
        verifiedSha256: state.verifiedSha256,
        declarationAcceptedAt: state.declarationAcceptedAt,
      };

    case 'BACK_TO_DOCUMENT':
      // Powrót do dokumentu — checkbox oświadczenia pozostaje zaznaczony.
      if (state.name !== 'SIGNATURE_PAD') return state;
      return {
        name: 'DOCUMENT_REVIEW',
        request: state.request,
        verifiedSha256: state.verifiedSha256,
        declarationAccepted: true,
        declarationAcceptedAt: state.declarationAcceptedAt,
      };

    case 'SUBMIT_STARTED':
      return state.name === 'SIGNATURE_PAD' ? { name: 'SUBMITTING', request: state.request } : state;

    case 'SUBMIT_SUCCEEDED':
      return state.name === 'SUBMITTING' ? { name: 'THANK_YOU' } : state;

    case 'DECLINED':
      return state.name === 'DOCUMENT_REVIEW' ? { name: 'DECLINED_INFO' } : state;

    case 'REQUEST_FAILED':
      return state.name === 'DOCUMENT_REVIEW' ||
        state.name === 'SIGNATURE_PAD' ||
        state.name === 'SUBMITTING'
        ? { name: 'ERROR_SCREEN', message: event.message }
        : state;

    case 'REQUEST_CANCELLED':
      // Dotyczy tylko aktualnie obsługiwanego żądania; w SUBMITTING czekamy na
      // wynik własnego submitu i nie pozwalamy się wywłaszczyć.
      if (
        (state.name === 'DOCUMENT_REVIEW' || state.name === 'SIGNATURE_PAD') &&
        state.request.requestId === event.requestId
      ) {
        return { name: 'STANDBY', notice: event.notice };
      }
      return state;

    case 'SESSION_EXPIRED':
      return state.name === 'DOCUMENT_REVIEW' || state.name === 'SIGNATURE_PAD'
        ? { name: 'STANDBY', notice: EXPIRED_NOTICE }
        : state;

    case 'DISMISS':
      return state.name === 'THANK_YOU' ||
        state.name === 'DECLINED_INFO' ||
        state.name === 'ERROR_SCREEN'
        ? { name: 'STANDBY', notice: null }
        : state;

    default:
      return state;
  }
}

/** Stany, w których w pamięci NIE może być bufora PDF, bitmapy podpisu ani challenge. */
export function isOutsideSignatureFlow(state: AppState): boolean {
  return (
    state.name === 'UNPAIRED' ||
    state.name === 'CONNECTING' ||
    state.name === 'STANDBY' ||
    state.name === 'THANK_YOU' ||
    state.name === 'DECLINED_INFO' ||
    state.name === 'ERROR_SCREEN'
  );
}
