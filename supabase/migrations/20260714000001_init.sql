-- Zendo 初期スキーマ
-- 設計の意図・セマンティクスは docs/database-design.md を参照。
-- 前提: 全アクセスは Next.js API Routes の secret key（Postgres上の service_role ロール）経由。
--       RLSは全テーブル有効・ポリシーなし = 公開キー(publishable/anon)では一切アクセス不可。

create type item_kind as enum ('inbox', 'project', 'todo');
create type item_status as enum ('todo', 'doing', 'done', 'dropped');

create table habits (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text not null default '',
  tags text[] not null default '{}',
  -- {"type":"daily"} | {"type":"weekly","weekdays":[1,3,5]}  (ISO: 1=月..7=日)
  frequency_rule jsonb not null,
  -- インスタンス生成時に付与するリマインダールール（docs/database-design.md 6.1の語彙）
  default_reminder_rule jsonb,
  is_paused boolean not null default false,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  kind item_kind not null,
  title text not null,
  notes text not null default '',
  tags text[] not null default '{}',
  is_memo boolean not null default false,
  status item_status not null default 'todo',
  parent_id uuid references items(id) on delete cascade,
  habit_id uuid references habits(id) on delete set null,
  due_date date,
  due_time time,
  -- docs/database-design.md 4.1 の語彙
  recurrence_rule jsonb,
  -- 繰り返しの前回→次回リンク（二重生成防止・undo巻き戻しに使用）
  generated_from uuid references items(id) on delete set null,
  postponed_count integer not null default 0,
  sort_order double precision not null default 0,
  done_at timestamptz,
  -- オフラインキャプチャ時の生入力（復帰後の再パース用）
  captured_raw text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 時刻だけあって日付がない状態は不正
  constraint due_time_requires_due_date check (due_time is null or due_date is not null),
  -- 繰り返しは次回計算の基準となる期日が必須
  constraint recurrence_requires_due_date check (recurrence_rule is null or due_date is not null),
  -- 習慣インスタンス・繰り返し生成リンクはToDoにのみ存在しうる
  constraint todo_only_links check (kind = 'todo' or (habit_id is null and generated_from is null))
);

create index items_parent_idx on items (parent_id);
create index items_kind_status_idx on items (kind, status);
create index items_due_date_idx on items (due_date) where due_date is not null;
create index items_tags_idx on items using gin (tags);
-- 同じ習慣を同じ日に二重インスタンス化できない
create unique index items_habit_daily_unique on items (habit_id, due_date) where habit_id is not null;
-- 繰り返しの次回インスタンスは前回1つにつき1件のみ（二重完了リクエスト対策）
create unique index items_generated_from_unique on items (generated_from) where generated_from is not null;

create table reminders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  -- 定義（期日変更時の再計算・繰り返し複製の元データ）: docs/database-design.md 6.1の語彙
  rule jsonb not null,
  -- ruleを解決した実発火時刻。ディスパッチャはこれ（とsnoozed_until）だけを読む
  remind_at timestamptz not null,
  snoozed_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reminders_item_idx on reminders (item_id);
create index reminders_pending_idx on reminders (remind_at) where sent_at is null;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  failed_count integer not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);

-- updated_at 自動更新
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger habits_set_updated_at before update on habits
  for each row execute function set_updated_at();
create trigger items_set_updated_at before update on items
  for each row execute function set_updated_at();
create trigger reminders_set_updated_at before update on reminders
  for each row execute function set_updated_at();

-- RLS: 有効化のみ（ポリシーなし）。secret key（service_roleロール）はRLSをバイパスするため
-- API Routes経由のアクセスだけが成立し、公開キー(publishable/anon)経由は全拒否になる。
alter table habits enable row level security;
alter table items enable row level security;
alter table reminders enable row level security;
alter table push_subscriptions enable row level security;
