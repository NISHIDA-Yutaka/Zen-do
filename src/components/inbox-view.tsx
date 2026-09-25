"use client";

import { Fragment, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import { ChildTaskRows, ExpandToggle, toggleIn } from "@/components/task-children";
import { DurationLabel, TaskMeta } from "@/components/task-meta";
import { useContextMenu } from "@/components/task-context-menu";
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
import { nestChildren } from "@/lib/task-tree";
import type { Item } from "@/lib/types";
import { useListKeyboard } from "@/lib/use-list-keyboard";
import { cn } from "@/lib/utils";

type ItemResult = { item: Item };
// children は with_children=1 で同梱される未完了の子（親の下に展開する）
type ListResult = { items: Item[]; children: Item[] };

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
  // 畳んだ親のid。既定は全部開いた状態なので、閉じたものだけ持つ
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const items = inboxData?.items ?? [];
  const upcoming = [...(upData?.items ?? [])].sort((a, b) =>
    (a.due_date ?? "").localeCompare(b.due_date ?? ""),
  );
  const inboxChildren = inboxData?.children ?? [];
  const upChildren = upData?.children ?? [];
  // キャッシュを書き換えるときに子を落とさないよう、一覧の差し替えは必ずこれを通す
  const inboxList = (list: Item[]): ListResult => ({ items: list, children: inboxChildren });
  const upList = (list: Item[]): ListResult => ({ items: list, children: upChildren });
  const inboxRows = nestChildren(items, inboxChildren);
  const upcomingRows = nestChildren(upcoming, upChildren);

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
            return inboxList([item, ...items.filter((i) => i.id !== temp.id)]);
          },
          {
            optimisticData: inboxList([temp, ...items]),
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
          optimisticData: upList(upcoming.filter((i) => i.id !== item.id)),
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

  // 未仕分けタスクをその場で完了（期日なしなので次回生成なし・リストから外れるだけ）
  async function complete(item: Item) {
    setError(null);
    setBusy(item.id, true);
    try {
      await mutateInbox(
        async () => {
          await postJson(`/api/items/${item.id}/complete`);
          return inboxList(items.filter((i) => i.id !== item.id));
        },
        {
          optimisticData: inboxList(items.filter((i) => i.id !== item.id)),
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 子の完了。子は未仕分けの親の下と「この先の予定」（自身に期日がある場合）の両方に出うるので、
  // 押した側だけ楽観的に外し、もう一方とTodayは横断再検証に任せる
  async function completeChild(child: Item, inUpcoming: boolean) {
    setError(null);
    setBusy(child.id, true);
    const without = (list: Item[]) => list.filter((i) => i.id !== child.id);
    const optimistic = inUpcoming
      ? { items: without(upcoming), children: without(upChildren) }
      : { items, children: without(inboxChildren) };
    try {
      await (inUpcoming ? mutateUp : mutateInbox)(
        async () => {
          await postJson(`/api/items/${child.id}/complete`);
          return undefined;
        },
        {
          optimisticData: optimistic,
          populateCache: false,
          revalidate: false,
          rollbackOnError: true,
        },
      );
      void revalidateLists();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(child.id, false);
    }
  }

  // キーボードのDeleteで破棄（dropped）
  async function drop(item: Item) {
    setError(null);
    setBusy(item.id, true);
    try {
      await mutateInbox(
        async () => {
          await postJson(`/api/items/${item.id}/drop`);
          return inboxList(items.filter((i) => i.id !== item.id));
        },
        {
          optimisticData: inboxList(items.filter((i) => i.id !== item.id)),
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  const { selectedId, listProps, focusList } = useListKeyboard({
    ids: items.map((i) => i.id),
    onOpen: (id) => setOpenId(id),
    onComplete: (id) => {
      const it = items.find((i) => i.id === id);
      if (it) void complete(it);
    },
    onDrop: (id) => {
      const it = items.find((i) => i.id === id);
      if (it) void drop(it);
    },
  });

  // 「この先の予定」の行操作。明日へは日付更新のみ（予定内に残る）
  async function shiftUpcomingToTomorrow(item: Item) {
    setError(null);
    setBusy(item.id, true);
    try {
      await patchJson(`/api/items/${item.id}`, { due_date: addDays(today, 1) });
      await mutateUp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 予定から外れる操作（Inboxへ=期限削除 / 削除=破棄）を楽観的に除去して実行
  async function removeFromUpcoming(item: Item, action: () => Promise<void>, toInbox = false) {
    setError(null);
    setBusy(item.id, true);
    try {
      await mutateUp(
        async () => {
          await action();
          return undefined;
        },
        {
          optimisticData: upList(upcoming.filter((i) => i.id !== item.id)),
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
      if (toInbox) void globalMutate(INBOX_QUERY);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  const { open: openMenu, menu } = useContextMenu();

  // 所要時間の設定（右クリックメニュー）。一覧に留まるので楽観的に値だけ差し替える
  async function setDuration(item: Item, minutes: number | null, inUpcoming: boolean) {
    setError(null);
    setBusy(item.id, true);
    const swap = (list: Item[]) =>
      list.map((i) => (i.id === item.id ? { ...i, duration_min: minutes } : i));
    const target = inUpcoming ? mutateUp : mutateInbox;
    const next = inUpcoming ? upList(swap(upcoming)) : inboxList(swap(items));
    try {
      await target(
        async () => {
          await patchJson(`/api/items/${item.id}`, { duration_min: minutes });
          return next;
        },
        {
          optimisticData: next,
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
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
          return inboxList(items.filter((i) => i.id !== item.id));
        },
        {
          optimisticData: inboxList(items.filter((i) => i.id !== item.id)),
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
        <ul {...listProps} aria-label="未仕分けタスク">
          {inboxRows.map(({ item, children }) => {
            const busy = busyIds.has(item.id) || item.id.startsWith("temp-");
            const expanded = children.length > 0 && !collapsed.has(item.id);
            return (
              <Fragment key={item.id}>
                <li
                  onContextMenu={(e) => {
                    if (busy) return;
                    // 未仕分けは期限なし＝「Inboxへ」は無意味なので出さない
                    openMenu(e, [
                      { label: "明日へ", onSelect: () => triage(item, addDays(today, 1)) },
                      "separator",
                      {
                        kind: "duration",
                        current: item.duration_min,
                        onSelect: (m) => setDuration(item, m, false),
                      },
                      "separator",
                      { label: "削除", danger: true, onSelect: () => drop(item) },
                    ]);
                  }}
                  className={cn(
                    "border-keisen flex items-center gap-3 py-3",
                    !expanded && "border-b",
                    selectedId === item.id && "bg-kinari",
                  )}
                >
                  <ExpandToggle
                    count={children.length}
                    open={expanded}
                    onToggle={() => setCollapsed((s) => toggleIn(s, item.id))}
                  />
                  <button
                    type="button"
                    aria-label={`${item.title}を完了`}
                    disabled={busy}
                    onClick={() => complete(item)}
                    className="border-wakuiro hover:border-tokiwa hit size-6 shrink-0 rounded-full border-[1.75px] disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={() => !item.id.startsWith("temp-") && setOpenId(item.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-sm font-medium break-words">{item.title}</span>
                    {item.duration_min !== null && (
                      <span className="mt-0.5 block">
                        <DurationLabel minutes={item.duration_min} />
                      </span>
                    )}
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
                {expanded && (
                  <ChildTaskRows
                    items={children}
                    today={today}
                    busyIds={busyIds}
                    onComplete={(c) => completeChild(c, false)}
                    onOpen={setOpenId}
                  />
                )}
              </Fragment>
            );
          })}
        </ul>
      )}

      <QuickAddInline placeholder="タスクや思いつきを入力…" onAdd={capture} smart onArrowUp={() => focusList(true)} />
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
              {upcomingRows.map(({ item, children }) => {
                const expanded = children.length > 0 && !collapsed.has(item.id);
                return (
                  <Fragment key={item.id}>
                    <li
                      onContextMenu={(e) => {
                        if (busyIds.has(item.id)) return;
                        openMenu(e, [
                          { label: "明日へ", onSelect: () => shiftUpcomingToTomorrow(item) },
                          {
                            label: "Inboxへ",
                            onSelect: () =>
                              removeFromUpcoming(
                                item,
                                async () => {
                                  await patchJson(`/api/items/${item.id}`, {
                                    due_date: null,
                                    due_time: null,
                                    recurrence_rule: null,
                                  });
                                },
                                true,
                              ),
                          },
                          "separator",
                          {
                            kind: "duration",
                            current: item.duration_min,
                            onSelect: (m) => setDuration(item, m, true),
                          },
                          "separator",
                          {
                            label: "削除",
                            danger: true,
                            onSelect: () =>
                              removeFromUpcoming(item, async () => {
                                await postJson(`/api/items/${item.id}/drop`);
                              }),
                          },
                        ]);
                      }}
                      className={cn("border-keisen flex items-center gap-3 py-3", !expanded && "border-b")}
                    >
                      <ExpandToggle
                        count={children.length}
                        open={expanded}
                        onToggle={() => setCollapsed((s) => toggleIn(s, item.id))}
                      />
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
                    {expanded && (
                      <ChildTaskRows
                        items={children}
                        today={today}
                        busyIds={busyIds}
                        onComplete={(c) => completeChild(c, true)}
                        onOpen={setOpenId}
                      />
                    )}
                  </Fragment>
                );
              })}
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

      {menu}
    </section>
  );
}
