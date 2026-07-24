import { mutate } from "swr";
import type { Item } from "@/lib/types";

// クライアントから /api/* を叩く薄いラッパ。エラーレスポンスを例外に変換して呼び出し側で扱いやすくする。
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error ?? `リクエストに失敗しました (${res.status})`);
  }
  return body as T;
}

const jsonHeaders = { "Content-Type": "application/json" };

export function getJson<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export function postJson<T>(path: string, data?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: data !== undefined ? jsonHeaders : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

export function patchJson<T>(path: string, data: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(data) });
}

export function deleteJson<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

// メモを表すタグ（docs/design.md 13.1）。専用列ではなく通常のタグで表現する
export const MEMO_TAG = "memo";

// SWRキー（docs/design.md 17章）。同じ文字列キーはSWRが1フェッチに集約する
export const TODAY_KEY = "/api/today";
export const PROJECTS_KEY = "/api/projects";
export const HABITS_KEY = "/api/habits";

// Inboxは状態ではなくビュー（docs/design.md 8章）。バッジと一覧で同じ条件を使う
export const INBOX_QUERY =
  `/api/items?kind=todo&status=todo&parent_id=null&exclude_tag=${MEMO_TAG}&due_on=null`;

// この先の予定（docs/design.md 12章）
export const UPCOMING_KEY = "/api/items?kind=todo&status=todo&due_after=";

// Notes（docs/design.md 13.2）。未完了＝一覧 / 完了＝アーカイブ
export const NOTES_QUERY = `/api/items?kind=todo&status=todo&tag=${MEMO_TAG}`;
export const NOTES_ARCHIVE_QUERY = `/api/items?kind=todo&status=done&tag=${MEMO_TAG}`;

// 変更が波及しうる一覧をまとめて再検証する（docs/design.md 17章）。
// 小規模アプリなので /api で始まるキーを一律再検証する（詳細モーダル閉時など横断更新に使う）
export function revalidateLists(): Promise<unknown> {
  return mutate((key) => typeof key === "string" && key.startsWith("/api"));
}

// 楽観的更新用の仮アイテム（docs/design.md 17章）。サーバー応答前に一覧へ即表示するための下地。
// 確定後に本物へ置換される。tempid は "temp-" 接頭辞で判別できるようにしておく。
export function makeOptimisticItem(
  fields: Partial<Item> & { title: string },
): Item {
  const now = new Date().toISOString();
  return {
    id: `temp-${crypto.randomUUID()}`,
    kind: "todo",
    notes: "",
    tags: [],
    status: "todo",
    parent_id: null,
    habit_id: null,
    due_date: null,
    due_time: null,
    recurrence_rule: null,
    generated_from: null,
    postponed_count: 0,
    sort_order: 0,
    done_at: null,
    captured_raw: null,
    created_at: now,
    updated_at: now,
    ...fields,
  };
}
