-- LINE連携（docs/line-plan.md 4章）。
-- 前提は他テーブルと同じ: アクセスは service_role 経由のみ、RLSは有効でポリシーなし。

-- 送信先。友だち追加イベントで登録されるので、手でIDを貼る運用にはしない
create table line_recipients (
  user_id text primary key,
  display_name text,
  created_at timestamptz not null default now(),
  unfollowed_at timestamptz
);

comment on table line_recipients is
  'LINEの送信先。unfollowed_at が入っている行には送らない（docs/line-plan.md）';

-- 定時配信の冪等化と、無料枠（月200通）の消費量集計を兼ねる
create table line_push_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  slot text,
  sent_on date not null,
  sent_at timestamptz not null default now(),
  message_count integer not null
);

-- 同じ日の同じ枠は一度だけ送る（先にこの行を入れられた実行だけが送信を担当する）。
-- slot が null のもの（テスト送信など）は Postgres が NULL 同士を別物として扱うため、
-- 一意制約に引っかからず何度でも記録できる
create unique index line_push_log_slot_unique on line_push_log (kind, slot, sent_on);
create index line_push_log_sent_on on line_push_log (sent_on);

comment on column line_push_log.message_count is
  '課金対象の通数＝宛先数。1回のpushに複数メッセージを束ねても宛先ごとに1通';

-- webhookの再送で同じイベントを二度処理しないための記録
create table line_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

alter table line_recipients enable row level security;
alter table line_push_log enable row level security;
alter table line_events enable row level security;
