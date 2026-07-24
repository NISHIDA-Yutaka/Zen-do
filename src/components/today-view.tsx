"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import { TaskMeta } from "@/components/task-meta";
import {
  getJson,
  HABITS_KEY,
  makeOptimisticItem,
  postJson,
  revalidateLists,
  TODAY_KEY,
} from "@/lib/client";
import type { Habit, Item } from "@/lib/types";
import { mutate as globalMutate } from "swr";

type TodayData = { date: string; todos: Item[]; habitCandidates: Habit[]; done: Item[] };
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

  async function postpone(item: Item) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    try {
      await mutate(
        async () => {
          await postJson(`/api/items/${item.id}/postpone`);
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

  if (isLoading && !data) return <p className="text-nibi text-sm">読み込み中…</p>;
  if (!data) return <p className="text-beni text-sm">{loadError?.message ?? "読み込みに失敗しました"}</p>;

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">{formatHeading(data.date)}</h1>
        <p className="text-nibi text-xs">のこり {data.todos.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      <ul>
        {data.todos.map((item) => (
          <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
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
            <button
              type="button"
              disabled={busyIds.has(item.id) || item.id.startsWith("temp-")}
              onClick={() => postpone(item)}
              className="text-nibi hover:text-foreground hit shrink-0 text-xs"
            >
              明日へ
            </button>
          </li>
        ))}
      </ul>

      <QuickAddInline
        placeholder="タスクを追加…（今日の予定として入る）"
        onAdd={addTodo}
        smart
        defaultDueDate={data.date}
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
                  <span className="text-nibi min-w-0 flex-1 truncate text-sm line-through">
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
        <section className="bg-kinari mt-6 rounded-2xl px-4 py-3">
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
    </section>
  );
}
