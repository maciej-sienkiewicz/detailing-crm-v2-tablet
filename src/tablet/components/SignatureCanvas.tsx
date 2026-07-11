import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

export interface SignatureCanvasHandle {
  /** Czyści canvas i licznik tuszu. */
  clear: () => void;
  /**
   * Eksport do base64 PNG (bez prefiksu data:). Canvas nigdy nie maluje tła,
   * więc PNG ma pełny kanał alfa — kreski na przezroczystości (wymóg eIDAS).
   * Zwraca null, gdy nic nie narysowano.
   */
  exportPngBase64: () => string | null;
}

interface SignatureCanvasProps {
  /** Wywoływane przy zmianie łącznej długości kreski (px CSS) — do aktywacji „Gotowe”. */
  onInkChange: (inkLengthPx: number) => void;
}

const STROKE_COLOR = '#1a1a2e';
const MAX_WIDTH = 3.4;
const MIN_WIDTH = 1.4;

interface StrokePoint {
  x: number;
  y: number;
  t: number;
}

/**
 * Pole podpisu: pointer events (palec + rysik), skalowanie devicePixelRatio,
 * grubość kreski zależna od prędkości, W PEŁNI PRZEZROCZYSTE tło.
 */
export const SignatureCanvas = forwardRef<SignatureCanvasHandle, SignatureCanvasProps>(
  function SignatureCanvas({ onInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const inkRef = useRef(0);
    const hasInkRef = useRef(false);
    const onInkChangeRef = useRef(onInkChange);
    onInkChangeRef.current = onInkChange;

    useImperativeHandle(ref, () => ({
      clear() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        inkRef.current = 0;
        hasInkRef.current = false;
        onInkChangeRef.current(0);
      },
      exportPngBase64() {
        const canvas = canvasRef.current;
        if (!canvas || !hasInkRef.current) return null;
        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl.slice(dataUrl.indexOf(',') + 1);
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Skalowanie pod devicePixelRatio — ostre kreski na ekranach hi-dpi.
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = STROKE_COLOR;

      let activePointerId: number | null = null;
      let prev: StrokePoint | null = null;
      let prevMid: { x: number; y: number } | null = null;
      let width = MAX_WIDTH;

      const pointFromEvent = (event: PointerEvent): StrokePoint => {
        const bounds = canvas.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, t: event.timeStamp };
      };

      const drawSegment = (point: StrokePoint) => {
        if (!prev) return;
        const dx = point.x - prev.x;
        const dy = point.y - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;

        // Grubość zależna od prędkości (px/ms) z wygładzeniem — naturalny wygląd.
        const dt = Math.max(point.t - prev.t, 1);
        const velocity = dist / dt;
        const target = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, MAX_WIDTH / (1 + velocity * 1.6)),
        );
        width = width * 0.7 + target * 0.3;

        const mid = { x: (prev.x + point.x) / 2, y: (prev.y + point.y) / 2 };
        ctx.beginPath();
        ctx.lineWidth = width;
        if (prevMid) {
          ctx.moveTo(prevMid.x, prevMid.y);
          ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
        } else {
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(mid.x, mid.y);
        }
        ctx.stroke();

        prevMid = mid;
        prev = point;
        inkRef.current += dist;
        hasInkRef.current = true;
        onInkChangeRef.current(inkRef.current);
      };

      const onPointerDown = (event: PointerEvent) => {
        if (activePointerId !== null) return; // rysujemy jednym palcem/rysikiem
        activePointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        prev = pointFromEvent(event);
        prevMid = null;
        width = MAX_WIDTH;
        // Punkt startowy — kropka, żeby krótkie dotknięcia też zostawiały ślad.
        ctx.beginPath();
        ctx.fillStyle = STROKE_COLOR;
        ctx.arc(prev.x, prev.y, MAX_WIDTH / 2, 0, Math.PI * 2);
        ctx.fill();
        hasInkRef.current = true;
      };

      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        const coalesced =
          typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
        if (coalesced.length > 0) {
          for (const sample of coalesced) drawSegment(pointFromEvent(sample));
        } else {
          drawSegment(pointFromEvent(event));
        }
      };

      const endStroke = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
        prev = null;
        prevMid = null;
        onInkChangeRef.current(inkRef.current);
      };

      // Zapasowa blokada przewijania: starsze silniki WebKit/WebView (m.in.
      // iOS < 13) ignorują CSS `touch-action: none`, przez co ruch palcem po
      // canvasie przesuwa całą stronę zamiast rysować. preventDefault na
      // zdarzeniach touch tłumi natywny scroll/zoom, a pointer events, na
      // których rysujemy, działają dalej. Listenery muszą być non-passive.
      const blockTouchGestures = (event: TouchEvent) => event.preventDefault();

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', endStroke);
      canvas.addEventListener('pointercancel', endStroke);
      canvas.addEventListener('touchstart', blockTouchGestures, { passive: false });
      canvas.addEventListener('touchmove', blockTouchGestures, { passive: false });

      return () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', endStroke);
        canvas.removeEventListener('pointercancel', endStroke);
        canvas.removeEventListener('touchstart', blockTouchGestures);
        canvas.removeEventListener('touchmove', blockTouchGestures);
        // Zniszcz bitmapę podpisu przy odmontowaniu (wymóg: natychmiastowe
        // usunięcie danych po wysłaniu/błędzie).
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 1;
        canvas.height = 1;
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-label="Pole podpisu"
      />
    );
  },
);
