"use client";

import type { DatesSetArg, EventApi, EventClickArg, EventDropArg } from "@fullcalendar/core";
import jaLocale from "@fullcalendar/core/locales/ja";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { ItemModal } from "@/components/item-modal";
import { durationFromRange, rangeQuery, toEvents } from "@/lib/calendar";
import { getJson, patchJson, revalidateLists } from "@/lib/client";
import { todayInJst } from "@/lib/date";
import { isFinePointer } from "@/lib/pointer";
import type { Item } from "@/lib/types";

type ListResult = { items: Item[] };
type ItemResult = { item: Item };
type Range = { from: string; to: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// FullCalendarが渡すDateはローカル時刻。暦日だけ取り出す（JST運用前提・docs/calendar-plan.md 3章）
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hmLocal(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ドロップ先が終日欄なら時刻を外す。時間軸なら開始位置を期限時刻にする
function movePatch(ev: EventApi): Partial<Item> {
  const start = ev.start;
  if (!start) return {};
  if (ev.allDay) return { due_date: ymdLocal(start), due_time: null };
  return { due_date: ymdLocal(start), due_time: hmLocal(start) };
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

  const [opError, setOpError] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<ListResult>(
    range ? rangeQuery(range.from, range.to) : null,
    getJson,
  );
  const events = toEvents(data?.items ?? [], today);

  // 楽観的更新（docs/design.md 17章）。失敗したらSWRのキャッシュとFullCalendarの表示を両方戻す
  async function applyPatch(id: string, patch: Partial<Item>, revert: () => void) {
    setOpError(null);
    const merge = (cur: ListResult | undefined, next: Partial<Item>) => ({
      items: (cur?.items ?? []).map((i) => (i.id === id ? { ...i, ...next } : i)),
    });
    try {
      await mutate(
        async (cur) => {
          const { item } = await patchJson<ItemResult>(`/api/items/${id}`, patch);
          return merge(cur, item);
        },
        {
          optimisticData: (cur) => merge(cur, patch),
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
      void revalidateLists();
    } catch (e) {
      revert();
      setOpError((e as Error).message);
    }
  }

  function onEventDrop(arg: EventDropArg) {
    void applyPatch(arg.event.id, movePatch(arg.event), arg.revert);
  }

  function onEventResize(arg: EventResizeDoneArg) {
    const { start, end } = arg.event;
    if (!start || !end) return arg.revert();
    void applyPatch(arg.event.id, { duration_min: durationFromRange(start, end) }, arg.revert);
  }

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

      {opError && <p className="text-beni shrink-0 pb-1 text-sm">{opError}</p>}

      <div className="zd-cal min-h-0 flex-1">
        {fine === null ? (
          <p className="text-nibi py-4 text-sm">読み込み中…</p>
        ) : (
          <FullCalendar
            plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
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
            eventDrop={onEventDrop}
            eventResize={onEventResize}
            editable
            eventResizableFromStart={false}
            snapDuration="00:15:00"
            eventLongPressDelay={400}
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
