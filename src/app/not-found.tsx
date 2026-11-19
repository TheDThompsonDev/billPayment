import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>This bill or page wasn’t found</h1>
      <p>It may have been removed from this demonstration workspace.</p>
      <Link className="text-link" href="/bills">
        Back to all bills →
      </Link>
    </div>
  );
}
