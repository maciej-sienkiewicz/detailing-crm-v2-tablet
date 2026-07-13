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
 *
 * Bitmapa jest utrzymywana w synchronizacji z rozmiarem CSS elementu
 * (ResizeObserver). Na iPadzie layout zmienia rozmiar PO zamontowaniu pola —
 * wejście/wyjście z fullscreen (useKioskMode), obrót ekranu — a bitmapa
 * wymiarowana tylko raz byłaby rozciągana przez CSS i kreska lądowałaby
 * w innym miejscu niż palec. Po zmianie rozmiaru kreski są odtwarzane
 * z zapamiętanych punktów.
 */
export const SignatureCanvas = forwardRef<SignatureCanvasHandle, SignatureCanvasProps>(
  function SignatureCanvas({ onInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const inkRef = useRef(0);
    const hasInkRef = useRef(false);
    const strokesRef = useRef<StrokePoint[][]>([]);
    const onInkChangeRef = useRef(onInkChange);
    onInkChangeRef.current = onInkChange;

    useImperativeHandle(ref, () => ({
      clear() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        strokesRef.current = [];
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

      let activePointerId: number | null = null;
      let prev: StrokePoint | null = null;
      let prevMid: { x: number; y: number } | null = null;
      let width = MAX_WIDTH;

      const drawDot = (point: StrokePoint) => {
        ctx.beginPath();
        ctx.fillStyle = STROKE_COLOR;
        ctx.arc(point.x, point.y, MAX_WIDTH / 2, 0, Math.PI * 2);
        ctx.fill();
      };

      // Grubość zależna od prędkości (px/ms) z wygładzeniem — naturalny wygląd.
      const nextWidth = (from: StrokePoint, to: StrokePoint, current: number) => {
        const dt = Math.max(to.t - from.t, 1);
        const velocity = Math.hypot(to.x - from.x, to.y - from.y) / dt;
        const target = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, MAX_WIDTH / (1 + velocity * 1.6)),
        );
        return current * 0.7 + target * 0.3;
      };

      const strokeSegment = (
        from: StrokePoint,
        fromMid: { x: number; y: number } | null,
        to: StrokePoint,
        lineWidth: number,
      ) => {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        ctx.beginPath();
        ctx.lineWidth = lineWidth;
        if (fromMid) {
          ctx.moveTo(fromMid.x, fromMid.y);
          ctx.quadraticCurveTo(from.x, from.y, mid.x, mid.y);
        } else {
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(mid.x, mid.y);
        }
        ctx.stroke();
        return mid;
      };

      /** Odtworzenie wszystkich zapamiętanych kresek (ten sam algorytm co na żywo). */
      const replayStrokes = () => {
        for (const stroke of strokesRef.current) {
          if (stroke.length === 0) continue;
          drawDot(stroke[0]);
          let replayPrev = stroke[0];
          let replayMid: { x: number; y: number } | null = null;
          let replayWidth = MAX_WIDTH;
          for (let i = 1; i < stroke.length; i++) {
            const point = stroke[i];
            replayWidth = nextWidth(replayPrev, point, replayWidth);
            replayMid = strokeSegment(replayPrev, replayMid, point, replayWidth);
            replayPrev = point;
          }
        }
      };

      // Skalowanie pod devicePixelRatio — ostre kreski na ekranach hi-dpi.
      // Wywoływane przy montowaniu i przy KAŻDEJ zmianie rozmiaru elementu.
      let lastCssWidth = 0;
      let lastCssHeight = 0;
      const applySize = () => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === lastCssWidth && rect.height === lastCssHeight) return;
        lastCssWidth = rect.width;
        lastCssHeight = rect.height;
        const dpr = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = STROKE_COLOR;
        replayStrokes();
      };
      applySize();
      const resizeObserver = new ResizeObserver(applySize);
      resizeObserver.observe(canvas);

      const pointFromEvent = (event: PointerEvent): StrokePoint => {
        const bounds = canvas.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, t: event.timeStamp };
      };

      const drawSegment = (point: StrokePoint) => {
        if (!prev) return;
        const dist = Math.hypot(point.x - prev.x, point.y - prev.y);
        if (dist === 0) return;

        width = nextWidth(prev, point, width);
        prevMid = strokeSegment(prev, prevMid, point, width);
        prev = point;
        strokesRef.current[strokesRef.current.length - 1]?.push(point);
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
        strokesRef.current.push([prev]);
        // Punkt startowy — kropka, żeby krótkie dotknięcia też zostawiały ślad.
        drawDot(prev);
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
        resizeObserver.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', endStroke);
        canvas.removeEventListener('pointercancel', endStroke);
        canvas.removeEventListener('touchstart', blockTouchGestures);
        canvas.removeEventListener('touchmove', blockTouchGestures);
        // Zniszcz bitmapę i punkty podpisu przy odmontowaniu (wymóg:
        // natychmiastowe usunięcie danych po wysłaniu/błędzie).
        strokesRef.current = [];
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
