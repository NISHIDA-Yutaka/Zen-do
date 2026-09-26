-- Gemini を定時報告に入れるためのテーブル（docs/gemini-digest-plan.md 5章）。

-- Gemini 呼び出しの記録。何を選び何を書いたか・失敗してテンプレに倒れたかを後から見て、プロンプトを調整するため。
-- 直近に②で選んだタスクを避ける判定にも使う（kind='digest' の output.focus_item_id）。
create table gemini_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,             -- 'digest'（定時報告）/ 'breakdown'（分解）など
  ok boolean not null,
  latency_ms integer not null,
  output jsonb,                   -- 成功時の解釈済み出力
  error text,                     -- 失敗時の理由
  created_at timestamptz not null default now()
);
create index gemini_logs_kind_created_idx on gemini_logs (kind, created_at desc);
alter table gemini_logs enable row level security;

-- 定時報告の [今日はパス]。その日の残りの便で同じタスクを選ばないため。
create table line_focus_passes (
  item_id uuid not null references items(id) on delete cascade,
  pass_date date not null,
  created_at timestamptz not null default now(),
  primary key (item_id, pass_date)
);
alter table line_focus_passes enable row level security;
