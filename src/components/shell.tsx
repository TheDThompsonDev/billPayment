"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Files,
  ScanLine,
  ClipboardCheck,
  Building2,
  Users,
  ShieldCheck,
  ChevronDown,
  ArrowUpRight,
  Menu,
  X,
  Landmark,
  Search,
} from "lucide-react";
const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/bills", label: "All bills", icon: Files },
  { href: "/review", label: "Review queue", icon: ScanLine, count: "review" },
  {
    href: "/approvals",
    label: "Approvals",
    icon: ClipboardCheck,
    count: "approvals",
  },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/vendors", label: "Vendors", icon: Users },
  { href: "/policies", label: "Policies", icon: ShieldCheck },
];
export function Shell({
  children,
  counts,
  user,
  livePaymentsEnabled = false,
}: {
  children: React.ReactNode;
  counts: { review: number; approvals: number };
  user: { id: string; name: string; role: string };
  livePaymentsEnabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  async function switchUser(id: string) {
    setError("");
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id }),
      });
      if (!r.ok) throw new Error("Could not switch persona");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <Link className="brand" href="/">
          <span className="brand-symbol">
            <Landmark size={23} />
          </span>
          <div>
            DSD<span>PROPERTY OPERATIONS</span>
          </div>
        </Link>
        <div className="workspace">
          <span className="workspace-icon">D</span>
          <div>
            DSD Property Group<small>North Texas portfolio</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item, i) => (
            <div key={item.href}>
              {i === 4 ? (
                <div className="nav-label second">MANAGEMENT</div>
              ) : null}
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className={`nav-item ${(item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "active" : ""}`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.count && counts[item.count as keyof typeof counts] > 0 ? (
                  <b>{counts[item.count as keyof typeof counts]}</b>
                ) : null}
              </Link>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/upload" className="demo-invite">
            <span className="eyebrow">BUILT FOR THE COHORT</span>
            <strong>
              See the workflow in action <ArrowUpRight size={16} />
            </strong>
            <p>Six scenarios. Every decision explained.</p>
          </Link>
          <div className="persona">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </span>
            <div>
              <label htmlFor="persona">Demo persona</label>
              <select
                id="persona"
                value={user.id}
                onChange={(e) => switchUser(e.target.value)}
              >
                <option value="analyst">Alex · AP analyst</option>
                <option value="manager">Jamie · Property manager</option>
                <option value="regional">Sarah · Regional manager</option>
                <option value="director">Morgan · Director</option>
              </select>
            </div>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              aria-label={open ? "Close navigation" : "Open navigation"}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {pathname === "/upload"
                ? "Upload bill"
                : pathname.startsWith("/bills/")
                  ? "Bill details"
                  : (nav.find((n) => n.href === pathname)?.label ?? "Overview")}
            </strong>
          </div>
          <div className="topbar-right">
            <Link
              href="/bills"
              aria-label="Search bills"
              className="search-shortcut"
            >
              <Search size={16} />
              <span>Find a bill</span>
            </Link>
            <span className="demo-badge">
              <span /> DEMO WORKSPACE
            </span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="app-footer">
          <span>DSD Property Bill Automation</span>
          <span>
            <ShieldCheck size={13} />{" "}
            {livePaymentsEnabled
              ? "Live browser execution enabled. Approved external payments can move real money."
              : "All payments are simulated. No real money moves."}
          </span>
        </footer>
      </div>
    </div>
  );
}
