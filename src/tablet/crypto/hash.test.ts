import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('pusty bufor → znany wektor testowy', async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"abc" → znany wektor testowy (hex lowercase)', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('przyjmuje zarówno ArrayBuffer, jak i Uint8Array — ten sam wynik', async () => {
    const bytes = new TextEncoder().encode('DetailBoost');
    const buffer = bytes.slice().buffer;
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(buffer));
  });

  it('wynik ma 64 znaki hex małymi literami', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('Protokół przyjęcia pojazdu'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
