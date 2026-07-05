/**
 * SHA-256 nad dokładnie tymi bajtami, które pobrano z serwera (zasada WYSIWYS).
 * Zwraca hex małymi literami — w tej postaci hash wraca do backendu przy submit.
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}
