"use client";

import { useEffect, useState } from "react";
import { QuickAddFab, QuickAddInline } from "@/components/quick-add";
import { addDays, todayInJst } from "@/lib/date";
import { getJson, INBOX_QUERY, notifyInboxChanged, patchJson, postJson } from "@/lib/client";
import type { Item } from "@/lib/types";

type ItemResult = { item: Item };
type ListResult = { items: Item[] };

export function InboxView() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getJson<ListResult>(INBOX_QUERY)
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function capture(title: string) {
    setError(null);
    try {
      const { item } = await postJson<ItemResult>("/api/items", { title });
      setItems((prev) => [item, ...prev]);
      notifyInboxChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function triage(item: Item, dueDate: string) {
    setError(null);
    setBusyIds((prev) => new Set(prev).add(item.id));
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      // 仕分け=期日を設定するだけ（kindは既にtodo。docs/design.md 8章）
      await patchJson(`/api/items/${item.id}`, { due_date: dueDate });
      notifyInboxChanged();
    } catch (e) {
      setItems((prev) => [item, ...prev]);
      setError((e as Error).message);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">Inbox</h1>
        <p className="text-nibi text-xs">未仕分け {items.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="text-nibi py-4 text-sm">未仕分けはありません。身軽ですね。</p>
      ) : (
        <ul>
          {items.map((item) => {
            const busy = busyIds.has(item.id);
            return (
              <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => triage(item, todayInJst())}
                    className="border-wakuiro text-foreground/80 hover:bg-kinari rounded-lg border px-3 py-1 text-xs font-semibold"
                  >
                    今日
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => triage(item, addDays(todayInJst(), 1))}
                    className="border-wakuiro text-foreground/80 hover:bg-kinari rounded-lg border px-3 py-1 text-xs font-semibold"
                  >
                    明日
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <QuickAddInline placeholder="タスクや思いつきを入力…" onAdd={capture} />
      <QuickAddFab placeholder="タスクや思いつきを入力…" onAdd={capture} />
    </section>
  );
}
