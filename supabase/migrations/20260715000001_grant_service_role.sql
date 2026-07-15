-- service_role（secret key が対応するPostgresロール）に public スキーマの権限を明示付与する。
--
-- 背景: Supabaseダッシュボードの「Automatically expose new tables」を無効にしていると、
--       新規テーブルへの権限が自動付与されず、service_role でも "permission denied" になる。
--       本アプリは全アクセスを service_role（API Routes）経由に限定する設計なので、
--       ここで service_role にだけ権限を与える。
--
-- セキュリティ: RLS は全テーブルで有効のまま（20260714000001_init.sql）。
--             anon 等の公開キーは権限もRLSも通らず全拒否。service_role は RLS をバイパスする。

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 今後 SQL Editor（postgresロール）で作成するテーブルにも自動で権限が付くようにする
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- PostgREST（Data API）のスキーマキャッシュを即時リロードさせる
notify pgrst, 'reload schema';
