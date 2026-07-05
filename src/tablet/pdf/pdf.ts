import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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
