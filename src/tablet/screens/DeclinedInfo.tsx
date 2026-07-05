/** Potwierdzenie odmowy podpisu — po chwili powrót do trybu czuwania. */
export function DeclinedInfo() {
  return (
    <div className="screen declined-screen">
      <div className="result-icon result-icon--neutral" aria-hidden="true">
        ✕
      </div>
      <h1 className="result-title">Odmowa została odnotowana</h1>
      <p className="result-text">Pracownik recepcji otrzymał informację o odmowie podpisu.</p>
    </div>
  );
}
