-- データモデル統合（docs/design.md 7.5 / 8章 / 10.1）
--   1. item_status から 'doing' を削除（todo/done/dropped の3値へ）
--   2. item_kind から 'inbox' を削除（todo/project の2種へ）。Inboxは状態ではなくビューになる
--   3. habits.frequency_rule の語彙刷新: weekly(曜日指定) を廃止し
--      daily / every_n_days / times_per_week の3種へ
--
-- 注意: kind/status はenum型のため、値の削除は「データ変換→enum再作成→列の型入れ替え」で行う。
--       kind を参照する CHECK制約 (todo_only_links) は入れ替えの間だけ外す。

begin;

-- ============ 1. status: doing の廃止 ============
update items set status = 'todo' where status = 'doing';

alter table items alter column status drop default;
alter type item_status rename to item_status_old;
create type item_status as enum ('todo', 'done', 'dropped');
alter table items
  alter column status type item_status using status::text::item_status;
alter table items alter column status set default 'todo';
drop type item_status_old;

-- ============ 2. kind: inbox の廃止 ============
update items set kind = 'todo' where kind = 'inbox';

alter table items drop constraint todo_only_links;
alter type item_kind rename to item_kind_old;
create type item_kind as enum ('project', 'todo');
alter table items
  alter column kind type item_kind using kind::text::item_kind;
drop type item_kind_old;
alter table items add constraint todo_only_links
  check (kind = 'todo' or (habit_id is null and generated_from is null));

-- ============ 3. frequency_rule の語彙刷新 ============
-- {"type":"weekly","weekdays":[...]} → {"type":"times_per_week","n":曜日数}
update habits
set frequency_rule = jsonb_build_object(
  'type', 'times_per_week',
  'n', jsonb_array_length(frequency_rule->'weekdays')
)
where frequency_rule->>'type' = 'weekly';

commit;

-- PostgREST（Data API）のスキーマキャッシュを即時リロード
notify pgrst, 'reload schema';
