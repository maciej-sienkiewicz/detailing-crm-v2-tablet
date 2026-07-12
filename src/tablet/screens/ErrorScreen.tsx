import { useState } from 'react';

interface ErrorScreenProps {
  message: string;
  onAcknowledge: () => void;
  /** Pełny reset urządzenia: czyści parowanie, cache i SW, po czym przeładowuje aplikację. */
  onFactoryReset: () => void;
}

/**
 * Czytelny komunikat błędu + powrót do czuwania. Stan sesji widzi pracownik w CRM.
 *
 * Dodatkowo wyjście awaryjne dla pracownika: gdy tablet zapętlił się na błędzie
 * (żądanie na serwerze wciąż aktywne, a lokalna powłoka aplikacji uszkodzona),
 * przycisk "Wyczyść dane tabletu" wykonuje pełny reset i wraca do parowania.
 * Reset wymaga jawnego potwierdzenia — kiosk stoi przed klientem.
 */
export function ErrorScreen({ message, onAcknowledge, onFactoryReset }: ErrorScreenProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (confirmingReset) {
    return (
      <div className="screen error-screen">
        <div className="result-icon result-icon--error" aria-hidden="true">
          !
        </div>
        <h1 className="result-title">Wyczyścić dane tabletu?</h1>
        <p className="result-text error-message">
          Tablet zostanie rozłączony z systemem, a wszystkie dane lokalne (parowanie i pamięć
          podręczna aplikacji) zostaną usunięte.
        </p>
        <p className="result-text result-text--muted">
          Po resecie konieczne będzie ponowne sparowanie kodem wygenerowanym w CRM.
        </p>
        <div className="error-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={resetting}
            onClick={() => setConfirmingReset(false)}
          >
            Anuluj
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={resetting}
            onClick={() => {
              setResetting(true);
              onFactoryReset();
            }}
          >
            {resetting ? 'Czyszczenie…' : 'Tak, wyczyść i rozłącz'}
          </button>
        </div>
      </div>
    );
  }

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
      <button
        type="button"
        className="btn btn--ghost error-reset"
        onClick={() => setConfirmingReset(true)}
      >
        Dla pracownika: wyczyść dane tabletu
      </button>
    </div>
  );
}
