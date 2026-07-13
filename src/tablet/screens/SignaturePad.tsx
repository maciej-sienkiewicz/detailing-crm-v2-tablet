import { useEffect, useRef, useState } from 'react';
import type { PendingSignatureRequest } from '../api/types';
import { MIN_INK_LENGTH_PX } from '../config';
import { Countdown } from '../components/Countdown';
import {
  SignatureCanvas,
  type SignatureCanvasHandle,
} from '../components/SignatureCanvas';

interface SignaturePadProps {
  request: PendingSignatureRequest;
  onDone: (signaturePngBase64: string) => void;
  onBack: () => void;
}

/**
 * Pełnoekranowe pole podpisu. Tło samego canvasa jest przezroczyste (PNG z
 * kanałem alfa); jasne jest tylko otoczenie pola, żeby ciemne kreski były
 * widoczne. „Gotowe” aktywuje się po narysowaniu minimalnej ilości tuszu.
 */
export function SignaturePad({ request, onDone, onBack }: SignaturePadProps) {
  const canvasRef = useRef<SignatureCanvasHandle>(null);
  const [inkLength, setInkLength] = useState(0);

  // Podczas podpisu żaden dotyk nie może przewijać/przeciągać strony.
  // Sam canvas blokuje gesty, ale dłoń oparta o ekran POZA canvasem
  // (nagłówek, stopka, tło) rozpoczyna na iPadzie natywny pan/rubber-band
  // całej strony — klient widzi „przesuwanie okna aplikacji". Blokujemy
  // touchmove globalnie na czas życia ekranu; tapnięcia w przyciski działają
  // dalej (preventDefault na touchmove nie tłumi kliknięć).
  useEffect(() => {
    const blockTouchScroll = (event: TouchEvent) => event.preventDefault();
    document.addEventListener('touchmove', blockTouchScroll, { passive: false });
    return () => document.removeEventListener('touchmove', blockTouchScroll);
  }, []);

  const hasSignature = inkLength >= MIN_INK_LENGTH_PX;

  const handleDone = () => {
    const base64 = canvasRef.current?.exportPngBase64();
    if (base64) onDone(base64);
  };

  return (
    <div className="screen signature-screen">
      <header className="signature-header">
        <div>
          <h1 className="signature-title">Złóż podpis</h1>
          <p className="signature-subtitle">
            {request.documentName} — {request.signerName}
          </p>
        </div>
        <div className="review-expiry">
          <span className="review-expiry-label">Sesja wygasa za</span>
          <Countdown expiresAt={request.expiresAt} />
        </div>
      </header>

      <main className="signature-pad-area">
        <div className="signature-pad-frame">
          <SignatureCanvas ref={canvasRef} onInkChange={setInkLength} />
          <div className="signature-baseline" aria-hidden="true" />
          <span className="signature-hint">Podpisz się palcem lub rysikiem</span>
        </div>
      </main>

      <footer className="signature-actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => canvasRef.current?.clear()}
        >
          Wyczyść
        </button>
        <button type="button" className="btn btn--secondary" onClick={onBack}>
          Wstecz
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleDone}
          disabled={!hasSignature}
        >
          Gotowe
        </button>
      </footer>
    </div>
  );
}
