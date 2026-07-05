/**
 * Ekran wysyłania — serwer scala PDF i nakłada pieczęć (2–8 s).
 * Wszystkie interakcje zablokowane; submit NIGDY nie jest ponawiany
 * automatycznie (challenge jest jednorazowy).
 */
export function Submitting() {
  return (
    <div className="screen submitting-screen" aria-busy="true">
      <div className="spinner spinner--large" />
      <p className="submitting-text">Przetwarzanie podpisu…</p>
      <p className="submitting-subtext">To może potrwać kilka sekund</p>
    </div>
  );
}
