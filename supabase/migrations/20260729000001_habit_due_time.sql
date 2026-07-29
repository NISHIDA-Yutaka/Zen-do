-- Habitに「期限の時間」を追加（docs/design.md 10章 / database-design.md 5.2）。
-- インスタンス生成時に item.due_time へ入れ、期限時刻ちょうどの通知（0分前リマインダー）を自動付与する。
-- 既存の default_reminder_rule は残す（リマインダーは事前通知として併存）。

alter table habits add column default_due_time time;

comment on column habits.default_due_time is
  'インスタンス生成時に item.due_time へ設定する期限時刻。期限ちょうどの通知が自動で付く（docs/design.md 10章）';

-- 既存習慣の移行: default_reminder_rule が on_due_at（当日この時刻）なら、その時刻を期限の時間へ引き継ぐ
update habits
  set default_due_time = (default_reminder_rule ->> 'time')::time
  where default_reminder_rule ->> 'kind' = 'on_due_at'
    and default_due_time is null;
