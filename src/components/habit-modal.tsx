"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SegButton, Stepper } from "@/components/item-editors";
import type { HabitRow } from "@/app/api/habits/route";
import { deleteJson, getJson, patchJson } from "@/lib/client";
import { formatReminderRule } from "@/lib/format";
import type { FrequencyRule } from "@/lib/types";
import { cn } from "@/lib/utils";

// 習慣編集モーダル（docs/design.md 10.4）。ItemModalと同じ骨格・自動保存。
export function HabitModal({ habitId, onClose }: { habitId: string; onClose: () => void }) {
  const [habit, setHabit] = useState<HabitRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (window.history.state?.zendoModal) window.history.back();
    else onCloseRef.current();
  }, []);

  const load = useCallback(() => {
    getJson<{ habits: HabitRow[] }>("/api/habits")
      .then((r) => {
        const h = r.habits.find((x) => x.id === habitId);
        if (h) setHabit(h);
        else onCloseRef.current();
      })
      .catch((e: Error) => setError(e.message));
  }, [habitId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    window.history.pushState({ zendoModal: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  async function save(patch: Record<string, unknown>) {
    setError(null);
    try {
      const res = await patchJson<{ habit: HabitRow }>(`/api/habits/${habitId}`, patch);
      // statsは再取得が必要なので全体をload（頻度変更で指標が変わる）
      setHabit((h) => (h ? { ...h, ...res.habit } : h));
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function del() {
    if (!habit) return;
    if (!confirm(`「${habit.title}」を削除しますか？過去の実践ログは残ります。`)) return;
    try {
      await deleteJson(`/api/habits/${habitId}`);
      requestClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const stats = habit?.stats;
  const rule = habit?.frequency_rule;

  return (
    <div className="fixed inset-0 z-50">
      <div role="presentation" onClick={requestClose} className="absolute inset-0 bg-black/35" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="習慣の詳細"
        className="bg-background absolute inset-0 flex flex-col overflow-y-auto md:inset-auto md:top-12 md:left-1/2 md:max-h-[85vh] md:w-[430px] md:-translate-x-1/2 md:rounded-2xl md:shadow-2xl"
      >
        <header className="relative flex items-center justify-between px-4 pt-3">
          <button type="button" aria-label="閉じる" onClick={requestClose} className="text-nibi hover:text-foreground hit text-lg md:hidden">
            ←
          </button>
          <span className="text-nibi/70 text-[10.5px]">変更は自動保存されます</span>
          <span className="flex items-center gap-3.5">
            <button type="button" aria-label="その他の操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} className="text-nibi hover:text-foreground hit text-lg leading-none">
              ⋯
            </button>
            <button type="button" aria-label="閉じる" onClick={requestClose} className="text-nibi hover:text-foreground hit hidden text-base leading-none md:block">
              ✕
            </button>
          </span>
          {menuOpen && (
            <menu className="border-keisen bg-background absolute top-9 right-4 z-10 w-40 rounded-xl border py-1 text-xs shadow-xl">
              <li>
                <button type="button" onClick={del} className="text-beni hover:bg-beni-soft w-full px-4 py-2 text-left font-semibold">
                  削除
                </button>
              </li>
            </menu>
          )}
        </header>

        {error && <p className="text-beni px-4 pt-2 text-xs">{error}</p>}

        {!habit || !stats || !rule ? (
          <p className="text-nibi px-4 py-8 text-sm">読み込み中…</p>
        ) : (
          <>
            <TitleField key={habit.id} title={habit.title} onSave={(t) => save({ title: t })} />

            <div className="bg-tokiwa-soft mx-4 mt-3 flex items-center gap-4 rounded-2xl px-4 py-3">
              <div className="text-right leading-none">
                <b className={cn("text-[34px] font-extrabold tabular-nums", stats.resting ? "text-nibi" : "text-tokiwa")}>
                  {stats.streak}
                </b>
                <span className={cn("block text-[10px] font-bold", stats.resting ? "text-nibi" : "text-tokiwa")}>
                  {stats.streakUnit}連続
                </span>
              </div>
              <div className="min-w-0 flex-1">
                {stats.weekTarget > 0 && (
                  <div className="flex gap-1">
                    {Array.from({ length: stats.weekTarget }, (_, i) => (
                      <span key={i} className={cn("h-2.5 flex-1 rounded-full", i < stats.weekDone ? "bg-tokiwa" : "bg-background")} />
                    ))}
                  </div>
                )}
                <div className="text-foreground/80 mt-1.5 text-xs font-bold">
                  {stats.nextLabel ??
                    `今週 ${stats.weekDone}/${stats.weekTarget}${stats.weekAchieved ? " 達成！" : ""}`}
                </div>
                <div className="text-nibi mt-0.5 text-[10.5px]">直近4週の達成 {stats.fourWeekRate}%</div>
              </div>
            </div>

            <section className="px-4 pt-2">
              <div className="border-keisen border-b py-2.5">
                <span className="text-nibi text-xs">頻度</span>
                <div className="mt-2 flex flex-col gap-2">
                  <span className="flex gap-1.5">
                    <SegButton on={rule.type === "daily"} onClick={() => save({ frequency_rule: { type: "daily" } })}>
                      毎日
                    </SegButton>
                    <SegButton on={rule.type === "every_n_days"} onClick={() => save({ frequency_rule: { type: "every_n_days", n: 3 } })}>
                      n日に1回
                    </SegButton>
                    <SegButton on={rule.type === "times_per_week"} onClick={() => save({ frequency_rule: { type: "times_per_week", n: 3 } })}>
                      週n回
                    </SegButton>
                  </span>
                  {rule.type === "every_n_days" && (
                    <Stepper value={rule.n} min={2} max={365} prefix="" suffix="日に1回" onChange={(n) => save({ frequency_rule: { type: "every_n_days", n } as FrequencyRule })} />
                  )}
                  {rule.type === "times_per_week" && (
                    <Stepper value={rule.n} min={1} max={7} prefix="週 " suffix=" 回" onChange={(n) => save({ frequency_rule: { type: "times_per_week", n } as FrequencyRule })} />
                  )}
                </div>
              </div>

              <ReminderRow
                rule={habit.default_reminder_rule}
                onSave={(r) => save({ default_reminder_rule: r })}
              />

              <TagsRow tags={habit.tags} onSave={(tags) => save({ tags })} />

              <div className="border-keisen flex items-center justify-between border-b py-2.5 text-[13px]">
                <span>
                  <span className="text-nibi text-xs">一時停止</span>
                  <span className="text-nibi/70 ml-2 text-[11px]">再開するまで候補に出ません</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={habit.is_paused}
                  aria-label="一時停止"
                  onClick={() => save({ is_paused: !habit.is_paused })}
                  className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", habit.is_paused ? "bg-mikan" : "bg-wakuiro")}
                >
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", habit.is_paused ? "left-4.5" : "left-0.5")} />
                </button>
              </div>
            </section>

            <NotesField key={`n-${habit.id}`} notes={habit.notes} onSave={(n) => save({ notes: n })} />
            <div className="pb-6" />
          </>
        )}
      </section>
    </div>
  );
}

function ReminderRow({
  rule,
  onSave,
}: {
  rule: HabitRow["default_reminder_rule"];
  onSave: (r: HabitRow["default_reminder_rule"]) => void;
}) {
  const [time, setTime] = useState(rule?.kind === "on_due_at" ? rule.time : "08:35");
  return (
    <div className="border-keisen border-b py-2.5 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="text-nibi text-xs">リマインダー</span>
        {rule ? (
          <button type="button" onClick={() => onSave(null)} className="text-nibi/60 hover:text-foreground hit-y text-xs">
            なしにする
          </button>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {rule ? <span className="text-foreground/90">{formatReminderRule(rule)}</span> : <span className="text-nibi/70">なし</span>}
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="リマインダー時刻"
          className="border-wakuiro focus:border-mikan rounded-md border px-2 py-1 text-xs outline-none"
        />
        <button
          type="button"
          onClick={() => time && onSave({ kind: "on_due_at", time })}
          className="text-mikan hit-y text-xs font-bold"
        >
          当日この時刻に設定
        </button>
      </div>
    </div>
  );
}

function TitleField({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [v, setV] = useState(title);
  useEffect(() => setV(title), [title]);
  return (
    <input
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t === "") setV(title);
        else if (t !== title) onSave(t);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label="タイトル"
      className="focus:border-mikan mx-4 mt-1.5 border-b border-transparent bg-transparent pb-1 text-[16.5px] font-bold outline-none"
    />
  );
}

function NotesField({ notes, onSave }: { notes: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(notes);
  useEffect(() => setV(notes), [notes]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== notes) onSave(v);
      }}
      placeholder="メモを書く…"
      aria-label="メモ"
      rows={2}
      className="border-keisen placeholder:text-nibi/60 focus:border-mikan mx-4 mt-3 resize-y rounded-xl border px-3 py-2 text-xs outline-none"
    />
  );
}

function TagsRow({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");
  function commit() {
    const t = v.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) onSave([...tags, t]);
    setV("");
  }
  return (
    <div className="border-keisen flex items-center justify-between border-b py-2.5 text-[13px]">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-nibi mr-1 text-xs">タグ</span>
        {tags.length === 0 && !adding && <span className="text-nibi/70">なし</span>}
        {tags.map((t) => (
          <button key={t} type="button" title="タップで削除" onClick={() => onSave(tags.filter((x) => x !== t))} className="bg-kinari text-foreground/80 hover:bg-beni-soft hover:text-beni rounded-full px-2 py-px text-[10.5px] font-semibold">
            #{t}
          </button>
        ))}
        {adding && (
          <input
            autoFocus
            type="text"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => {
              commit();
              setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="タグ名"
            aria-label="新しいタグ"
            className="border-wakuiro focus:border-mikan w-24 rounded-md border px-1.5 py-0.5 text-[11px] outline-none"
          />
        )}
      </span>
      <button type="button" aria-label="タグを追加" onClick={() => setAdding((a) => !a)} className="text-mikan hit-y text-xs font-bold">
        ＋
      </button>
    </div>
  );
}
