// Build LEGACY pdf.js — z polyfillami nowych metod JS (np.
// Map.prototype.getOrInsertComputed). Build „modern" zakłada najnowsze
// silniki: na Safari/iPadOS każde page.render() rzucało TypeError i strony
// dokumentu pozostawały białe. Nie zmieniać na 'pdfjs-dist/build/*' bez
// weryfikacji na fizycznym iPadzie.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

/**
 * Otwiera PDF z bufora, który został wcześniej zahashowany (te same bajty!).
 * pdf.js transferuje bufor do workera (ArrayBuffer zostaje odłączony) — to
 * pożądane: po zamknięciu dokumentu bajty nie wiszą w pamięci strony.
 */
export function loadPdf(buffer: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
}
