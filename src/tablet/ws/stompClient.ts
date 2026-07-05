import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { WS_RECONNECT_BACKOFF_MS, wsRegistryUrl } from '../config';
import type { SignatureEvent } from '../api/types';

export interface TabletSocketHandlers {
  onEvent: (event: SignatureEvent) => void;
  onConnectionChange: (connected: boolean) => void;
}

export interface TabletSocket {
  close: () => Promise<void>;
}

/**
 * Klient STOMP przez SockJS z reconnectem 1s → 2s → 5s → 10s (w nieskończoność).
 *
 * WS jest tylko sygnałem wybudzającym — źródłem prawdy pozostaje REST
 * (`GET /pending`), dlatego warstwa wyżej po każdym zdarzeniu i po każdym
 * reconnect odpytuje backend.
 */
export function createTabletSocket(
  token: string,
  studioId: string,
  handlers: TabletSocketHandlers,
): TabletSocket {
  let failedAttempts = 0;

  const client = new Client({
    webSocketFactory: () => new SockJS(wsRegistryUrl()) as unknown as WebSocket,
    connectHeaders: { 'X-Tablet-Token': token },
    // Klient deklaruje i honoruje heart-beaty 10s/10s; stompjs sam zamyka
    // połączenie po nieodebranych heartbeatach, co uruchamia reconnect.
    heartbeatIncoming: 10_000,
    heartbeatOutgoing: 10_000,
    reconnectDelay: WS_RECONNECT_BACKOFF_MS[0],
    beforeConnect: () => {
      const index = Math.min(failedAttempts, WS_RECONNECT_BACKOFF_MS.length - 1);
      client.reconnectDelay = WS_RECONNECT_BACKOFF_MS[index];
      failedAttempts += 1;
    },
    onConnect: () => {
      failedAttempts = 0;
      client.reconnectDelay = WS_RECONNECT_BACKOFF_MS[0];
      // Jedyny temat dozwolony dla tabletu — subskrypcja czegokolwiek innego
      // skutkuje zerwaniem połączenia przez serwer.
      client.subscribe(`/topic/studio.${studioId}.tablet.signature`, (message) => {
        try {
          handlers.onEvent(JSON.parse(message.body) as SignatureEvent);
        } catch {
          // niepoprawny JSON — ignorujemy wiadomość
        }
      });
      handlers.onConnectionChange(true);
    },
    onWebSocketClose: () => {
      handlers.onConnectionChange(false);
    },
  });

  client.activate();

  return {
    close: async () => {
      try {
        await client.deactivate();
      } catch {
        // zamykanie w trakcie reconnectu może rzucić — bezpiecznie ignorujemy
      }
    },
  };
}
