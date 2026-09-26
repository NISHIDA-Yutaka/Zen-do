"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type DuePatch, parseDueInput } from "@/lib/due-input";
import { parseDuration } from "@/lib/duration";
import { formatDueFull, formatDuration, PRIORITIES, PRIORITY_MEANING } from "@/lib/format";
import { isFinePointer } from "@/lib/pointer";
import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ContextMenuItem =
  | { label: string; onSelect: () => void; danger?: boolean }
  // 所要時間だけは選択肢が多いので、1行ずつ並べず専用の面として出す
  | { kind: "duration"; current: number | null; onSelect: (minutes: number | null) => void }
  | { kind: "priority"; current: Priority | null; onSelect: (p: Priority | null) => void }
  // 日時の付け直し。onClear が無い＝外す操作を出さない（期日の無いInboxのタスク）
  | {
      kind: "due";
      current: { date: string | null; time: string | null };
      today: string;
      recurring: boolean;
      onSelect: (patch: DuePatch) => void;
      onClear?: () => void;
    }
  | "separator";

type MenuState = { x: number; y: number; items: ContextMenuItem[] } | null;

export function useContextMenu() {
  const [state, setState] = useState<MenuState>(null);

  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    if (!isFinePointer()) return; // タッチ長押し由来の contextmenu は素通りさせる
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  const menu = state ? <ContextMenu state={state} onClose={close} /> : null;
  return { open, menu };
}

function ContextMenu({ state, onClose }: { state: NonNullable<MenuState>; onClose: () => void }) {
  const ref = useRef<HTMLMenuElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // 画面端で見切れないよう実寸を測ってクランプ
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(state.y, window.innerHeight - height - 8)),
    });
  }, [state]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <menu
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="border-keisen bg-background fixed z-50 w-56 rounded-xl border py-1 text-xs shadow-xl"
    >
      {state.items.map((it, i) =>
        it === "separator" ? (
          <li key={i} className="border-keisen my-1 border-t" aria-hidden />
        ) : "kind" in it && it.kind === "due" ? (
          <li key={i}>
            <DuePicker
              {...it}
              onSelect={(patch) => {
                it.onSelect(patch);
                onClose();
              }}
              onClear={
                it.onClear &&
                (() => {
                  it.onClear?.();
                  onClose();
                })
              }
            />
          </li>
        ) : "kind" in it && it.kind === "priority" ? (
          <li key={i}>
            <PriorityPicker
              current={it.current}
              onSelect={(p) => {
                it.onSelect(p);
                onClose();
              }}
            />
          </li>
        ) : "kind" in it ? (
          <li key={i}>
            <DurationPicker
              current={it.current}
              onSelect={(m) => {
                it.onSelect(m);
                onClose();
              }}
            />
          </li>
        ) : (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                it.onSelect();
                onClose();
              }}
              className={cn(
                "hover:bg-kinari w-full px-4 py-2 text-left",
                it.danger && "text-beni hover:bg-beni-soft font-semibold",
              )}
            >
              {it.label}
            </button>
          </li>
        ),
      )}
    </menu>
  );
}

function dueText(date: string, time: string | null, today: string): string {
  return formatDueFull(date, time, today).text;
}

// 今の日時の表示＋Smart Inputと同じ語彙の入力欄。入力中は解釈結果を下に出し、読めなければ枠を紅にする
function DuePicker({
  current,
  today,
  recurring,
  onSelect,
  onClear,
}: {
  current: { date: string | null; time: string | null };
  today: string;
  recurring: boolean;
  onSelect: (patch: DuePatch) => void;
  onClear?: () => void;
}) {
  const [text, setText] = useState("");
  const patch = parseDueInput(text, { today, currentDate: current.date });
  const invalid = text.trim() !== "" && patch === null;

  return (
    <div className="px-3 py-2">
      <p className="text-nibi pb-1">日時</p>
      <p className="flex items-center justify-between gap-2">
        <span className={cn("text-[12px]", current.date ? "font-semibold" : "text-nibi")}>
          {current.date ? dueText(current.date, current.time, today) : "なし"}
        </span>
        {onClear && current.date && (
          <button
            type="button"
            onClick={onClear}
            aria-label="日時を外す"
            // 期日を外すと繰り返しも外れる（DB制約 recurrence_requires_due_date）ので、その旨を添える
            title={recurring ? "日時を外す（繰り返しも解除されます）" : "日時を外す"}
            className="text-nibi hover:text-beni hit shrink-0 px-1 leading-none"
          >
            ✕
          </button>
        )}
      </p>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (patch) onSelect(patch);
          }
        }}
        placeholder="明日 18:00 / 9/30 / 金 / 21時"
        aria-label="日時を入力"
        className={cn(
          "mt-1.5 w-full rounded-md border px-2 py-1 text-[11px] outline-none",
          invalid ? "border-beni" : "border-wakuiro focus:border-mikan",
        )}
      />
      {patch && (
        <p className="text-mikan pt-1 text-[11px] font-semibold">
          → {dueText(patch.due_date, patch.due_time ?? current.time, today)}
        </p>
      )}
    </div>
  );
}

// 1〜4＋なし。意味はツールチップで出す（メニューを縦に伸ばさないため）
function PriorityPicker({
  current,
  onSelect,
}: {
  current: Priority | null;
  onSelect: (p: Priority | null) => void;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-nibi pb-1.5">重要度</p>
      <div className="flex gap-1">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            title={PRIORITY_MEANING[p]}
            aria-label={`重要度${p}（${PRIORITY_MEANING[p]}）`}
            onClick={() => onSelect(p)}
            className={cn(
              "min-w-7 rounded-md border px-1.5 py-0.5 text-[11px]",
              current === p
                ? "border-mikan bg-mikan font-bold text-white"
                : "border-wakuiro hover:bg-kinari",
            )}
          >
            {p}
          </button>
        ))}
        {current !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="border-wakuiro text-nibi hover:bg-kinari rounded-md border px-1.5 py-0.5 text-[11px]"
          >
            なし
          </button>
        )}
      </div>
    </div>
  );
}

const DURATION_PRESETS = [5, 10, 15, 30, 60, 90, 120];

// プリセット＋自由入力。書式はSmart Inputと同じ（1h20m / 90m / 1.5h）
function DurationPicker({
  current,
  onSelect,
}: {
  current: number | null;
  onSelect: (minutes: number | null) => void;
}) {
  const [text, setText] = useState("");
  const invalid = text.trim() !== "" && parseDuration(text) === null;

  function commit() {
    const m = parseDuration(text);
    if (m !== null) onSelect(m);
  }

  return (
    <div className="px-3 py-2">
      <p className="text-nibi pb-1.5">所要時間</p>
      <div className="flex flex-wrap gap-1">
        {DURATION_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onSelect(m)}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[11px]",
              current === m
                ? "border-mikan bg-mikan font-bold text-white"
                : "border-wakuiro hover:bg-kinari",
            )}
          >
            {formatDuration(m)}
          </button>
        ))}
        {current !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="border-wakuiro text-nibi hover:bg-kinari rounded-md border px-1.5 py-0.5 text-[11px]"
          >
            なし
          </button>
        )}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="1h20m / 90m / 1.5h"
        aria-label="所要時間を入力"
        className={cn(
          "mt-1.5 w-full rounded-md border px-2 py-1 text-[11px] outline-none",
          invalid ? "border-beni" : "border-wakuiro focus:border-mikan",
        )}
      />
    </div>
  );
}
