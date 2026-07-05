import type { PendingSignatureRequest } from '../api/types';
import type { PDFDocumentProxy } from '../pdf/pdf';
import { Countdown } from '../components/Countdown';
import { PdfViewer } from '../components/PdfViewer';

interface DocumentReviewProps {
  request: PendingSignatureRequest;
  /** null podczas pobierania/weryfikacji dokumentu. */
  pdf: PDFDocumentProxy | null;
  declarationAccepted: boolean;
  onDeclarationChange: (accepted: boolean) => void;
  onProceed: () => void;
  onDecline: () => void;
}

/**
 * Przegląd dokumentu: nagłówek z nazwą i licznikiem ważności, scrollowalny
 * PDF, checkbox z dokładną treścią oświadczenia z API i przyciski akcji.
 */
export function DocumentReview({
  request,
  pdf,
  declarationAccepted,
  onDeclarationChange,
  onProceed,
  onDecline,
}: DocumentReviewProps) {
  return (
    <div className="screen review-screen">
      <header className="review-header">
        <div className="review-titles">
          <h1 className="review-document-name">{request.documentName}</h1>
          <p className="review-signer">Podpisuje: {request.signerName}</p>
        </div>
        <div className="review-expiry">
          <span className="review-expiry-label">Sesja wygasa za</span>
          <Countdown expiresAt={request.expiresAt} />
        </div>
      </header>

      <main className="review-document">
        {pdf ? (
          <PdfViewer pdf={pdf} />
        ) : (
          <div className="review-loading">
            <div className="spinner" />
            <p>Wczytywanie dokumentu…</p>
          </div>
        )}
      </main>

      <footer className="review-footer">
        <label className="declaration">
          <input
            type="checkbox"
            className="declaration-checkbox"
            checked={declarationAccepted}
            onChange={(event) => onDeclarationChange(event.target.checked)}
            disabled={!pdf}
          />
          <span className="declaration-text">{request.declarationText}</span>
        </label>

        <div className="review-actions">
          <button type="button" className="btn btn--secondary" onClick={onDecline}>
            Odmawiam podpisu
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onProceed}
            disabled={!declarationAccepted || !pdf}
          >
            Przejdź do podpisu
          </button>
        </div>
      </footer>
    </div>
  );
}
