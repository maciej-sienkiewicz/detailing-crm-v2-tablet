/** Walidacja zapisanego tokenu przy starcie (GET /api/tablet/context). */
export function Connecting() {
  return (
    <div className="screen connecting-screen">
      <div className="spinner spinner--large" />
      <p className="submitting-text">Łączenie…</p>
    </div>
  );
}
