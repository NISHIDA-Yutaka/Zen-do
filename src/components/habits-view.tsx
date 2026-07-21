"use client";

import { useCallback, useEffect, useState } from "react";
import { HabitModal } from "@/components/habit-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import type { HabitRow } from "@/app/api/habits/route";
import type { HabitStats } from "@/lib/habit-stats";
import { getJson, postJson } from "@/lib/client";
import { cn } from "@/lib/utils";

type HabitsData = { habits: HabitRow[]; date: string };

export function HabitsView() {
  const [habits, setHabits] = useState<HabitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [pausedOpen, setPausedOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    getJson<HabitsData>("/api/habits")
      .then((r) => setHabits(r.habits))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Todayタスク化ボタンの3状態遷移（instantiate / complete / uncomplete）
  async function onTodayAction(h: HabitRow) {
    setBusy(h.id, true);
    setError(null);
    try {
      if (h.todayInstance === null) {
        await postJson(`/api/habits/${h.id}/instantiate`);
      } else if (h.todayInstance === "todo" && h.todayItemId) {
        await postJson(`/api/items/${h.todayItemId}/complete`);
      } else if (h.todayInstance === "done" && h.todayItemId) {
        await postJson(`/api/items/${h.todayItemId}/uncomplete`);
      }
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(h.id, false);
    }
  }

  // この画面はプレーン入力（Smart Inputの適用外。docs/design.md 11.1）
  async function addHabit(payload: QuickAddPayload) {
    setError(null);
    try {
      await postJson("/api/habits", { title: payload.title, frequency_rule: { type: "daily" } });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = habits.filter((h) => !h.is_paused);
  const paused = habits.filter((h) => h.is_paused);

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">Habits</h1>
        <p className="text-nibi text-xs">{active.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : active.length === 0 ? (
        <p className="text-nibi py-4 text-sm">習慣はまだありません。続けたいことを追加しましょう。</p>
      ) : (
        <div className="mt-2 space-y-2.5">
          {active.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              busy={busyIds.has(h.id)}
              onOpen={() => setOpenId(h.id)}
              onTodayAction={() => onTodayAction(h)}
            />
          ))}
        </div>
      )}

      {paused.length > 0 && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setPausedOpen((v) => !v)}
            className="text-nibi hit flex items-center gap-1.5 text-xs"
          >
            一時停止中 {paused.length}件 {pausedOpen ? "▾" : "▸"}
          </button>
          {pausedOpen && (
            <ul className="mt-1">
              {paused.map((h) => (
                <li key={h.id} className="border-keisen border-b py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenId(h.id)}
                    className="text-nibi w-full truncate text-left text-sm"
                  >
                    {h.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <QuickAddInline placeholder="習慣を追加…（既定は毎日）" onAdd={addHabit} />
      <QuickAddFab placeholder="習慣を追加…" onAdd={addHabit} />

      {openId && (
        <HabitModal
          habitId={openId}
          onClose={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function freqLabel(rule: HabitRow["frequency_rule"]): string {
  switch (rule.type) {
    case "daily":
      return "毎日";
    case "every_n_days":
      return `${rule.n}日に1回`;
    case "times_per_week":
      return `週${rule.n}回`;
  }
}

function HabitCard({
  habit,
  busy,
  onOpen,
  onTodayAction,
}: {
  habit: HabitRow;
  busy: boolean;
  onOpen: () => void;
  onTodayAction: () => void;
}) {
  const { stats } = habit;
  const won = stats.weekAchieved;

  return (
    <div className={cn("rounded-2xl border p-3.5", won ? "bg-tokiwa-soft border-tokiwa/30" : "border-keisen")}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="text-sm font-semibold">{habit.title}</div>
          <div className="text-nibi text-[11px]">{freqLabel(habit.frequency_rule)}</div>
        </button>
        <StreakBadge stats={stats} />
      </div>

      {stats.weekTarget > 0 && <WeekBar done={stats.weekDone} target={stats.weekTarget} />}

      <div className="mt-2 flex items-center justify-between gap-2">
        <ProgressText stats={stats} />
        <TodayButton habit={habit} busy={busy} onClick={onTodayAction} />
      </div>

      {stats.resting && stats.restDaysLeft !== null && (
        <p className="text-beni bg-beni-soft mt-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold">
          あと{stats.restDaysLeft}日で連続{stats.streak}
          {stats.streakUnit}が失われます — 今日やれば守れる
        </p>
      )}
    </div>
  );
}

function StreakBadge({ stats }: { stats: HabitStats }) {
  const dim = stats.resting;
  return (
    <div className="shrink-0 text-right leading-none">
      <b className={cn("text-[26px] font-extrabold tracking-tight tabular-nums", dim ? "text-nibi" : "text-tokiwa")}>
        {stats.streak}
      </b>
      <span className={cn("block text-[10px] font-bold", dim ? "text-nibi" : "text-tokiwa")}>
        {stats.streakUnit}連続{stats.resting ? "(おやすみ中)" : ""}
      </span>
    </div>
  );
}

function WeekBar({ done, target }: { done: number; target: number }) {
  return (
    <div className="mt-2.5 flex gap-1">
      {Array.from({ length: target }, (_, i) => (
        <span key={i} className={cn("h-2.5 flex-1 rounded-full", i < done ? "bg-tokiwa" : "bg-kinari")} />
      ))}
    </div>
  );
}

function ProgressText({ stats }: { stats: HabitStats }) {
  if (stats.nextLabel) {
    return <span className="text-foreground/80 text-xs font-bold">{stats.nextLabel}</span>;
  }
  if (stats.weekTarget === 7) {
    return <span className="text-foreground text-[13px] font-extrabold tabular-nums">今週 {stats.weekDone}/7</span>;
  }
  return (
    <span className={cn("text-[13px] font-extrabold tabular-nums", stats.weekAchieved ? "text-tokiwa" : "text-foreground")}>
      今週 {stats.weekDone}/{stats.weekTarget}
      {stats.weekAchieved ? " 達成！" : ""}
    </span>
  );
}

function TodayButton({ habit, busy, onClick }: { habit: HabitRow; busy: boolean; onClick: () => void }) {
  if (habit.todayInstance === "done") {
    return (
      <button type="button" disabled={busy} onClick={onClick} className="text-tokiwa hit-y shrink-0 text-[11.5px] font-bold">
        ✓ 今日は完了
      </button>
    );
  }
  if (habit.todayInstance === "todo") {
    return (
      <button type="button" disabled={busy} onClick={onClick} className="text-nibi hover:text-foreground hit-y shrink-0 text-[11.5px] font-semibold">
        Todayに追加済み
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="bg-mikan hit-y shrink-0 rounded-full px-4 py-1 text-xs font-bold text-white disabled:opacity-50"
    >
      ＋ 今日やる
    </button>
  );
}
