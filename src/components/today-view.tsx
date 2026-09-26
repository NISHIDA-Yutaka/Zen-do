"use client";

import { Fragment, useRef, useState } from "react";
import useSWR from "swr";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import { ChildTaskRows, ExpandToggle, toggleIn } from "@/components/task-children";
import { TaskMeta } from "@/components/task-meta";
import { useContextMenu } from "@/components/task-context-menu";
import {
  getJson,
  HABITS_KEY,
  makeOptimisticItem,
  patchJson,
  postJson,
  revalidateLists,
  TODAY_KEY,
} from "@/lib/client";
import { addDays } from "@/lib/date";
import type { DuePatch } from "@/lib/due-input";
import { nestChildren } from "@/lib/task-tree";
import type { Habit, Item } from "@/lib/types";
import { useListKeyboard } from "@/lib/use-list-keyboard";
import { cn } from "@/lib/utils";
import { mutate as globalMutate } from "swr";

type TodayData = {
  date: string;
  todos: Item[];
  habitCandidates: Habit[];
  done: Item[];
  children: Item[];
};
type ItemResult = { item: Item };

type Toast = { itemId: string; title: string };

function formatHeading(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const youbi = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${youbi}）`;
}

export function TodayView({ initialItemId = null }: { initialItemId?: string | null }) {
  const { data, error: loadError, isLoading, mutate } = useSWR<TodayData>(TODAY_KEY, getJson);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  // 畳んだ親のid。既定は全部開いた状態なので、閉じたものだけ持つ
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 通知タップで /today?item=<id> に着地したら、そのタスクの詳細を開いた状態で始める
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function showToast(t: Toast) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  async function complete(item: Item) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await postJson(`/api/items/${item.id}/complete`);
          return undefined; // 応答は使わず revalidate に任せる（繰り返し次回生成などを正しく反映）
        },
        {
          optimisticData: {
            ...data,
            todos: data.todos.filter((t) => t.id !== item.id),
            done: [item, ...data.done],
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
      showToast({ itemId: item.id, title: item.title });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 子は todos（自身の期日が今日以前）と children の両方に居うるので、どちらからも外す
  async function completeChild(child: Item) {
    if (!data) return;
    setError(null);
    setBusy(child.id, true);
    try {
      await mutate(
        async () => {
          await postJson(`/api/items/${child.id}/complete`);
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            todos: data.todos.filter((t) => t.id !== child.id),
            children: data.children.filter((c) => c.id !== child.id),
            done: [child, ...data.done],
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
      showToast({ itemId: child.id, title: child.title });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(child.id, false);
    }
  }

  async function uncomplete(item: Item) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    setToast(null);
    try {
      await mutate(
        async () => {
          await postJson<ItemResult>(`/api/items/${item.id}/uncomplete`);
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            done: data.done.filter((t) => t.id !== item.id),
            todos: [item, ...data.todos],
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 期日を指定日に付け替える。今日=リストに残す（更新のみ）/ それ以外=Todayから外れるので楽観的に除去
  async function moveDue(item: Item, dueDate: string) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await patchJson(`/api/items/${item.id}`, { due_date: dueDate });
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            todos:
              dueDate === data.date
                ? data.todos.map((t) => (t.id === item.id ? { ...t, due_date: dueDate } : t))
                : data.todos.filter((t) => t.id !== item.id),
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 右クリックの日時の付け直し。今日以前ならリストに残して値を差し替え、先の日付なら楽観的に除去
  async function reschedule(item: Item, patch: DuePatch) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await patchJson(`/api/items/${item.id}`, patch);
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            todos:
              patch.due_date <= data.date
                ? data.todos.map((t) => (t.id === item.id ? { ...t, ...patch } : t))
                : data.todos.filter((t) => t.id !== item.id),
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
      if (patch.due_date > data.date) void revalidateLists();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 繰り越し（期日が今日より前）をまとめて今日へ。1件ずつ直すのが手間なので一括で。
  // 習慣は今日の分が既にあると一意制約で弾かれるため、成否を数えて残りを伝える
  async function moveCarriedToToday(carried: Item[]) {
    if (!data) return;
    const ids = carried.map((t) => t.id).filter((id) => !id.startsWith("temp-"));
    if (ids.length === 0) return;
    setError(null);
    for (const id of ids) setBusy(id, true);
    try {
      await mutate(
        async () => {
          const results = await Promise.allSettled(
            ids.map((id) => patchJson(`/api/items/${id}`, { due_date: data.date })),
          );
          const failed = results.filter((r) => r.status === "rejected");
          if (failed.length > 0) {
            const reason = (failed[0] as PromiseRejectedResult).reason as Error;
            setError(`${failed.length}件は今日へ移せませんでした（${reason.message}）`);
          }
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            todos: data.todos.map((t) =>
              ids.includes(t.id) ? { ...t, due_date: data.date } : t,
            ),
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      for (const id of ids) setBusy(id, false);
    }
  }

  // 所要時間・重要度の設定（右クリックメニュー）。一覧に出るだけなので他の行には影響しない
  async function setFields(item: Item, fields: Partial<Pick<Item, "duration_min" | "priority">>) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await patchJson(`/api/items/${item.id}`, fields);
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            todos: data.todos.map((t) => (t.id === item.id ? { ...t, ...fields } : t)),
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // 期限を外してInbox（未仕分け）へ送り、再スケジュールを促す。
  // 期日クリアに伴い繰り返しも外れる（DB制約 recurrence_requires_due_date）
  async function clearDue(item: Item) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await patchJson(`/api/items/${item.id}`, {
            due_date: null,
            due_time: null,
            recurrence_rule: null,
          });
          return undefined;
        },
        {
          optimisticData: { ...data, todos: data.todos.filter((t) => t.id !== item.id) },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  // キーボードのDeleteで破棄（dropped）。繰り返しは終了・子もまとめて破棄される
  async function drop(item: Item) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await postJson(`/api/items/${item.id}/drop`);
          return undefined;
        },
        {
          optimisticData: { ...data, todos: data.todos.filter((t) => t.id !== item.id) },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function pickHabit(habit: Habit) {
    if (!data) return;
    setError(null);
    setBusy(habit.id, true);
    try {
      await mutate(
        async () => {
          await postJson<ItemResult>(`/api/habits/${habit.id}/instantiate`);
          return undefined;
        },
        {
          optimisticData: {
            ...data,
            habitCandidates: data.habitCandidates.filter((h) => h.id !== habit.id),
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
      // 習慣カード側（Todayタスク化ボタンの3状態）も追従させる
      void globalMutate(HABITS_KEY);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(habit.id, false);
    }
  }

  // Smart Inputの解釈結果をそのまま反映。日付トークンがなければ今日（docs/design.md 11.4）
  async function addTodo(payload: QuickAddPayload) {
    if (!data) return;
    setError(null);
    const dueDate = payload.due_date ?? data.date;
    // 今日ぶんは楽観的に即追加。今日以外はこの画面に出ないので確定後に横断再検証
    if (dueDate === data.date) {
      const temp = makeOptimisticItem({
        title: payload.title,
        due_date: dueDate,
        due_time: payload.due_time ?? null,
        tags: payload.tags ?? [],
        parent_id: payload.parent_id ?? null,
      });
      try {
        await mutate(
          async () => {
            const { item } = await postJson<ItemResult>("/api/items", { kind: "todo", ...payload });
            return { ...data, todos: [...data.todos.filter((t) => t.id !== temp.id), item] };
          },
          {
            optimisticData: { ...data, todos: [...data.todos, temp] },
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
        await postJson<ItemResult>("/api/items", { kind: "todo", ...payload });
        void revalidateLists();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  // 親の下に入った子は単独の行にしない（キーボード操作も親の行だけ）
  const rows = data ? nestChildren(data.todos, data.children) : [];

  const { selectedId, listProps, focusList } = useListKeyboard({
    ids: rows.map((r) => r.item.id),
    onOpen: (id) => setOpenId(id),
    onComplete: (id) => {
      const it = data?.todos.find((t) => t.id === id);
      if (it) void complete(it);
    },
    onDrop: (id) => {
      const it = data?.todos.find((t) => t.id === id);
      if (it) void drop(it);
    },
  });

  const { open: openMenu, menu } = useContextMenu();

  // 期日が今日より前＝期限切れのまま日をまたいだもの。仕分け直しが要るので上にまとめる。
  // 一括移動は親の下に入った子も含める（今日の親の下で期限切れのまま残らないように）
  const isCarried = (t: Item) => data !== undefined && t.due_date !== null && t.due_date < data.date;
  const carriedRows = rows.filter((r) => isCarried(r.item)).length;
  const carried = data?.todos.filter(isCarried) ?? [];
  const carriedBusy = carried.some((t) => busyIds.has(t.id));

  if (isLoading && !data) return <p className="text-nibi text-sm">読み込み中…</p>;
  if (!data) return <p className="text-beni text-sm">{loadError?.message ?? "読み込みに失敗しました"}</p>;

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">{formatHeading(data.date)}</h1>
        <p className="text-nibi text-xs">のこり {data.todos.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      <ul {...listProps} aria-label="今日のタスク">
        {carriedRows > 0 && (
          <li className="flex items-center justify-between gap-2 pt-1 pb-1.5">
            <h2 className="text-nibi text-xs font-semibold">繰り越し {carriedRows}件</h2>
            <button
              type="button"
              disabled={carriedBusy}
              onClick={() => moveCarriedToToday(carried)}
              className="border-wakuiro hover:border-foreground hit-y shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
            >
              まとめて今日へ
            </button>
          </li>
        )}
        {rows.map(({ item, children }, i) => {
          const expanded = children.length > 0 && !collapsed.has(item.id);
          return (
            <Fragment key={item.id}>
              {carriedRows > 0 && i === carriedRows && (
                <li className="pt-4 pb-1.5">
                  <h2 className="text-nibi text-xs font-semibold">今日</h2>
                </li>
              )}
              <li
                onContextMenu={(e) => {
                  if (item.id.startsWith("temp-")) return;
                  openMenu(e, [
                    { label: "明日へ", onSelect: () => moveDue(item, addDays(data.date, 1)) },
                    { label: "Inboxへ", onSelect: () => clearDue(item) },
                    "separator",
                    {
                      kind: "due",
                      current: { date: item.due_date, time: item.due_time },
                      today: data.date,
                      recurring: item.recurrence_rule !== null,
                      onSelect: (patch) => reschedule(item, patch),
                      onClear: () => clearDue(item),
                    },
                    "separator",
                    {
                      kind: "duration",
                      current: item.duration_min,
                      onSelect: (m) => setFields(item, { duration_min: m }),
                    },
                    {
                      kind: "priority",
                      current: item.priority,
                      onSelect: (p) => setFields(item, { priority: p }),
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
                  disabled={busyIds.has(item.id) || item.id.startsWith("temp-")}
                  onClick={() => complete(item)}
                  className="border-wakuiro hover:border-tokiwa hit size-6 shrink-0 rounded-full border-[1.75px]"
                />
                <button
                  type="button"
                  onClick={() => !item.id.startsWith("temp-") && setOpenId(item.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <TaskMeta item={item} today={data.date} />
                </button>
                {item.due_date && item.due_date < data.date && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyIds.has(item.id) || item.id.startsWith("temp-")}
                      onClick={() => moveDue(item, data.date)}
                      className="border-wakuiro hover:border-foreground hit-y shrink-0 rounded-md border px-2 py-1 text-[11px] disabled:opacity-40"
                    >
                      今日へ
                    </button>
                    <button
                      type="button"
                      aria-label="期限を外してInboxへ送る"
                      disabled={busyIds.has(item.id) || item.id.startsWith("temp-")}
                      onClick={() => clearDue(item)}
                      className="text-nibi hover:text-foreground hit-y shrink-0 text-[11px] disabled:opacity-40"
                    >
                      Inboxへ
                    </button>
                  </span>
                )}
              </li>
              {expanded && (
                <ChildTaskRows
                  items={children}
                  today={data.date}
                  busyIds={busyIds}
                  onComplete={completeChild}
                  onOpen={setOpenId}
                />
              )}
            </Fragment>
          );
        })}
      </ul>

      <QuickAddInline
        placeholder="タスクを追加…（今日の予定として入る）"
        onAdd={addTodo}
        smart
        defaultDueDate={data.date}
        onArrowUp={() => focusList(true)}
      />

      {data.done.length > 0 && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            className="text-nibi hit flex items-center gap-1.5 text-xs"
          >
            <span className="text-tokiwa font-bold">✓</span>
            完了済み {data.done.length}件 {doneOpen ? "▾" : "▸"}
          </button>
          {doneOpen && (
            <ul>
              {data.done.map((item) => (
                <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                  <button
                    type="button"
                    aria-label={`${item.title}の完了を取り消す`}
                    disabled={busyIds.has(item.id)}
                    onClick={() => uncomplete(item)}
                    className="bg-tokiwa hit flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  >
                    ✓
                  </button>
                  <span className="text-nibi min-w-0 flex-1 text-sm line-through break-words">
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data.todos.length === 0 && data.habitCandidates.length === 0 && (
        <p className="text-nibi py-6 text-sm">今日のタスクはありません。ゆっくりどうぞ。</p>
      )}

      {data.habitCandidates.length > 0 && (
        // スマホ（FAB表示時）は下部の＋ボタンと被らないよう下マージンを確保。PC(fine)は不要
        <section className="bg-kinari mt-6 mb-24 rounded-2xl px-4 py-3 pointer-fine:mb-0">
          <h2 className="text-nibi text-xs font-semibold">今日の習慣</h2>
          <ul>
            {data.habitCandidates.map((habit) => (
              <li key={habit.id} className="flex items-center justify-between gap-2 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{habit.title}</span>
                <button
                  type="button"
                  disabled={busyIds.has(habit.id)}
                  onClick={() => pickHabit(habit)}
                  className="text-mikan hit text-xs font-bold"
                >
                  ＋ 追加
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <QuickAddFab placeholder="タスクを追加…" onAdd={addTodo} smart defaultDueDate={data.date} />

      {openId && (
        <ItemModal
          itemId={openId}
          onClose={() => {
            setOpenId(null);
            if (window.location.search) window.history.replaceState(null, "", "/today");
            void revalidateLists();
          }}
        />
      )}

      {toast && (
        <output className="bg-foreground text-background fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-md items-center justify-between rounded-xl px-4 py-3 text-xs shadow-2xl md:bottom-8">
          <span className="min-w-0 truncate">「{toast.title}」を完了しました</span>
          <button
            type="button"
            onClick={() => {
              const done = data.done.find((t) => t.id === toast.itemId);
              if (done) void uncomplete(done);
            }}
            className="text-mikan hit ml-3 shrink-0 font-bold"
          >
            取り消す
          </button>
        </output>
      )}

      {menu}
    </section>
  );
}
