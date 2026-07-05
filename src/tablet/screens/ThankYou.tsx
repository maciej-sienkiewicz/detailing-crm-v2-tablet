/** Ekran podziękowania — po 4 s aplikacja sama wraca do trybu czuwania. */
export function ThankYou() {
  return (
    <div className="screen thankyou-screen">
      <div className="result-icon result-icon--success" aria-hidden="true">
        ✓
      </div>
      <h1 className="result-title">Dziękujemy!</h1>
      <p className="result-text">Dokument został podpisany.</p>
    </div>
  );
}
