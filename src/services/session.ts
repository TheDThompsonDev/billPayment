import { cookies } from "next/headers";
import { db } from "../database/client";
export async function currentUser() {
  const token = (await cookies()).get("dsd-session")?.value;
  const session = token
    ? await db.session.findUnique({
        where: { id: token },
        include: { user: true },
      })
    : null;
  if (session && session.expiresAt > new Date()) return session.user;
  // Demo browsing starts with the least-privileged seeded persona.
  return db.user.findUniqueOrThrow({ where: { id: "analyst" } });
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("Same-origin request required");
  const caller = new URL(origin);
  // Next may normalize request.url to localhost even when the browser uses 127.0.0.1.
  // Compare the actual Host header, and limit this unauthenticated demo to loopback.
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(caller.hostname) ||
    caller.host !== request.headers.get("host") ||
    caller.protocol !== new URL(request.url).protocol
  )
    throw new Error("Same-origin request required");
}
