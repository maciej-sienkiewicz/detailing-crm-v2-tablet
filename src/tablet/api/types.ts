/** Typy kontraktu REST/WS backendu DetailBoost (patrz dokumentacja modułu tabletu). */

export interface PairRequest {
  pairingCode: string;
  deviceName: string;
}

export interface PairResponse {
  tabletId: string;
  token: string;
  studioId: string;
}

export interface TabletContext {
  tabletId: string;
  studioId: string;
  deviceName: string;
}

/** Dane parowania trzymane w localStorage (jedyne dane trwałe aplikacji). */
export interface PairingInfo {
  token: string;
  tabletId: string;
  studioId: string;
  deviceName: string;
}

export interface PendingSignatureRequest {
  requestId: string;
  documentName: string;
  signerName: string;
  declarationText: string;
  documentSha256: string;
  challenge: string;
  expiresAt: string;
  documentUrl: string;
}

export interface SubmitSignatureRequest {
  documentSha256: string;
  challenge: string;
  declarationAccepted: boolean;
  declarationAcceptedAt: string;
  signatureImageBase64: string;
}

export interface SignatureResultResponse {
  requestId: string;
  status: 'COMPLETED' | 'DECLINED' | string;
  sealApplied: boolean;
  timestampApplied: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  timestamp: string;
}

export type SignatureEventType =
  | 'SIGNATURE_REQUESTED'
  | 'SIGNATURE_DISPLAYED'
  | 'SIGNATURE_COMPLETED'
  | 'SIGNATURE_CANCELLED'
  | 'SIGNATURE_DECLINED'
  | 'SIGNATURE_FAILED';

export interface SignatureEvent {
  type: SignatureEventType;
  requestId: string;
  /** null = żądanie dla dowolnego tabletu w salonie */
  tabletId: string | null;
  documentName?: string;
  signerName?: string;
  status?: string;
  occurredAt?: string;
}
