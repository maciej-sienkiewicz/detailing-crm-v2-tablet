import type { PairingInfo } from './types';

/**
 * Jedyne dane, jakie aplikacja utrwala lokalnie: token urządzenia i metadane
 * parowania. Żadne dokumenty, podpisy, hashe ani challenge nigdy tu nie trafiają.
 */
const PAIRING_KEY = 'detailboost.tablet.pairing';

export function loadPairing(): PairingInfo | null {
  try {
    const raw = localStorage.getItem(PAIRING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PairingInfo>;
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.tabletId === 'string' &&
      typeof parsed.studioId === 'string' &&
      typeof parsed.deviceName === 'string'
    ) {
      return parsed as PairingInfo;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePairing(info: PairingInfo): void {
  localStorage.setItem(PAIRING_KEY, JSON.stringify(info));
}

export function clearPairing(): void {
  localStorage.removeItem(PAIRING_KEY);
}
