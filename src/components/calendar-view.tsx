"use client";

import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import jaLocale from "@fullcalendar/core/locales/ja";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { ItemModal } from "@/components/item-modal";
import { rangeQuery, toEvents } from "@/lib/calendar";
import { getJson, revalidateLists } from "@/lib/client";
import { todayInJst } from "@/lib/date";
import { isFinePointer } from "@/lib/pointer";
import type { Item } from "@/lib/types";

type ListResult = { items: Item[] };
type Range = { from: string; to: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// FullCalendarが渡すDateはローカル時刻。暦日だけ取り出す（JST運用前提・docs/calendar-plan.md 3章）
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function subscribePointer(onChange: () => void): () => void {
  const mq = window.matchMedia("(pointer: fine)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const VIEWS = {
  timeGridThreeDay: { type: "timeGrid", duration: { days: 3 }, buttonText: "3日" },
};

export function CalendarView() {
  // ポインタ種別はブラウザ側にしか無い情報。サーバーではnullを返して本体を描かないことで、
  // ハイドレーション不一致とSSR時のDOMアクセスを同時に避ける（docs/design.md 19章）
  const fine = useSyncExternalStore<boolean | null>(subscribePointer, isFinePointer, () => null);

  const [range, setRange] = useState<Range | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayInJst();

  const { data, error, isLoading } = useSWR<ListResult>(
    range ? rangeQuery(range.from, range.to) : null,
    getJson,
  );
  const events = toEvents(data?.items ?? [], today);

  // 表示範囲が変わるたびに取得キーを差し替える。endは排他なので1日戻す
  function onDatesSet(arg: DatesSetArg) {
    const from = ymdLocal(arg.start);
    const end = new Date(arg.end.getTime() - 86_400_000);
    const to = ymdLocal(end);
    setRange((prev) => (prev?.from === from && prev.to === to ? prev : { from, to }));
  }

  function onEventClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    setOpenId(arg.event.id);
  }

  return (
    <section className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">Calendar</h1>
        <p className="text-nibi text-xs">
          {error ? "読み込みに失敗しました" : isLoading ? "読み込み中…" : `${events.length}件`}
        </p>
      </header>

      <div className="zd-cal min-h-0 flex-1">
        {fine === null ? (
          <p className="text-nibi py-4 text-sm">読み込み中…</p>
        ) : (
          <FullCalendar
            plugins={[timeGridPlugin, dayGridPlugin]}
            initialView={fine ? "timeGridWeek" : "timeGridThreeDay"}
            views={VIEWS}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: fine
                ? "timeGridDay,timeGridWeek,dayGridMonth"
                : "timeGridDay,timeGridThreeDay,dayGridMonth",
            }}
            locale={jaLocale}
            height="100%"
            nowIndicator
            scrollTime="08:00:00"
            slotDuration="00:30:00"
            allDaySlot
            dayMaxEvents={3}
            expandRows
            events={events}
            datesSet={onDatesSet}
            eventClick={onEventClick}
            editable={false}
          />
        )}
      </div>

      {openId && (
        <ItemModal
          itemId={openId}
          onClose={() => {
            setOpenId(null);
            void revalidateLists();
          }}
        />
      )}
    </section>
  );
}
