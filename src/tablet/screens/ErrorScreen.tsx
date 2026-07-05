interface ErrorScreenProps {
  message: string;
  onAcknowledge: () => void;
}

/** Czytelny komunikat błędu + powrót do czuwania. Stan sesji widzi pracownik w CRM. */
export function ErrorScreen({ message, onAcknowledge }: ErrorScreenProps) {
  return (
    <div className="screen error-screen">
      <div className="result-icon result-icon--error" aria-hidden="true">
        !
      </div>
      <h1 className="result-title">Wystąpił problem</h1>
      <p className="result-text error-message">{message}</p>
      <p className="result-text result-text--muted">
        Wezwij pracownika recepcji — stan sesji jest widoczny w CRM.
      </p>
      <button type="button" className="btn btn--primary error-ok" onClick={onAcknowledge}>
        OK
      </button>
    </div>
  );
}
