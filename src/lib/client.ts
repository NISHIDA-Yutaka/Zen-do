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

// Inboxは状態ではなくビュー（docs/design.md 8章）。バッジと一覧で同じ条件を使う
export const INBOX_QUERY =
  `/api/items?kind=todo&status=todo&parent_id=null&exclude_tag=${MEMO_TAG}&due_on=null`;

// Notes（docs/design.md 13.2）。未完了＝一覧 / 完了＝アーカイブ
export const NOTES_QUERY = `/api/items?kind=todo&status=todo&tag=${MEMO_TAG}`;
export const NOTES_ARCHIVE_QUERY = `/api/items?kind=todo&status=done&tag=${MEMO_TAG}`;

// Inbox件数バッジ（Nav）を別画面の変更に追従させるための軽量なイベント通知
export const INBOX_CHANGED_EVENT = "zendo:inbox-changed";

export function notifyInboxChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}
