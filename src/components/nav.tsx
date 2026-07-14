"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  return (
    <nav className="flex gap-1 overflow-x-auto border-b px-4 py-2">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
            pathname.startsWith(item.href)
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
