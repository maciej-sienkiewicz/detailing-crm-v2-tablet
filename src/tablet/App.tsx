import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  NetworkError,
  declineSignature,
  getContext,
  getDocument,
  getSignatureQueue,
  markDocumentDisplayed,
  pairTablet,
  submitSignature,
} from './api/client';
import { factoryResetTablet } from './api/reset';
import { clearPairing, loadPairing, savePairing } from './api/storage';
import type { PairingInfo, PendingSignatureRequest, SignatureEvent } from './api/types';
import { NEXT_DOCUMENT_MS, PENDING_POLL_MS, THANK_YOU_MS } from './config';
import { sha256Hex } from './crypto/hash';
import { useKioskMode } from './hooks/useKioskMode';
import { useShellUpdate } from './hooks/useShellUpdate';
import { useWakeLock } from './hooks/useWakeLock';
import { DocumentStore } from './pdf/documentStore';
import { PrefetchStore } from './pdf/prefetchStore';
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

  // Bufor dokumentów CZEKAJĄCYCH w kolejce (pobranych w tle) + migawka kolejki.
  // Osobno od docStore — patrz nagłówek PrefetchStore. Kolejka w refie, nie w
  // stanie: czyta ją tylko efekt prefetchu i przejście z THANK_YOU.
  const prefetchStoreRef = useRef<PrefetchStore | null>(null);
  if (prefetchStoreRef.current === null) prefetchStoreRef.current = new PrefetchStore();
  const prefetchStore = prefetchStoreRef.current;
  const queueRef = useRef<PendingSignatureRequest[]>([]);
  // Licznik zmian składu kolejki — kolejka żyje w refie, więc bez tego efekt
  // prefetchu nie widziałby dokumentów dosłanych, gdy klient już czyta pierwszy.
  const [queueVersion, setQueueVersion] = useState(0);

  // Podczas składania podpisu fullscreen Safari musi być wyłączony —
  // jego systemowy gest „przeciągnij, by wyjść" przesuwa cały widok
  // pod palcem rysującym podpis (szczegóły w useKioskMode).
  useKioskMode(state.name === 'SIGNATURE_PAD');
  useWakeLock(pairing !== null);
  // Samo-aktualizacja powłoki po deployu — reload wyłącznie w trybie czuwania,
  // nigdy w trakcie sesji podpisu (patrz useShellUpdate).
  useShellUpdate(wsConnected, state.name === 'STANDBY');

  const forgetPairing = useCallback(() => {
    clearPairing();
    setPairing(null);
    prefetchStoreRef.current?.wipe();
    queueRef.current = [];
    dispatch({ type: 'TOKEN_REJECTED' });
  }, []);

  /**
   * Źródło prawdy: GET /queue (najstarsze pierwsze). Wywoływane po każdym
   * zdarzeniu WS, po każdym reconnect, przy wejściu w STANDBY, w pollingu
   * awaryjnym i podczas przepływu podpisu (odświeżenie kolejki dla prefetchu).
   *
   * `advanceFromThankYou` pozwala wejść w następny dokument prosto z ekranu
   * podziękowania — jedyna ścieżka, którą REQUEST_RECEIVED opuszcza THANK_YOU.
   */
  const checkPending = useCallback(async (options?: { advanceFromThankYou?: boolean }) => {
    const currentPairing = pairingRef.current;
    if (!currentPairing) return;
    try {
      const queue = await getSignatureQueue(currentPairing.token);
      const changed =
        queue.map((request) => request.requestId).join(',') !==
        queueRef.current.map((request) => request.requestId).join(',');
      queueRef.current = queue;
      if (changed) setQueueVersion((version) => version + 1);
      // Dokument, który wypadł z kolejki (podpisany gdzie indziej, anulowany,
      // wygasły), nie ma prawa zostać w buforze prefetchu.
      prefetchStoreRef.current?.retainOnly(new Set(queue.map((request) => request.requestId)));

      const next = queue[0];
      if (!next) return;
      const stateName = stateRef.current.name;
      if (stateName === 'STANDBY' || (stateName === 'THANK_YOU' && options?.advanceFromThankYou)) {
        dispatch({ type: 'REQUEST_RECEIVED', request: next });
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
        // Zakończone żądanie nie ma prawa zostać w buforze prefetchu.
        prefetchStoreRef.current?.drop(event.requestId);
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

    /**
     * Bajty dokumentu: najpierw bufor prefetchu, dopiero potem sieć.
     *
     * Ścieżka z prefetchu MUSI zgłosić wyświetlenie (POST /displayed) i to
     * zgłoszenie musi się UDAĆ: submit po stronie serwera wymaga statusu
     * DISPLAYED (SignatureRequest.complete), więc ciche niepowodzenie tutaj
     * zablokowałoby podpis dopiero na samym końcu, przy kliencie. Gdy
     * zgłoszenie nie przechodzi, bufor idzie do kosza i pobieramy normalnie —
     * zwykły GET /document ustawia DISPLAYED sam.
     */
    const obtainBytes = async (): Promise<{ buffer: ArrayBuffer; headerSha256: string | null }> => {
      const prefetched = prefetchStore.take(request.requestId);
      if (prefetched) {
        try {
          await markDocumentDisplayed(currentPairing.token, request.requestId);
          return { buffer: prefetched, headerSha256: null };
        } catch {
          // Bufor może być nieaktualny względem stanu serwera — nie ryzykujemy.
        }
      }
      return getDocument(currentPairing.token, request.requestId);
    };

    (async () => {
      try {
        const { buffer, headerSha256 } = await obtainBytes();
        const computed = await sha256Hex(buffer);
        const expectedFromPending = request.documentSha256.toLowerCase();

        // Twardy błąd przy JAKIEJKOLWIEK rozbieżności — dokumentu nie renderujemy.
        // Dla bajtów z prefetchu headerSha256 jest null, ale hash z /queue
        // pochodzi z tego samego źródła co hash z /pending — warunek bez zmian.
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
  }, [needsDocument, reviewRequestId, docStore, prefetchStore]);

  // ── Prefetch kolejnych dokumentów z kolejki, gdy klient czyta bieżący ──
  // Czas czytania i podpisywania (kilkanaście-kilkadziesiąt sekund) z nawiązką
  // pokrywa pobranie; po podpisie następny dokument wchodzi z pamięci.
  // Sekwencyjnie, nie równolegle — jeden transfer na raz nie walczy o pasmo
  // z niczym innym, a kolejność pobierania i tak odpowiada kolejności podpisu.
  const inSignatureFlow =
    state.name === 'DOCUMENT_REVIEW' || state.name === 'SIGNATURE_PAD' || state.name === 'SUBMITTING';
  const activeFlowRequestId = inSignatureFlow ? state.request.requestId : null;
  const prefetchBusyRef = useRef(false);
  useEffect(() => {
    if (!activeFlowRequestId || prefetchBusyRef.current) return;
    const currentPairing = pairingRef.current;
    if (!currentPairing) return;
    let cancelled = false;

    // Każdy obrót pętli skanuje queueRef NA ŚWIEŻO: dokument dosłany w trakcie
    // pobierania poprzedniego zostaje podjęty w tym samym przebiegu, a wpis,
    // który tymczasem wypadł z kolejki, przestaje być kandydatem.
    const nextCandidate = () =>
      queueRef.current.find(
        (queued) => queued.requestId !== activeFlowRequestId && !prefetchStore.has(queued.requestId),
      );

    prefetchBusyRef.current = true;
    (async () => {
      try {
        const attempted = new Set<string>();
        for (let queued = nextCandidate(); queued && !cancelled; queued = nextCandidate()) {
          // Jedno podejście na dokument w tym przebiegu — inaczej stale
          // niepobieralny wpis zapętliłby skan.
          if (attempted.has(queued.requestId)) break;
          attempted.add(queued.requestId);
          try {
            const { buffer, headerSha256 } = await getDocument(currentPairing.token, queued.requestId, {
              prefetch: true,
            });
            const computed = await sha256Hex(buffer);
            const matches =
              computed === queued.documentSha256.toLowerCase() &&
              (headerSha256 === null || computed === headerSha256);
            // Niezgodny bufor po prostu nie wchodzi do magazynu — ścieżka
            // wyświetlenia pobierze na świeżo i tam rozstrzygnie twardy błąd.
            if (matches && !cancelled) prefetchStore.set(queued.requestId, buffer);
          } catch {
            // Prefetch to optymalizacja: nieudane pobranie nie może niczego
            // przerwać, dokument zejdzie normalną ścieżką przy wyświetleniu.
          }
        }
      } finally {
        prefetchBusyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeFlowRequestId, queueVersion, prefetchStore]);

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

  // ── Następny dokument z kolejki prosto z ekranu podziękowania ──
  // Potwierdzenie miga NEXT_DOCUMENT_MS i wchodzi kolejny dokument — bez
  // powrotu do STANDBY i bez klikania przez pracownika. Gdy kolejka jest
  // pusta, nic się nie dzieje i timer DISMISS wyżej domyka przepływ po
  // pełnych THANK_YOU_MS. Po odmowie (DECLINED_INFO) celowo NIE wchodzimy
  // od razu — klient najpierw widzi potwierdzenie odmowy, a następny
  // dokument dopiero ze STANDBY.
  useEffect(() => {
    if (state.name !== 'THANK_YOU') return;
    const timer = setTimeout(
      () => void checkPending({ advanceFromThankYou: true }),
      NEXT_DOCUMENT_MS,
    );
    return () => clearTimeout(timer);
  }, [state.name, checkPending]);

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
