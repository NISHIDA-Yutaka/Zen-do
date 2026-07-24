"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import { TaskMeta } from "@/components/task-meta";
import { addDays, todayInJst } from "@/lib/date";
import {
  getJson,
  INBOX_QUERY,
  makeOptimisticItem,
  patchJson,
  postJson,
  revalidateLists,
  TODAY_KEY,
  UPCOMING_KEY,
} from "@/lib/client";
import type { Item } from "@/lib/types";

type ItemResult = { item: Item };
type ListResult = { items: Item[] };

export function InboxView() {
  const today = todayInJst();
  const upcomingKey = `${UPCOMING_KEY}${today}`;
  const { data: inboxData, error: loadError, isLoading, mutate: mutateInbox } =
    useSWR<ListResult>(INBOX_QUERY, getJson);
  const { data: upData, mutate: mutateUp } = useSWR<ListResult>(upcomingKey, getJson);

  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const items = inboxData?.items ?? [];
  const upcoming = [...(upData?.items ?? [])].sort((a, b) =>
    (a.due_date ?? "").localeCompare(b.due_date ?? ""),
  );

  // 日付トークンがあれば期日つきで作成＝Inboxビューには残らない（docs/design.md 11.4）
  async function capture(payload: QuickAddPayload) {
    setError(null);
    // 期日なし＝Inboxに残るものだけ楽観的に即追加
    if (!payload.due_date && !payload.parent_id) {
      const temp = makeOptimisticItem({ title: payload.title, tags: payload.tags ?? [] });
      try {
        await mutateInbox(
          async () => {
            const { item } = await postJson<ItemResult>("/api/items", payload);
            return { items: [item, ...items.filter((i) => i.id !== temp.id)] };
          },
          {
            optimisticData: { items: [temp, ...items] },
            populateCache: true,
            revalidate: false,
            rollbackOnError: true,
          },
        );
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      try {
        await postJson<ItemResult>("/api/items", payload);
        void revalidateLists();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  function setBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // 予定リストの行はその場で完了できる（繰り返しなら次回が生成され、リストに残る）
  async function completeUpcoming(item: Item) {
    setError(null);
    setBusy(item.id, true);
    try {
      await mutateUp(
        async () => {
          await postJson(`/api/items/${item.id}/complete`);
          return undefined;
        },
        {
          optimisticData: { items: upcoming.filter((i) => i.id !== item.id) },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
      void globalMutate(TODAY_KEY);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function triage(item: Item, dueDate: string) {
    setError(null);
    setBusy(item.id, true);
    try {
      // 仕分け=期日を設定するだけ（kindは既にtodo。docs/design.md 8章）
      await mutateInbox(
        async () => {
          await patchJson(`/api/items/${item.id}`, { due_date: dueDate });
          return { items: items.filter((i) => i.id !== item.id) };
        },
        {
          optimisticData: { items: items.filter((i) => i.id !== item.id) },
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
      // 「明日」なら「この先の予定」へ、「今日」ならTodayへ移動するので該当キーを更新
      if (dueDate > today) void mutateUp();
      else void globalMutate(TODAY_KEY);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">Inbox</h1>
        <p className="text-nibi text-xs">未仕分け {items.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      {isLoading && !inboxData ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : loadError && !inboxData ? (
        <p className="text-beni py-4 text-sm">{loadError.message}</p>
      ) : items.length === 0 ? (
        <p className="text-nibi py-4 text-sm">未仕分けはありません。身軽ですね。</p>
      ) : (
        <ul>
          {items.map((item) => {
            const busy = busyIds.has(item.id) || item.id.startsWith("temp-");
            return (
              <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                <button
                  type="button"
                  onClick={() => !item.id.startsWith("temp-") && setOpenId(item.id)}
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
            void revalidateLists();
          }}
        />
      )}
    </section>
  );
}
