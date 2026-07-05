import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../pdf/pdf';

interface PdfViewerProps {
  pdf: PDFDocumentProxy;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/**
 * Renderuje wszystkie strony PDF (pdf.js) w scrollowalnym kontenerze.
 * Zoom: pinch dwoma palcami (touchmove z preventDefault — pojedynczy palec
 * scrolluje natywnie) + przyciski +/− . Po zmianie zoomu strony są
 * re-renderowane w docelowej skali, więc tekst pozostaje ostry.
 */
export function PdfViewer({ pdf }: PdfViewerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Render stron przy zmianie dokumentu lub zoomu.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const pagesEl = pagesRef.current;
    if (!scroller || !pagesEl) return;

    let cancelled = false;

    (async () => {
      const containerWidth = scroller.clientWidth - 24; // padding
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const fresh: HTMLCanvasElement[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth / baseViewport.width) * zoom;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        pagesEl.appendChild(canvas);
        fresh.push(canvas);
        await page.render({
          canvasContext: ctx,
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise;
      }

      if (!cancelled) {
        // Usuń poprzedni zestaw stron dopiero po wyrenderowaniu nowego
        // (bez migotania przy zmianie zoomu).
        for (const child of Array.from(pagesEl.children)) {
          if (!fresh.includes(child as HTMLCanvasElement)) child.remove();
        }
      }
    })().catch(() => {
      // render przerwany (np. pdf.destroy() przy sprzątaniu) — ignorujemy
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, zoom]);

  // Czyszczenie DOM przy odmontowaniu.
  useEffect(() => {
    const pagesEl = pagesRef.current;
    return () => {
      if (pagesEl) pagesEl.innerHTML = '';
    };
  }, []);

  // Pinch-zoom: dwa palce → preventDefault + skala; jeden palec → natywny scroll.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const pagesEl = pagesRef.current;
    if (!scroller || !pagesEl) return;

    let pinching = false;
    let startDistance = 0;
    let startZoom = 1;
    let liveScale = 1;

    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinching = true;
        startDistance = distance(event.touches);
        startZoom = zoomRef.current;
        liveScale = 1;
        pagesEl.style.transformOrigin = 'top center';
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pinching || event.touches.length !== 2) return;
      event.preventDefault();
      const ratio = distance(event.touches) / startDistance;
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * ratio));
      liveScale = target / startZoom;
      // Podgląd na żywo tanim transformem; ostry re-render następuje po commit.
      pagesEl.style.transform = `scale(${liveScale})`;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!pinching || event.touches.length >= 2) return;
      pinching = false;
      pagesEl.style.transform = '';
      const committed = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * liveScale));
      setZoom(committed);
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const zoomBy = (delta: number) =>
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)));

  return (
    <div className="pdf-viewer">
      <div ref={scrollerRef} className="pdf-scroller">
        <div ref={pagesRef} className="pdf-pages" />
      </div>
      <div className="pdf-zoom-controls">
        <button
          type="button"
          className="zoom-btn"
          onClick={() => zoomBy(-0.5)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Pomniejsz"
        >
          −
        </button>
        <button
          type="button"
          className="zoom-btn"
          onClick={() => zoomBy(0.5)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Powiększ"
        >
          +
        </button>
      </div>
    </div>
  );
}
