// Fallback affiché pendant le chargement d'un chunk de route (code splitting via
// React.lazy). Minimal, sans dépendance : un indicateur centré + keyframes inline.
export function PageLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        color: "#64748b",
        fontSize: 14,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          border: "2.5px solid #E2E8F0",
          borderTopColor: "#4F46E5",
          borderRadius: "50%",
          animation: "heureka-page-spin 0.7s linear infinite",
          marginRight: 10,
        }}
      />
      Chargement…
      <style>{"@keyframes heureka-page-spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
