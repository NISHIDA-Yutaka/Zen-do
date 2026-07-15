"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getJson, postJson } from "@/lib/client";
import type { Habit, Item } from "@/lib/types";

type TodayData = { date: string; todos: Item[]; habitCandidates: Habit[] };
type InstantiateResult = { item: Item };

export function TodayView() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getJson<TodayData>("/api/today")
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function setBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function removeTodo(item: Item, action: () => Promise<unknown>) {
    if (!data) return;
    setError(null);
    setBusy(item.id, true);
    setData({ ...data, todos: data.todos.filter((t) => t.id !== item.id) });
    try {
      await action();
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
    setData({ ...data, habitCandidates: data.habitCandidates.filter((h) => h.id !== habit.id) });
    try {
      const { item } = await postJson<InstantiateResult>(`/api/habits/${habit.id}/instantiate`);
      setData((d) => (d ? { ...d, todos: [...d.todos, item] } : d));
    } catch (e) {
      setData((d) => (d ? { ...d, habitCandidates: [habit, ...d.habitCandidates] } : d));
      setError((e as Error).message);
    } finally {
      setBusy(habit.id, false);
    }
  }

  if (loading) return <p className="text-muted-foreground text-sm">読み込み中…</p>;
  if (!data) return <p className="text-destructive text-sm">{error ?? "読み込みに失敗しました"}</p>;

  const nothingToDo = data.todos.length === 0 && data.habitCandidates.length === 0;

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Today</h1>
      <p className="text-muted-foreground mt-1 text-sm">{data.date} にやることだけ。</p>

      {error && <p className="text-destructive mt-3 text-sm">{error}</p>}

      {nothingToDo ? (
        <p className="text-muted-foreground mt-6 text-sm">今日のタスクはありません。ゆっくりどうぞ。</p>
      ) : null}

      {data.todos.length > 0 && (
        <ul className="mt-4 space-y-2">
          {data.todos.map((item) => {
            const overdue = item.due_date !== null && item.due_date < data.date;
            const busy = busyIds.has(item.id) || item.id.startsWith("temp-");
            return (
              <li
                key={item.id}
                className="bg-card flex items-center gap-2 rounded-lg border p-3"
              >
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="完了"
                  disabled={busy}
                  onClick={() => removeTodo(item, () => postJson(`/api/items/${item.id}/complete`))}
                >
                  ✓
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                {overdue && <span className="text-destructive shrink-0 text-xs">期限超過</span>}
                {item.habit_id && (
                  <span className="text-muted-foreground shrink-0 text-xs">習慣</span>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => removeTodo(item, () => postJson(`/api/items/${item.id}/postpone`))}
                >
                  明日へ
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {data.habitCandidates.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold">デイリープランナー</h2>
          <p className="text-muted-foreground mt-1 text-xs">今日やる習慣を選んで積む。</p>
          <ul className="mt-3 space-y-2">
            {data.habitCandidates.map((habit) => (
              <li
                key={habit.id}
                className="bg-card flex items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{habit.title}</span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busyIds.has(habit.id)}
                  onClick={() => pickHabit(habit)}
                >
                  追加
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
