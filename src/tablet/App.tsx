import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  NetworkError,
  declineSignature,
  getContext,
  getDocument,
  getPendingRequest,
  pairTablet,
  submitSignature,
} from './api/client';
import { factoryResetTablet } from './api/reset';
import { clearPairing, loadPairing, savePairing } from './api/storage';
import type { PairingInfo, SignatureEvent } from './api/types';
import { PENDING_POLL_MS, THANK_YOU_MS } from './config';
import { sha256Hex } from './crypto/hash';
import { useKioskMode } from './hooks/useKioskMode';
import { useWakeLock } from './hooks/useWakeLock';
import { DocumentStore } from './pdf/documentStore';
import { loadPdf } from './pdf/pdf';
import { initialState, isOutsideSignatureFlow, reduce } from './state/machine';
import { createTabletSocket } from './ws/stompClient';
import { Connecting } from './screens/Connecting';
import { DeclinedInfo } from './screens/DeclinedInfo';
import { DocumentReview } from './screens/DocumentReview';
import { ErrorScreen } from './screens/ErrorScreen';
import { Pairing } from './screens/Pairing';
import { SignaturePad } from './screens/SignaturePad';
import { Standby } from './screens/Standby';
import { Submitting } from './screens/Submitting';
import { ThankYou } from './screens/ThankYou';

const INTEGRITY_ERROR_MESSAGE =
  'Integralność dokumentu nie mogła zostać potwierdzona — wezwij pracownika.';

const CANCEL_NOTICES: Partial<Record<SignatureEvent['type'], string>> = {
  SIGNATURE_CANCELLED: 'Pracownik anulował żądanie podpisu.',
  SIGNATURE_COMPLETED: 'Dokument został już podpisany na innym urządzeniu.',
  SIGNATURE_FAILED: 'Sesja podpisu została zakończona przez system.',
};

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) {
    return 'Błąd połączenia z serwerem. Nie ponawiaj — wezwij pracownika (stan sesji widać w CRM).';
  }
  return 'Wystąpił nieoczekiwany błąd. Wezwij pracownika recepcji.';
}

export default function App() {
  const [pairing, setPairing] = useState<PairingInfo | null>(() => loadPairing());
  const [state, dispatch] = useReducer(reduce, pairing !== null, initialState);
  const [wsConnected, setWsConnected] = useState(false);

  // Refy na aktualne wartości — handlery WS/pollingu żyją dłużej niż render.
  const stateRef = useRef(state);
  stateRef.current = state;
  const pairingRef = useRef(pairing);
  pairingRef.current = pairing;

  // Bufor PDF i dokument pdf.js poza stanem Reacta — deterministyczne niszczenie.
  const docStoreRef = useRef<DocumentStore | null>(null);
  if (docStoreRef.current === null) docStoreRef.current = new DocumentStore();
  const docStore = docStoreRef.current;

  useKioskMode();
  useWakeLock(pairing !== null);

  const forgetPairing = useCallback(() => {
    clearPairing();
    setPairing(null);
    dispatch({ type: 'TOKEN_REJECTED' });
  }, []);

  /**
   * Źródło prawdy: GET /pending. Wywoływane po każdym zdarzeniu WS, po każdym
   * reconnect, przy wejściu w STANDBY i w pollingu awaryjnym.
   */
  const checkPending = useCallback(async () => {
    const currentPairing = pairingRef.current;
    if (!currentPairing || stateRef.current.name !== 'STANDBY') return;
    try {
      const pending = await getPendingRequest(currentPairing.token);
      if (pending && stateRef.current.name === 'STANDBY') {
        dispatch({ type: 'REQUEST_RECEIVED', request: pending });
      }
    } catch {
      // chwilowy błąd sieci/serwera — kolejna próba przy następnym sygnale/pollingu
    }
  }, []);

  // ── Start: walidacja zapisanego tokenu (auto-reconnect dnia 2 i kolejnych) ──
  useEffect(() => {
    if (stateRef.current.name !== 'CONNECTING') return;
    let cancelled = false;

    const validate = async () => {
      const currentPairing = pairingRef.current;
      if (!currentPairing || cancelled) return;
      try {
        await getContext(currentPairing.token);
        if (!cancelled) dispatch({ type: 'CONTEXT_OK' });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          forgetPairing();
        } else {
          // Brak sieci przy starcie — ponawiaj aż do skutku.
          setTimeout(() => void validate(), 5000);
        }
      }
    };

    void validate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket STOMP: sygnał wybudzenia + statusy sesji ──
  useEffect(() => {
    if (!pairing) return;

    const socket = createTabletSocket(pairing.token, pairing.studioId, {
      onConnectionChange: (connected) => {
        setWsConnected(connected);
        if (connected) void checkPending();
      },
      onEvent: (event) => {
        if (event.type === 'SIGNATURE_REQUESTED') {
          const forThisTablet =
            event.tabletId === null ||
            event.tabletId === undefined ||
            event.tabletId === pairingRef.current?.tabletId;
          if (forThisTablet) void checkPending();
          return;
        }
        const notice = CANCEL_NOTICES[event.type];
        if (notice) {
          dispatch({ type: 'REQUEST_CANCELLED', requestId: event.requestId, notice });
        }
        // WS to tylko sygnał — REST rozstrzyga, czy coś czeka.
        void checkPending();
      },
    });

    return () => {
      setWsConnected(false);
      void socket.close();
    };
  }, [pairing, checkPending]);

  // ── Polling awaryjny co 10 s, gdy WS rozłączony (żądanie nie może przepaść) ──
  useEffect(() => {
    if (wsConnected || state.name !== 'STANDBY') return;
    void checkPending();
    const interval = setInterval(() => void checkPending(), PENDING_POLL_MS);
    return () => clearInterval(interval);
  }, [wsConnected, state.name, checkPending]);

  // ── Jednorazowy odczyt pending przy każdym wejściu w STANDBY ──
  useEffect(() => {
    if (state.name === 'STANDBY') void checkPending();
  }, [state.name, checkPending]);

  // ── Pobranie dokumentu + weryfikacja integralności (WYSIWYS) ──
  const reviewRequestId = state.name === 'DOCUMENT_REVIEW' ? state.request.requestId : null;
  const needsDocument = state.name === 'DOCUMENT_REVIEW' && state.verifiedSha256 === null;
  useEffect(() => {
    if (!needsDocument || !reviewRequestId) return;
    const currentState = stateRef.current;
    const currentPairing = pairingRef.current;
    if (currentState.name !== 'DOCUMENT_REVIEW' || !currentPairing) return;
    const request = currentState.request;
    let cancelled = false;

    (async () => {
      try {
        const { buffer, headerSha256 } = await getDocument(currentPairing.token, request.requestId);
        const computed = await sha256Hex(buffer);
        const expectedFromPending = request.documentSha256.toLowerCase();

        // Twardy błąd przy JAKIEJKOLWIEK rozbieżności — dokumentu nie renderujemy.
        if (computed !== expectedFromPending || (headerSha256 !== null && computed !== headerSha256)) {
          if (!cancelled) dispatch({ type: 'REQUEST_FAILED', message: INTEGRITY_ERROR_MESSAGE });
          return;
        }

        const pdf = await loadPdf(buffer);
        if (cancelled) {
          void pdf.destroy().catch(() => {});
          return;
        }
        docStore.set(buffer, pdf);
        dispatch({ type: 'DOCUMENT_VERIFIED', sha256: computed });
      } catch (error) {
        if (!cancelled) dispatch({ type: 'REQUEST_FAILED', message: describeError(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsDocument, reviewRequestId, docStore]);

  // ── Sprzątanie pamięci przy każdym wyjściu z przepływu podpisu ──
  useEffect(() => {
    if (isOutsideSignatureFlow(state)) docStore.wipe();
  }, [state, docStore]);

  // ── Licznik ważności sesji ──
  const activeRequest =
    state.name === 'DOCUMENT_REVIEW' || state.name === 'SIGNATURE_PAD' ? state.request : null;
  const activeRequestId = activeRequest?.requestId ?? null;
  const activeExpiresAt = activeRequest?.expiresAt ?? null;
  useEffect(() => {
    if (!activeRequestId || !activeExpiresAt) return;
    const remaining = Date.parse(activeExpiresAt) - Date.now();
    if (remaining <= 0) {
      dispatch({ type: 'SESSION_EXPIRED' });
      return;
    }
    const timer = setTimeout(() => dispatch({ type: 'SESSION_EXPIRED' }), remaining);
    return () => clearTimeout(timer);
  }, [activeRequestId, activeExpiresAt]);

  // ── Auto-powrót do czuwania z ekranów podziękowania/odmowy ──
  useEffect(() => {
    if (state.name !== 'THANK_YOU' && state.name !== 'DECLINED_INFO') return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS' }), THANK_YOU_MS);
    return () => clearTimeout(timer);
  }, [state.name]);

  // ── Akcje użytkownika ──

  const handlePair = useCallback(async (pairingCode: string, deviceName: string) => {
    try {
      const response = await pairTablet({ pairingCode, deviceName });
      const info: PairingInfo = {
        token: response.token,
        tabletId: response.tabletId,
        studioId: response.studioId,
        deviceName,
      };
      savePairing(info);
      setPairing(info);
      dispatch({ type: 'PAIR_SUCCESS' });
      dispatch({ type: 'CONTEXT_OK' });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 403
          ? 'Nieprawidłowy lub wygasły kod — wygeneruj nowy w CRM'
          : describeError(error);
      dispatch({ type: 'PAIR_FAILURE', message });
    }
  }, []);

  const handleSubmit = useCallback(async (signaturePngBase64: string) => {
    const currentState = stateRef.current;
    const currentPairing = pairingRef.current;
    if (currentState.name !== 'SIGNATURE_PAD' || !currentPairing) return;
    const { request, verifiedSha256, declarationAcceptedAt } = currentState;

    dispatch({ type: 'SUBMIT_STARTED' });
    try {
      // Jednorazowy challenge — brak automatycznych ponowień po błędzie.
      await submitSignature(currentPairing.token, request.requestId, {
        documentSha256: verifiedSha256,
        challenge: request.challenge,
        declarationAccepted: true,
        declarationAcceptedAt,
        signatureImageBase64: signaturePngBase64,
      });
      dispatch({ type: 'SUBMIT_SUCCEEDED' });
    } catch (error) {
      dispatch({ type: 'REQUEST_FAILED', message: describeError(error) });
    }
  }, []);

  const handleDecline = useCallback(async () => {
    const currentState = stateRef.current;
    const currentPairing = pairingRef.current;
    if (currentState.name !== 'DOCUMENT_REVIEW' || !currentPairing) return;
    try {
      await declineSignature(currentPairing.token, currentState.request.requestId);
      dispatch({ type: 'DECLINED' });
    } catch (error) {
      dispatch({ type: 'REQUEST_FAILED', message: describeError(error) });
    }
  }, []);

  const handleFactoryReset = useCallback(() => {
    // Zapętlony błąd = lokalny stan nie do odratowania. Czyścimy wszystko
    // (parowanie, Cache Storage, service worker) i przeładowujemy — aplikacja
    // wstanie na ekranie parowania ze świeżą powłoką z sieci.
    void factoryResetTablet();
  }, []);

  const handleDeclarationChange = useCallback((accepted: boolean) => {
    // Moment zaznaczenia oświadczenia — ISO timestamp trafia do submitu.
    dispatch({
      type: 'DECLARATION_SET',
      accepted,
      at: accepted ? new Date().toISOString() : null,
    });
  }, []);

  // ── Render ──

  switch (state.name) {
    case 'UNPAIRED':
      return <Pairing errorMessage={state.errorMessage} onPair={handlePair} />;
    case 'CONNECTING':
      return <Connecting />;
    case 'STANDBY':
      return (
        <Standby
          deviceName={pairing?.deviceName ?? ''}
          wsConnected={wsConnected}
          notice={state.notice}
        />
      );
    case 'DOCUMENT_REVIEW':
      return (
        <DocumentReview
          request={state.request}
          pdf={state.verifiedSha256 !== null ? docStore.getPdf() : null}
          declarationAccepted={state.declarationAccepted}
          onDeclarationChange={handleDeclarationChange}
          onProceed={() => dispatch({ type: 'PROCEED_TO_SIGNATURE' })}
          onDecline={() => void handleDecline()}
        />
      );
    case 'SIGNATURE_PAD':
      return (
        <SignaturePad
          request={state.request}
          onDone={(base64) => void handleSubmit(base64)}
          onBack={() => dispatch({ type: 'BACK_TO_DOCUMENT' })}
        />
      );
    case 'SUBMITTING':
      return <Submitting />;
    case 'THANK_YOU':
      return <ThankYou />;
    case 'DECLINED_INFO':
      return <DeclinedInfo />;
    case 'ERROR_SCREEN':
      return (
        <ErrorScreen
          message={state.message}
          onAcknowledge={() => dispatch({ type: 'DISMISS' })}
          onFactoryReset={handleFactoryReset}
        />
      );
  }
}
