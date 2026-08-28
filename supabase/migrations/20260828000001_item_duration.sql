-- タスクの所要時間（分）を追加（docs/calendar-plan.md 1章）。
-- カレンダーのブロック長に使う。due_time が無くても持てる（見積りだけ先に付ける運用を許す）。

alter table items add column duration_min integer
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));

comment on column items.duration_min is
  '所要時間（分・1〜1440）。カレンダーの時間ブロック長。nullは未見積り（docs/calendar-plan.md）';
