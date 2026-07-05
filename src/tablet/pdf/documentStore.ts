import type { PDFDocumentProxy } from './pdf';

/**
 * Magazyn aktualnie wyświetlanego dokumentu — celowo POZA stanem Reacta,
 * żeby dało się deterministycznie zniszczyć dane (wymóg eIDAS: po submit /
 * odmowie / anulowaniu w pamięci nie może zostać bufor PDF).
 */
export class DocumentStore {
  private buffer: ArrayBuffer | null = null;
  private pdf: PDFDocumentProxy | null = null;

  set(buffer: ArrayBuffer, pdf: PDFDocumentProxy): void {
    this.wipe();
    this.buffer = buffer;
    this.pdf = pdf;
  }

  getPdf(): PDFDocumentProxy | null {
    return this.pdf;
  }

  /** Zeruje bajty (o ile bufor nie został już odłączony przez transfer do workera)
   *  i niszczy dokument pdf.js razem z jego workerem. Idempotentne. */
  wipe(): void {
    if (this.buffer) {
      try {
        if (this.buffer.byteLength > 0) {
          new Uint8Array(this.buffer).fill(0);
        }
      } catch {
        // bufor odłączony — nie ma czego zerować
      }
      this.buffer = null;
    }
    if (this.pdf) {
      void this.pdf.destroy().catch(() => {});
      this.pdf = null;
    }
  }
}
