"use client";

import { useCallback, useEffect, useState } from "react";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import { TaskMeta } from "@/components/task-meta";
import { addDays, todayInJst } from "@/lib/date";
import { getJson, INBOX_QUERY, notifyInboxChanged, patchJson, postJson } from "@/lib/client";
import type { Item } from "@/lib/types";

type ItemResult = { item: Item };
type ListResult = { items: Item[] };

export function InboxView() {
  const [items, setItems] = useState<Item[]>([]);
  const [upcoming, setUpcoming] = useState<Item[]>([]);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayInJst();

  const load = useCallback(() => {
    getJson<ListResult>(INBOX_QUERY)
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // この先の予定（docs/design.md 12章）。親の有無を問わず未来日付の未完了タスク
    getJson<ListResult>(`/api/items?kind=todo&status=todo&due_after=${todayInJst()}`)
      .then((r) => setUpcoming([...r.items].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 日付トークンがあれば期日つきで作成＝Inboxビューには残らない（docs/design.md 11.4）
  async function capture(payload: QuickAddPayload) {
    setError(null);
    try {
      const { item } = await postJson<ItemResult>("/api/items", payload);
      if (item.due_date === null && item.parent_id === null) setItems((prev) => [item, ...prev]);
      else load();
      notifyInboxChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // 予定リストの行はその場で完了できる（繰り返しなら次回が生成され、リストに残る）
  async function completeUpcoming(item: Item) {
    setError(null);
    setBusyIds((prev) => new Set(prev).add(item.id));
    setUpcoming((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await postJson(`/api/items/${item.id}/complete`);
      load();
    } catch (e) {
      setUpcoming((prev) => [item, ...prev]);
      setError((e as Error).message);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
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
      // 「明日」なら同じ画面の「この先の予定」へ移動するので再読込で反映
      if (dueDate > today) load();
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
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                >
                  {item.title}
                </button>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => triage(item, todayInJst())}
                    className="border-wakuiro text-foreground/80 hover:bg-kinari hit-y rounded-lg border px-3 py-1 text-xs font-semibold"
                  >
                    今日
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => triage(item, addDays(todayInJst(), 1))}
                    className="border-wakuiro text-foreground/80 hover:bg-kinari hit-y rounded-lg border px-3 py-1 text-xs font-semibold"
                  >
                    明日
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <QuickAddInline placeholder="タスクや思いつきを入力…" onAdd={capture} smart />
      <QuickAddFab placeholder="タスクや思いつきを入力…" onAdd={capture} smart />

      {upcoming.length > 0 && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setUpcomingOpen((v) => !v)}
            className="text-nibi hit flex items-center gap-1.5 text-xs"
          >
            この先の予定 {upcoming.length}件 {upcomingOpen ? "▾" : "▸"}
          </button>
          {upcomingOpen && (
            <ul className="mt-1">
              {upcoming.map((item) => (
                <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                  <button
                    type="button"
                    aria-label={`${item.title}を完了`}
                    disabled={busyIds.has(item.id)}
                    onClick={() => completeUpcoming(item)}
                    className="border-wakuiro hover:border-tokiwa hit size-6 shrink-0 rounded-full border-[1.75px]"
                  />
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <TaskMeta item={item} today={today} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openId && (
        <ItemModal
          itemId={openId}
          onClose={() => {
            setOpenId(null);
            load();
            notifyInboxChanged();
          }}
        />
      )}
    </section>
  );
}
