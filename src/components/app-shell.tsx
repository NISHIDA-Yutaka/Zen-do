"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { getJson, INBOX_QUERY } from "@/lib/client";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

const MENU_ITEMS = [
  { href: "/inbox", label: "Inbox" },
  { href: "/today", label: "Today" },
  { href: "/projects", label: "Projects" },
  { href: "/habits", label: "Habits" },
  { href: "/notes", label: "Notes" },
];

const BOTTOM_NAV = MENU_ITEMS.slice(0, 4);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // バッジはInbox一覧と同一キーを共有＝1フェッチに集約され、仕分け等の mutate で自動追従する
  const { data: inboxData } = useSWR<{ items: Item[] }>(INBOX_QUERY, getJson);
  const inboxCount = inboxData?.items.length ?? 0;

  // ドロワーを開いたときだけ直近使用プロジェクトを取得（updated_at降順4件。docs/design.md 4章）
  const { data: projectData } = useSWR<{ items: Item[] }>(
    drawerOpen ? "/api/items?kind=project" : null,
    getJson,
  );
  const recentProjects = [...(projectData?.items ?? [])]
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 4);

  // スマホ: 左端からの右スワイプでドロワーを開く（ボタンなし。docs/design.md 2章）
  useEffect(() => {
    let startX: number | null = null;
    let startY: number | null = null;
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      startX = t.clientX <= 28 ? t.clientX : null;
      startY = t.clientY;
    }
    function onTouchMove(e: TouchEvent) {
      if (startX === null || startY === null) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 48 && dy < 40) {
        setDrawerOpen(true);
        startX = null;
      }
    }
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <>
      <header className="bg-kinari border-keisen hidden items-center gap-3 border-b px-4 py-2 md:flex">
        <button
          type="button"
          aria-label="メニューを開く"
          onClick={() => setDrawerOpen(true)}
          className="border-wakuiro bg-background text-nibi hover:text-foreground hit flex size-9 items-center justify-center rounded-lg border text-base"
        >
          ☰
        </button>
        <span className="text-sm font-extrabold tracking-wide">Zendo</span>
      </header>

      {drawerOpen && (
        <div
          role="presentation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/35"
        />
      )}
      <aside
        aria-hidden={!drawerOpen}
        className={cn(
          "bg-background fixed inset-y-0 left-0 z-50 w-64 py-4 shadow-2xl transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <p className="px-5 pb-3 text-base font-extrabold tracking-wide">Zendo</p>
        <nav aria-label="グローバルメニュー">
          {MENU_ITEMS.map((item) => (
            <DrawerLink
              key={item.href}
              href={item.href}
              label={item.label}
              active={pathname.startsWith(item.href)}
              badge={item.href === "/inbox" ? inboxCount : 0}
            />
          ))}
          {recentProjects.length > 0 && (
            <ul className="pb-1">
              {recentProjects.map((p) => (
                <li key={p.id}>
                  <Link
                    href="/projects"
                    className="text-nibi hover:text-foreground block truncate py-1.5 pr-4 pl-10 text-xs"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <hr className="border-keisen mx-5 my-2" />
          <DrawerLink href="/settings" label="Settings" active={pathname.startsWith("/settings")} badge={0} />
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-24 md:pb-8">{children}</main>

      <nav
        aria-label="メインナビゲーション"
        className="bg-kinari border-keisen fixed inset-x-0 bottom-0 z-30 flex justify-around border-t py-2.5 md:hidden"
      >
        {BOTTOM_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "hit-y relative flex items-center gap-1 px-2 py-1 text-xs",
                active
                  ? "text-foreground after:bg-mikan font-bold after:absolute after:-bottom-1 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:content-['']"
                  : "text-nibi",
              )}
            >
              {item.label}
              {item.href === "/inbox" && inboxCount > 0 && (
                <span className="bg-mikan rounded-full px-1.5 text-[10px] font-bold text-white">
                  {inboxCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function DrawerLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between py-2.5 pr-5 pl-5 text-sm",
        active
          ? "bg-mikan-soft border-mikan text-foreground border-l-[3px] pl-[17px] font-bold"
          : "text-nibi hover:text-foreground",
      )}
    >
      {label}
      {badge > 0 && (
        <span className="bg-mikan rounded-full px-1.5 text-[10px] font-bold text-white">{badge}</span>
      )}
    </Link>
  );
}
