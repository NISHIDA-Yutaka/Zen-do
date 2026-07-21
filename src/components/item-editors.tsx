"use client";

import { useEffect, useState } from "react";
import { isoWeekday } from "@/lib/date";
import { getJson } from "@/lib/client";
import type { Item, RecurrenceRule, Reminder, ReminderRule } from "@/lib/types";
import { formatReminderRule } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { n: 1, label: "月" },
  { n: 2, label: "火" },
  { n: 3, label: "水" },
  { n: 4, label: "木" },
  { n: 5, label: "金" },
  { n: 6, label: "土" },
  { n: 7, label: "日" },
];

export function SegButton({
  on,
  onClick,
  children,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-40",
        on ? "border-mikan bg-mikan text-white" : "border-wakuiro text-foreground/80 hover:bg-kinari",
      )}
    >
      {children}
    </button>
  );
}

export function Stepper({
  value,
  min,
  max,
  suffix,
  prefix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix: string;
  prefix: string;
  onChange: (n: number) => void;
}) {
  return (
    <span className="text-foreground/80 flex items-center gap-2.5 text-xs">
      <button
        type="button"
        aria-label="減らす"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="border-wakuiro hover:bg-kinari flex size-6.5 items-center justify-center rounded-lg border font-bold disabled:opacity-40"
      >
        −
      </button>
      <b className="tabular-nums">
        {prefix}
        {value}
        {suffix}
      </b>
      <button
        type="button"
        aria-label="増やす"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className="border-wakuiro hover:bg-kinari flex size-6.5 items-center justify-center rounded-lg border font-bold disabled:opacity-40"
      >
        ＋
      </button>
    </span>
  );
}

// 繰り返しエディタ（docs/design.md 7.2）。期日なしでは設定不可
export function RecurrenceEditor({
  rule,
  hasDue,
  today,
  onChange,
}: {
  rule: RecurrenceRule | null;
  hasDue: boolean;
  today: string;
  onChange: (rule: RecurrenceRule | null) => void;
}) {
  if (!hasDue) {
    return <p className="text-nibi py-1 text-xs">先に期日を設定すると繰り返しを選べます</p>;
  }
  const type = rule?.type ?? null;
  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap gap-1.5">
        <SegButton on={type === null} onClick={() => onChange(null)}>
          なし
        </SegButton>
        <SegButton on={type === "daily"} onClick={() => onChange({ type: "daily" })}>
          毎日
        </SegButton>
        <SegButton
          on={type === "weekly"}
          onClick={() => onChange({ type: "weekly", weekdays: [isoWeekday(today)] })}
        >
          毎週
        </SegButton>
        <SegButton
          on={type === "monthly_day"}
          onClick={() => onChange({ type: "monthly_day", day: Number(today.slice(8)) })}
        >
          毎月
        </SegButton>
        <SegButton
          on={type === "interval_days"}
          onClick={() => onChange({ type: "interval_days", n: 2, from: "schedule" })}
        >
          n日おき
        </SegButton>
      </span>

      {rule?.type === "weekly" && (
        <span className="flex flex-wrap gap-1">
          {WEEKDAYS.map((w) => {
            const on = rule.weekdays.includes(w.n);
            return (
              <SegButton
                key={w.n}
                on={on}
                onClick={() => {
                  const next = on
                    ? rule.weekdays.filter((d) => d !== w.n)
                    : [...rule.weekdays, w.n].sort();
                  if (next.length > 0) onChange({ type: "weekly", weekdays: next });
                }}
              >
                {w.label}
              </SegButton>
            );
          })}
        </span>
      )}

      {rule?.type === "monthly_day" && (
        <Stepper
          value={rule.day}
          min={1}
          max={31}
          prefix="毎月 "
          suffix="日"
          onChange={(day) => onChange({ type: "monthly_day", day })}
        />
      )}

      {rule?.type === "interval_days" && (
        <span className="flex flex-col gap-2">
          <Stepper
            value={rule.n}
            min={1}
            max={365}
            prefix=""
            suffix="日おき"
            onChange={(n) => onChange({ ...rule, n })}
          />
          <span className="flex gap-1.5">
            <SegButton on={rule.from === "schedule"} onClick={() => onChange({ ...rule, from: "schedule" })}>
              期日基準
            </SegButton>
            <SegButton on={rule.from === "completion"} onClick={() => onChange({ ...rule, from: "completion" })}>
              完了日基準
            </SegButton>
          </span>
          <span className="text-nibi text-[10.5px]">
            期日基準=元のペースを保つ / 完了日基準=完了した日からn日後
          </span>
        </span>
      )}
    </span>
  );
}

// リマインダーエディタ（docs/design.md 7.2）。プリセット5種、n分前系は時刻なしでグレーアウト
export function ReminderEditor({
  reminders,
  dueDate,
  dueTime,
  onSave,
}: {
  reminders: Reminder[];
  dueDate: string | null;
  dueTime: string | null;
  onSave: (rules: ReminderRule[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [atValue, setAtValue] = useState("");
  const rules = reminders.map((r) => r.rule);

  function add(rule: ReminderRule) {
    onSave([...rules, rule]);
    setAdding(false);
    setAtValue("");
  }

  const needsDue = !dueDate;
  const needsTime = !dueDate || !dueTime;
  const minuteTitle = needsTime ? "期日に時刻を設定すると選べます" : undefined;

  return (
    <span className="flex w-full flex-col gap-1.5">
      {reminders.map((r, i) => (
        <span key={r.id} className="flex items-center gap-2 text-xs">
          <span className="text-foreground/90">{formatReminderRule(r.rule)}</span>
          <button
            type="button"
            aria-label="このリマインダーを削除"
            onClick={() => onSave(rules.filter((_, j) => j !== i))}
            className="text-nibi/60 hover:text-foreground hit-y text-sm"
          >
            ✕
          </button>
        </span>
      ))}
      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-mikan hit-y self-start text-xs font-bold"
        >
          ＋ 追加
        </button>
      ) : (
        <span className="border-keisen flex w-fit flex-col overflow-hidden rounded-xl border text-xs">
          <PresetRow disabled={needsDue} title={needsDue ? "先に期日を設定してください" : undefined} onClick={() => add({ kind: "on_due_at", time: "08:35" })}>
            当日の朝 8:35
          </PresetRow>
          <PresetRow disabled={needsTime} title={minuteTitle} onClick={() => add({ kind: "before_due_minutes", minutes: 60 })}>
            1時間前
          </PresetRow>
          <PresetRow disabled={needsTime} title={minuteTitle} onClick={() => add({ kind: "before_due_minutes", minutes: 30 })}>
            30分前
          </PresetRow>
          <PresetRow disabled={needsTime} title={minuteTitle} onClick={() => add({ kind: "before_due_minutes", minutes: 10 })}>
            10分前
          </PresetRow>
          <span className="border-keisen flex items-center gap-1.5 border-t px-3 py-2">
            <input
              type="datetime-local"
              value={atValue}
              onChange={(e) => setAtValue(e.target.value)}
              aria-label="日時を指定"
              className="border-wakuiro rounded-md border px-1.5 py-1 text-[11px] outline-none"
            />
            <button
              type="button"
              disabled={!atValue}
              onClick={() => add({ kind: "at", at: `${atValue}:00+09:00` })}
              className="text-mikan font-bold disabled:opacity-40"
            >
              追加
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-nibi">
              閉じる
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

function PresetRow({
  disabled,
  title,
  onClick,
  children,
}: {
  disabled: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="border-keisen hover:bg-kinari border-b px-3 py-2 text-left disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// プロジェクト選択（docs/design.md 7.2）。検索付きリスト＋「なし」
export function ProjectPicker({
  selfId,
  currentParentId,
  onChange,
}: {
  selfId: string;
  currentParentId: string | null;
  onChange: (parentId: string | null) => void;
}) {
  const [projects, setProjects] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    getJson<{ items: Item[] }>("/api/items?kind=project&status=todo")
      .then((r) => setProjects(r.items.filter((p) => p.id !== selfId)))
      .catch(() => setProjects([]));
  }, [selfId]);

  const filtered = (projects ?? []).filter((p) => p.title.includes(q));

  return (
    <span className="flex w-full max-w-65 flex-col gap-1.5">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="プロジェクトを検索…"
        aria-label="プロジェクトを検索"
        className="border-wakuiro focus:border-mikan rounded-lg border px-2.5 py-1.5 text-xs outline-none"
      />
      <span className="border-keisen flex max-h-40 flex-col overflow-y-auto rounded-xl border text-xs">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "border-keisen hover:bg-kinari border-b px-3 py-2 text-left",
            currentParentId === null && "bg-mikan-soft font-bold",
          )}
        >
          なし
        </button>
        {projects === null ? (
          <span className="text-nibi px-3 py-2">読み込み中…</span>
        ) : filtered.length === 0 ? (
          <span className="text-nibi px-3 py-2">見つかりません</span>
        ) : (
          filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
              className={cn(
                "border-keisen hover:bg-kinari truncate border-b px-3 py-2 text-left last:border-b-0",
                currentParentId === p.id && "bg-mikan-soft font-bold",
              )}
            >
              {p.title}
            </button>
          ))
        )}
      </span>
    </span>
  );
}
