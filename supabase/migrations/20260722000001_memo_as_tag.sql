-- メモをタグ方式へ（docs/design.md 13.1）
--   メモは独立した実体ではなく「#memo タグが付いた通常のタスク」とする。
--   専用列 is_memo を廃止し、既存の is_memo=true 行は tags に 'memo' を足して移行する。
--
-- 注意: このSQLはコード側から is_memo の読み書きを外した後に実行すること
--       （列削除を先に流すとINSERTが失敗する）。

begin;

-- 旧フラグ方式で作られたメモをタグへ移し替える（'memo' 済みの行は二重付与しない）
update items
set tags = array_append(tags, 'memo')
where is_memo = true and not ('memo' = any(tags));

alter table items drop column is_memo;

commit;

-- PostgREST（Data API）のスキーマキャッシュを即時リロード
notify pgrst, 'reload schema';
