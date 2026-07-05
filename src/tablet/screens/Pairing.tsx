import { useState } from 'react';

interface PairingProps {
  errorMessage: string | null;
  onPair: (pairingCode: string, deviceName: string) => Promise<void>;
}

const CODE_LENGTH = 6;
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * Ekran parowania: 6 pól na cyfry (auto-advance), ekranowa klawiatura
 * numeryczna, nazwa urządzenia i przycisk „Połącz”.
 */
export function Pairing({ errorMessage, onPair }: PairingProps) {
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);

  const appendDigit = (digit: string) => {
    if (busy) return;
    setCode((current) => (current.length < CODE_LENGTH ? current + digit : current));
  };

  const removeDigit = () => {
    if (busy) return;
    setCode((current) => current.slice(0, -1));
  };

  const canSubmit = code.length === CODE_LENGTH && deviceName.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onPair(code, deviceName.trim());
    } finally {
      setBusy(false);
      setCode('');
    }
  };

  return (
    <div className="screen pairing-screen">
      <div className="pairing-card">
        <h1 className="pairing-title">Sparuj tablet</h1>
        <p className="pairing-subtitle">
          Wpisz 6-cyfrowy kod wyświetlony w CRM (zakładka „Tablety” → „Dodaj tablet”)
        </p>

        <div className="code-boxes" aria-label="Kod parowania">
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <div
              key={i}
              className={`code-box${i === code.length ? ' code-box--active' : ''}`}
            >
              {code[i] ?? ''}
            </div>
          ))}
        </div>

        <div className="keypad">
          {KEYPAD.map((digit) => (
            <button
              key={digit}
              type="button"
              className={`keypad-btn${digit === '0' ? ' keypad-btn--zero' : ''}`}
              onClick={() => appendDigit(digit)}
              disabled={busy}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="keypad-btn keypad-btn--backspace"
            onClick={removeDigit}
            disabled={busy}
            aria-label="Usuń cyfrę"
          >
            ⌫
          </button>
        </div>

        <label className="device-name-label">
          Nazwa urządzenia
          <input
            type="text"
            className="device-name-input"
            placeholder="np. Recepcja 1"
            value={deviceName}
            maxLength={64}
            onChange={(event) => setDeviceName(event.target.value)}
            disabled={busy}
          />
        </label>

        {errorMessage && (
          <p className="pairing-error" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="button"
          className="btn btn--primary pairing-submit"
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          {busy ? 'Łączenie…' : 'Połącz'}
        </button>
      </div>
    </div>
  );
}
