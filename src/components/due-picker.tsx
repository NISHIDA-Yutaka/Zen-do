"use client";

import { useEffect, useState } from "react";
import { addDays, daysInMonth, isoWeekday } from "@/lib/date";
import { parseLooseDate } from "@/lib/loose-date";
import { cn } from "@/lib/utils";

type DuePickerProps = {
  dueDate: string | null;
  dueTime: string | null;
  today: string;
  onChange: (dueDate: string | null, dueTime: string | null) => void;
};

// 期日ピッカー（docs/design.md 7.3）。確定ボタンなし＝操作即保存。
export function DuePicker({ dueDate, dueTime, today, onChange }: DuePickerProps) {
  const [dateText, setDateText] = useState(dueDate ?? "");
  const [invalid, setInvalid] = useState(false);
  // 表示中の月（YYYY-MM）
  const [month, setMonth] = useState(() => (dueDate ?? today).slice(0, 7));

  // 外部変更（カレンダータップ等）とinputの双方向同期
  useEffect(() => {
    setDateText(dueDate ?? "");
    setInvalid(false);
    if (dueDate) setMonth(dueDate.slice(0, 7));
  }, [dueDate]);

  function commitDateText() {
    if (dateText.trim() === "") {
      setDateText(dueDate ?? "");
      setInvalid(false);
      return;
    }
    const parsed = parseLooseDate(dateText, today);
    if (parsed) {
      setInvalid(false);
      onChange(parsed, dueTime);
    } else {
      // 不正入力は赤枠＋元値維持
      setInvalid(true);
      setTimeout(() => {
        setDateText(dueDate ?? "");
        setInvalid(false);
      }, 1200);
    }
  }

  return (
    <div className="w-full max-w-65">
      <div className="flex gap-2 pb-2">
        <input
          type="text"
          value={dateText}
          onChange={(e) => setDateText(e.target.value)}
          onBlur={commitDateText}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commitDateText();
            }
          }}
          placeholder="7/19"
          aria-label="期日の日付"
          className={cn(
            "min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none",
            invalid ? "border-beni" : "border-wakuiro focus:border-mikan",
          )}
        />
        <span className="flex items-center gap-1">
          <input
            type="time"
            value={dueTime ? dueTime.slice(0, 5) : ""}
            onChange={(e) => {
              if (e.target.value) onChange(dueDate, e.target.value);
            }}
            disabled={!dueDate}
            aria-label="期日の時刻"
            className="border-wakuiro focus:border-mikan rounded-lg border px-2 py-1.5 text-xs outline-none disabled:opacity-40"
          />
          {dueTime && (
            <button
              type="button"
              aria-label="時刻を削除"
              onClick={() => onChange(dueDate, null)}
              className="text-nibi/60 hover:text-foreground hit-y px-0.5 text-sm"
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <Calendar
        month={month}
        selected={dueDate}
        today={today}
        onMove={setMonth}
        onPick={(d) => onChange(d, dueTime)}
      />
    </div>
  );
}

function Calendar({
  month,
  selected,
  today,
  onMove,
  onPick,
}: {
  month: string; // YYYY-MM
  selected: string | null;
  today: string;
  onMove: (month: string) => void;
  onPick: (ymd: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  // 月曜はじまり: 1日の曜日ぶん前へ戻した日からグリッドを組む
  const gridStart = addDays(first, -(isoWeekday(first) - 1));
  const total = daysInMonth(y, m);
  const rows = Math.ceil((isoWeekday(first) - 1 + total) / 7);
  const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(gridStart, i));

  function moveMonth(delta: number) {
    const nm = m + delta;
    const ny = y + Math.floor((nm - 1) / 12);
    const mm = ((nm - 1 + 12 * 100) % 12) + 1;
    onMove(`${ny}-${String(mm).padStart(2, "0")}`);
  }

  return (
    <div className="border-keisen rounded-xl border px-3 pt-2 pb-3">
      <div className="flex items-center justify-between pb-1 text-xs font-bold">
        <button type="button" aria-label="前の月" onClick={() => moveMonth(-1)} className="text-nibi hover:text-foreground hit px-1">
          ‹
        </button>
        <span>
          {y}年{m}月
        </span>
        <button type="button" aria-label="次の月" onClick={() => moveMonth(1)} className="text-nibi hover:text-foreground hit px-1">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {["月", "火", "水", "木", "金", "土", "日"].map((w) => (
          <span key={w} className="text-nibi/70 text-[9.5px]">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const isToday = d === today;
          const isSel = d === selected;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              className={cn(
                "mx-auto flex size-6.5 items-center justify-center rounded-full text-[11px]",
                isSel && "bg-mikan font-bold text-white",
                !isSel && isToday && "border-wakuiro border-[1.5px]",
                !isSel && (d < today || !inMonth) && "text-nibi/50",
                !isSel && "hover:bg-kinari",
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
