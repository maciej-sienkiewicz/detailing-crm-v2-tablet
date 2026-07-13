import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../pdf/pdf';

interface PdfViewerProps {
  pdf: PDFDocumentProxy;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/**
 * Limity canvasa na iOS/Safari. Przekroczenie któregokolwiek NIE zgłasza
 * błędu — Safari po cichu maluje pusty (biały) canvas. Na iPadzie (duży
 * ekran × dpr 2 × zoom 3) łatwo je przekroczyć, dlatego rozdzielczość
 * renderowania jest twardo przycinana poniżej progów.
 */
const MAX_CANVAS_DIM = 4096;
const MAX_CANVAS_AREA = 16 * 1024 * 1024;

/** Skala piksele-bitmapy/piksele-CSS przycięta do bezpiecznych limitów. */
function canvasScaleFor(cssWidth: number, cssHeight: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const dimCap = MAX_CANVAS_DIM / Math.max(cssWidth, cssHeight);
  const areaCap = Math.sqrt(MAX_CANVAS_AREA / (cssWidth * cssHeight));
  return Math.max(0.25, Math.min(dpr, dimCap, areaCap));
}

interface PageSize {
  width: number;
  height: number;
}

function isRenderingCancelled(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'RenderingCancelledException';
}

/**
 * Renderuje strony PDF (pdf.js) w scrollowalnym kontenerze.
 *
 * Strony renderowane są LENIWIE (IntersectionObserver): bitmapę dostają tylko
 * strony w pobliżu widoku, a odległe są zwalniane. iOS ma globalny budżet
 * pamięci na canvasy — wielostronicowy dokument wyrenderowany w całości
 * przekracza go na iPadzie i wszystkie strony robią się białe. Leniwe
 * renderowanie ogranicza liczbę żywych bitmap niezależnie od długości
 * dokumentu i urządzenia.
 *
 * Zoom: pinch dwoma palcami (podgląd tanim transformem, ostry re-render po
 * puszczeniu) + przyciski +/−. Zmiana rozmiaru kontenera (fullscreen, obrót
 * ekranu) przelicza układ stron.
 */
export function PdfViewer({ pdf }: PdfViewerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageSizes, setPageSizes] = useState<PageSize[] | null>(null);

  // Bazowe wymiary stron (scale 1) — raz na dokument.
  useEffect(() => {
    let cancelled = false;
    setPageSizes(null);

    (async () => {
      const sizes: PageSize[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        sizes.push({ width: viewport.width, height: viewport.height });
      }
      if (!cancelled) setPageSizes(sizes);
    })().catch((error) => {
      // dokument zniszczony przy sprzątaniu — ignorujemy
      if (!cancelled) console.error('PDF: odczyt wymiarów stron nie powiódł się', error);
    });

    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // Szerokość kontenera — reaguje na fullscreen/obrót ekranu.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setContainerWidth(scroller.clientWidth - 24); // padding
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Układ stron + leniwe renderowanie widocznych.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const pagesEl = pagesRef.current;
    if (!scroller || !pagesEl || !pageSizes || containerWidth <= 0) return;

    let disposed = false;
    const renderTasks = new Map<HTMLElement, { cancel: () => void }>();

    const renderShell = async (shell: HTMLDivElement) => {
      const pageNumber = Number(shell.dataset.page);
      const size = pageSizes[pageNumber - 1];
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed || !shell.isConnected) return;

        const scale = (containerWidth / size.width) * zoom;
        const viewport = page.getViewport({ scale });
        const outputScale = canvasScaleFor(viewport.width, viewport.height);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const task = page.render({
          canvasContext: ctx,
          canvas,
          viewport,
          transform:
            outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });
        renderTasks.set(shell, task);
        await task.promise;
        renderTasks.delete(shell);
        if (!disposed && shell.isConnected) shell.replaceChildren(canvas);
      } catch (error) {
        renderTasks.delete(shell);
        if (!disposed && !isRenderingCancelled(error)) {
          console.error(`PDF: renderowanie strony ${pageNumber} nie powiodło się`, error);
        }
      }
    };

    const releaseShell = (shell: HTMLDivElement) => {
      renderTasks.get(shell)?.cancel();
      renderTasks.delete(shell);
      // Zwolnienie bitmapy — pusta biała ramka zachowuje wymiary (scroll
      // się nie przesuwa), a pamięć canvasów pozostaje ograniczona.
      shell.replaceChildren();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const shell = entry.target as HTMLDivElement;
          if (entry.isIntersecting) {
            if (!renderTasks.has(shell) && shell.childElementCount === 0) {
              void renderShell(shell);
            }
          } else {
            releaseShell(shell);
          }
        }
      },
      // Prerender ~1,5 ekranu w każdą stronę — scroll bez pustych stron.
      { root: scroller, rootMargin: '150% 0%' },
    );

    const shells = pageSizes.map((size, index) => {
      const shell = document.createElement('div');
      shell.className = 'pdf-page';
      shell.dataset.page = String(index + 1);
      const cssWidth = Math.floor(containerWidth * zoom);
      shell.style.width = `${cssWidth}px`;
      shell.style.height = `${Math.floor((size.height / size.width) * cssWidth)}px`;
      return shell;
    });
    pagesEl.replaceChildren(...shells);
    for (const shell of shells) observer.observe(shell);

    return () => {
      disposed = true;
      observer.disconnect();
      for (const task of renderTasks.values()) task.cancel();
      renderTasks.clear();
      pagesEl.replaceChildren();
    };
  }, [pdf, pageSizes, containerWidth, zoom]);

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
