import "server-only";
import { createClient } from "@supabase/supabase-js";

// Supabase Postgres への唯一の窓口。secret key（DBフルアクセス・RLS迂回）を使うため
// API Routes / Server Components 以外から import してはならない
// （"server-only" によりクライアントコードから import するとビルドエラーになる）。
// アクセス方針の詳細: docs/database-design.md 2章
export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);
