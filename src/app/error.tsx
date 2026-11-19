"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>We couldn’t load this view</h1>
      <p>
        Check the local database setup and try again. Your saved bills remain in
        the database.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
