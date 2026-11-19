import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
export function PageHeading({
  eyebrow,
  title,
  description,
  action = true,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: boolean;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? (
        <Button asChild>
          <Link href="/upload">
            <Plus size={17} /> Upload bill
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
