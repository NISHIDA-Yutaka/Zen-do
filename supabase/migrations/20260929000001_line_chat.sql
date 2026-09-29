-- LINE の会話を Gemini＋ツールで処理する（docs/line-plan.md 10章）。

-- 会話履歴。LINEのメッセージは1通ずつ独立して届くので、直前のやり取りを渡さないと
-- 「来週の土曜かな」がどの話への答えか Gemini に分からない。見えているやり取り（本人の発言と返事）だけを残す。
create table line_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  -- [話を聞いて] の起点だけに入る。どのタスクの話か（10.3）
  item_id uuid references items(id) on delete set null,
  created_at timestamptz not null default now()
);
create index line_messages_user_created_idx on line_messages (user_id, created_at desc);
alter table line_messages enable row level security;

-- 実際の費用を後から見積もれるよう、呼び出しごとのトークン数を残す
-- （promptTokenCount / candidatesTokenCount / thoughtsTokenCount など usageMetadata そのまま）
alter table gemini_logs add column usage jsonb;
