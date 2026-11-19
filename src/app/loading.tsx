export default function Loading() {
  return (
    <div className="loading-page" role="status">
      <div className="skeleton title" />
      <div className="metric-grid">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton metric" key={i} />
        ))}
      </div>
      <div className="skeleton table" />
      <span>Loading workspace…</span>
    </div>
  );
}
