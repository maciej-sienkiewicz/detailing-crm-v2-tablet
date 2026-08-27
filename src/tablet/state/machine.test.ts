import { describe, expect, it } from 'vitest';
import type { PendingSignatureRequest } from '../api/types';
import {
  EXPIRED_NOTICE,
  initialState,
  isOutsideSignatureFlow,
  reduce,
  type AppState,
} from './machine';

const request: PendingSignatureRequest = {
  requestId: 'req-1',
  documentName: 'Protokół przyjęcia pojazdu',
  signerName: 'Jan Kowalski',
  declarationText: 'Oświadczam, że zapoznałem się z treścią dokumentu.',
  documentSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  challenge: 'nonce-1',
  expiresAt: '2026-07-05T12:34:56Z',
  documentUrl: '/api/tablet/signature-requests/req-1/document',
};

const SHA = 'a'.repeat(64);
const ACCEPTED_AT = '2026-07-05T12:31:07Z';

function standby(): AppState {
  return { name: 'STANDBY', notice: null };
}

function reviewReady(): AppState {
  let state = reduce(standby(), { type: 'REQUEST_RECEIVED', request });
  state = reduce(state, { type: 'DOCUMENT_VERIFIED', sha256: SHA });
  return state;
}

function signaturePad(): AppState {
  let state = reviewReady();
  state = reduce(state, { type: 'DECLARATION_SET', accepted: true, at: ACCEPTED_AT });
  return reduce(state, { type: 'PROCEED_TO_SIGNATURE' });
}

describe('initialState', () => {
  it('bez tokenu startuje w UNPAIRED', () => {
    expect(initialState(false)).toEqual({ name: 'UNPAIRED', errorMessage: null });
  });

  it('z tokenem startuje w CONNECTING (auto-reconnect)', () => {
    expect(initialState(true)).toEqual({ name: 'CONNECTING' });
  });
});

describe('parowanie', () => {
  it('PAIR_SUCCESS → CONNECTING → CONTEXT_OK → STANDBY', () => {
    let state = initialState(false);
    state = reduce(state, { type: 'PAIR_SUCCESS' });
    expect(state.name).toBe('CONNECTING');
    state = reduce(state, { type: 'CONTEXT_OK' });
    expect(state).toEqual({ name: 'STANDBY', notice: null });
  });

  it('PAIR_FAILURE ustawia komunikat i zostaje w UNPAIRED', () => {
    const state = reduce(initialState(false), {
      type: 'PAIR_FAILURE',
      message: 'Nieprawidłowy lub wygasły kod — wygeneruj nowy w CRM',
    });
    expect(state).toEqual({
      name: 'UNPAIRED',
      errorMessage: 'Nieprawidłowy lub wygasły kod — wygeneruj nowy w CRM',
    });
  });

  it('TOKEN_REJECTED z dowolnego stanu wraca do UNPAIRED', () => {
    expect(reduce({ name: 'CONNECTING' }, { type: 'TOKEN_REJECTED' }).name).toBe('UNPAIRED');
    expect(reduce(standby(), { type: 'TOKEN_REJECTED' }).name).toBe('UNPAIRED');
  });
});

describe('odbiór żądania podpisu', () => {
  it('REQUEST_RECEIVED w STANDBY otwiera DOCUMENT_REVIEW z czystym stanem', () => {
    const state = reduce(standby(), { type: 'REQUEST_RECEIVED', request });
    expect(state).toEqual({
      name: 'DOCUMENT_REVIEW',
      request,
      verifiedSha256: null,
      declarationAccepted: false,
      declarationAcceptedAt: null,
    });
  });

  it('REQUEST_RECEIVED w THANK_YOU otwiera następny dokument z kolejki', () => {
    // Kilka dokumentów wysłanych jednym kliknięciem: po podpisie pierwszego
    // drugi ma wejść prosto z ekranu podziękowania, bez powrotu do czuwania
    // i bez udziału pracownika.
    const nextRequest: PendingSignatureRequest = {
      ...request,
      requestId: 'req-2',
      documentName: 'Zgody marketingowe',
      challenge: 'nonce-2',
    };
    const state = reduce({ name: 'THANK_YOU' }, { type: 'REQUEST_RECEIVED', request: nextRequest });
    expect(state).toEqual({
      name: 'DOCUMENT_REVIEW',
      request: nextRequest,
      verifiedSha256: null,
      declarationAccepted: false,
      declarationAcceptedAt: null,
    });
  });

  it('REQUEST_RECEIVED jest ignorowane w trakcie przepływu (brak wywłaszczenia)', () => {
    const review = reviewReady();
    expect(reduce(review, { type: 'REQUEST_RECEIVED', request })).toBe(review);
    const pad = signaturePad();
    expect(reduce(pad, { type: 'REQUEST_RECEIVED', request })).toBe(pad);
    const submitting = reduce(pad, { type: 'SUBMIT_STARTED' });
    expect(reduce(submitting, { type: 'REQUEST_RECEIVED', request })).toBe(submitting);
  });

  it('REQUEST_RECEIVED jest ignorowane po odmowie — potwierdzenie odmowy ma dojść do klienta', () => {
    const declined: AppState = { name: 'DECLINED_INFO' };
    expect(reduce(declined, { type: 'REQUEST_RECEIVED', request })).toBe(declined);
  });
});

describe('przegląd dokumentu', () => {
  it('DOCUMENT_VERIFIED zapisuje hash policzony na tablecie', () => {
    const state = reviewReady();
    expect(state).toMatchObject({ name: 'DOCUMENT_REVIEW', verifiedSha256: SHA });
  });

  it('PROCEED_TO_SIGNATURE jest zablokowane bez zaznaczonego oświadczenia', () => {
    const state = reviewReady();
    expect(reduce(state, { type: 'PROCEED_TO_SIGNATURE' })).toBe(state);
  });

  it('PROCEED_TO_SIGNATURE jest zablokowane przed weryfikacją dokumentu', () => {
    let state = reduce(standby(), { type: 'REQUEST_RECEIVED', request });
    state = reduce(state, { type: 'DECLARATION_SET', accepted: true, at: ACCEPTED_AT });
    expect(reduce(state, { type: 'PROCEED_TO_SIGNATURE' })).toBe(state);
  });

  it('z hash + oświadczeniem przechodzi do SIGNATURE_PAD z kompletem danych', () => {
    const state = signaturePad();
    expect(state).toEqual({
      name: 'SIGNATURE_PAD',
      request,
      verifiedSha256: SHA,
      declarationAcceptedAt: ACCEPTED_AT,
    });
  });

  it('odznaczenie oświadczenia zeruje znacznik czasu', () => {
    let state = reviewReady();
    state = reduce(state, { type: 'DECLARATION_SET', accepted: true, at: ACCEPTED_AT });
    state = reduce(state, { type: 'DECLARATION_SET', accepted: false, at: null });
    expect(state).toMatchObject({ declarationAccepted: false, declarationAcceptedAt: null });
  });

  it('BACK_TO_DOCUMENT wraca z zachowanym checkboxem i hashem', () => {
    const state = reduce(signaturePad(), { type: 'BACK_TO_DOCUMENT' });
    expect(state).toEqual({
      name: 'DOCUMENT_REVIEW',
      request,
      verifiedSha256: SHA,
      declarationAccepted: true,
      declarationAcceptedAt: ACCEPTED_AT,
    });
  });
});

describe('wysyłka podpisu', () => {
  it('szczęśliwa ścieżka: SUBMITTING → THANK_YOU → DISMISS → STANDBY', () => {
    let state = reduce(signaturePad(), { type: 'SUBMIT_STARTED' });
    expect(state).toEqual({ name: 'SUBMITTING', request });
    state = reduce(state, { type: 'SUBMIT_SUCCEEDED' });
    expect(state.name).toBe('THANK_YOU');
    state = reduce(state, { type: 'DISMISS' });
    expect(state).toEqual({ name: 'STANDBY', notice: null });
  });

  it('błąd submitu (hash/replay/wygaśnięcie) → ERROR_SCREEN → OK → STANDBY', () => {
    let state = reduce(signaturePad(), { type: 'SUBMIT_STARTED' });
    state = reduce(state, { type: 'REQUEST_FAILED', message: 'Challenge został już zużyty' });
    expect(state).toEqual({ name: 'ERROR_SCREEN', message: 'Challenge został już zużyty' });
    state = reduce(state, { type: 'DISMISS' });
    expect(state.name).toBe('STANDBY');
  });
});

describe('odmowa podpisu', () => {
  it('DECLINED → DECLINED_INFO → DISMISS → STANDBY', () => {
    let state = reduce(reviewReady(), { type: 'DECLINED' });
    expect(state.name).toBe('DECLINED_INFO');
    state = reduce(state, { type: 'DISMISS' });
    expect(state.name).toBe('STANDBY');
  });
});

describe('anulowanie i wygaśnięcie', () => {
  it('REQUEST_CANCELLED z pasującym requestId przerywa przegląd', () => {
    const state = reduce(reviewReady(), {
      type: 'REQUEST_CANCELLED',
      requestId: 'req-1',
      notice: 'Pracownik anulował żądanie podpisu.',
    });
    expect(state).toEqual({ name: 'STANDBY', notice: 'Pracownik anulował żądanie podpisu.' });
  });

  it('REQUEST_CANCELLED z innym requestId jest ignorowane', () => {
    const review = reviewReady();
    expect(
      reduce(review, { type: 'REQUEST_CANCELLED', requestId: 'other', notice: 'x' }),
    ).toBe(review);
  });

  it('REQUEST_CANCELLED w SUBMITTING nie wywłaszcza własnego submitu', () => {
    const submitting = reduce(signaturePad(), { type: 'SUBMIT_STARTED' });
    expect(
      reduce(submitting, { type: 'REQUEST_CANCELLED', requestId: 'req-1', notice: 'x' }),
    ).toBe(submitting);
  });

  it('SESSION_EXPIRED w przeglądzie i na podpisie wraca do STANDBY z komunikatem', () => {
    expect(reduce(reviewReady(), { type: 'SESSION_EXPIRED' })).toEqual({
      name: 'STANDBY',
      notice: EXPIRED_NOTICE,
    });
    expect(reduce(signaturePad(), { type: 'SESSION_EXPIRED' })).toEqual({
      name: 'STANDBY',
      notice: EXPIRED_NOTICE,
    });
  });

  it('SESSION_EXPIRED poza przepływem jest ignorowane', () => {
    const state = standby();
    expect(reduce(state, { type: 'SESSION_EXPIRED' })).toBe(state);
  });
});

describe('błąd integralności dokumentu', () => {
  it('REQUEST_FAILED w DOCUMENT_REVIEW pokazuje ERROR_SCREEN', () => {
    const state = reduce(reviewReady(), {
      type: 'REQUEST_FAILED',
      message: 'Integralność dokumentu nie mogła zostać potwierdzona — wezwij pracownika.',
    });
    expect(state.name).toBe('ERROR_SCREEN');
  });
});

describe('isOutsideSignatureFlow (sprzątanie pamięci)', () => {
  it('stany poza przepływem wymagają wyczyszczenia bufora PDF/podpisu', () => {
    expect(isOutsideSignatureFlow(standby())).toBe(true);
    expect(isOutsideSignatureFlow({ name: 'THANK_YOU' })).toBe(true);
    expect(isOutsideSignatureFlow({ name: 'ERROR_SCREEN', message: 'x' })).toBe(true);
    expect(isOutsideSignatureFlow({ name: 'DECLINED_INFO' })).toBe(true);
    expect(isOutsideSignatureFlow({ name: 'UNPAIRED', errorMessage: null })).toBe(true);
  });

  it('stany przepływu podpisu trzymają dokument w pamięci', () => {
    expect(isOutsideSignatureFlow(reviewReady())).toBe(false);
    expect(isOutsideSignatureFlow(signaturePad())).toBe(false);
    expect(isOutsideSignatureFlow(reduce(signaturePad(), { type: 'SUBMIT_STARTED' }))).toBe(false);
  });
});
