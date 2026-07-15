"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getJson, INBOX_CHANGED_EVENT } from "@/lib/client";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox" },
  { href: "/today", label: "Today" },
  { href: "/projects", label: "Projects" },
  { href: "/habits", label: "Habits" },
  { href: "/notes", label: "Notes" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () =>
      getJson<{ items: Item[] }>("/api/items?kind=inbox")
        .then((r) => setInboxCount(r.items.length))
        .catch(() => setInboxCount(null));
    refresh();
    window.addEventListener(INBOX_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT, refresh);
  }, [pathname]);

  return (
    <nav className="flex gap-1 overflow-x-auto border-b px-4 py-2">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
            pathname.startsWith(item.href)
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {item.label}
          {item.href === "/inbox" && inboxCount ? (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs">
              {inboxCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
