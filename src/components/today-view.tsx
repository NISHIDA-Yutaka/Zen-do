"use client";

import { useEffect, useRef, useState } from "react";
import { QuickAddFab, QuickAddInline } from "@/components/quick-add";
import { getJson, postJson } from "@/lib/client";
import { formatDueLabel } from "@/lib/format";
import type { Habit, Item } from "@/lib/types";
import { cn } from "@/lib/utils";

type TodayData = { date: string; todos: Item[]; habitCandidates: Habit[]; done: Item[] };
type ItemResult = { item: Item };

type Toast = { itemId: string; title: string };

function formatHeading(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const youbi = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${youbi}）`;
}

export function TodayView() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getJson<TodayData>("/api/today")
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

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
    setData((d) =>
      d ? { ...d, todos: d.todos.filter((t) => t.id !== item.id), done: [item, ...d.done] } : d,
    );
    try {
      await postJson(`/api/items/${item.id}/complete`);
      showToast({ itemId: item.id, title: item.title });
    } catch (e) {
      setData((d) =>
        d ? { ...d, todos: [item, ...d.todos], done: d.done.filter((t) => t.id !== item.id) } : d,
      );
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function uncomplete(item: Item) {
    setError(null);
    setBusy(item.id, true);
    setToast(null);
    try {
      const { item: reopened } = await postJson<ItemResult>(`/api/items/${item.id}/uncomplete`);
      setData((d) =>
        d
          ? { ...d, done: d.done.filter((t) => t.id !== item.id), todos: [reopened, ...d.todos] }
          : d,
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
    setData((d) => (d ? { ...d, todos: d.todos.filter((t) => t.id !== item.id) } : d));
    try {
      await postJson(`/api/items/${item.id}/postpone`);
    } catch (e) {
      setData((d) => (d ? { ...d, todos: [item, ...d.todos] } : d));
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function pickHabit(habit: Habit) {
    if (!data) return;
    setError(null);
    setBusy(habit.id, true);
    setData((d) =>
      d ? { ...d, habitCandidates: d.habitCandidates.filter((h) => h.id !== habit.id) } : d,
    );
    try {
      const { item } = await postJson<ItemResult>(`/api/habits/${habit.id}/instantiate`);
      setData((d) => (d ? { ...d, todos: [...d.todos, item] } : d));
    } catch (e) {
      setData((d) => (d ? { ...d, habitCandidates: [habit, ...d.habitCandidates] } : d));
      setError((e as Error).message);
    } finally {
      setBusy(habit.id, false);
    }
  }

  async function addTodo(title: string) {
    if (!data) return;
    setError(null);
    try {
      const { item } = await postJson<ItemResult>("/api/items", {
        kind: "todo",
        title,
        due_date: data.date,
      });
      setData((d) => (d ? { ...d, todos: [...d.todos, item] } : d));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <p className="text-nibi text-sm">読み込み中…</p>;
  if (!data) return <p className="text-beni text-sm">{error ?? "読み込みに失敗しました"}</p>;

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
              disabled={busyIds.has(item.id)}
              onClick={() => complete(item)}
              className="border-wakuiro hover:border-tokiwa hit size-6 shrink-0 rounded-full border-[1.75px]"
            />
            <TaskMeta item={item} today={data.date} />
            <button
              type="button"
              disabled={busyIds.has(item.id)}
              onClick={() => postpone(item)}
              className="text-nibi hover:text-foreground hit shrink-0 text-xs"
            >
              明日へ
            </button>
          </li>
        ))}
      </ul>

      <QuickAddInline placeholder="タスクを追加…（今日の予定として入る）" onAdd={addTodo} />

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

      <QuickAddFab placeholder="タスクを追加…" onAdd={addTodo} />

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

function TaskMeta({ item, today }: { item: Item; today: string }) {
  const due = formatDueLabel(item.due_date, item.due_time, today);
  const chips: { text: string; tone: "beni" | "asagi" }[] = [];
  if (due?.late) chips.push({ text: "期限超過", tone: "beni" });
  if (item.habit_id) chips.push({ text: "習慣", tone: "asagi" });

  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{item.title}</span>
      {(due || chips.length > 0) && (
        <span className="mt-0.5 flex items-center gap-2">
          {due && (
            <span className={cn("text-[11px]", due.late ? "text-beni font-semibold" : "text-nibi")}>
              {due.text}
            </span>
          )}
          {chips.map((c) => (
            <span
              key={c.text}
              className={cn(
                "rounded-full px-2 py-px text-[10.5px] font-semibold",
                c.tone === "beni" ? "bg-beni-soft text-beni" : "bg-asagi-soft text-asagi",
              )}
            >
              {c.text}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
