"use client";

import { useCallback, useEffect, useState } from "react";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import {
  getJson,
  MEMO_TAG,
  NOTES_ARCHIVE_QUERY,
  NOTES_QUERY,
  notifyInboxChanged,
  postJson,
} from "@/lib/client";
import { todayInJst } from "@/lib/date";
import { formatDueLabel } from "@/lib/format";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

type ItemResult = { item: Item };
type ListResult = { items: Item[] };

const PLACEHOLDER = "メモを追加…（#memo が自動で付きます）";

function byUpdatedDesc(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

// 本文の冒頭1行だけを行プレビューに出す（docs/design.md 13.2）
function firstLine(notes: string): string {
  return notes.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

// Notes = #memo タグ付きタスクの一覧（docs/design.md 13章）。専用の実体は持たない。
export function NotesView() {
  const [notes, setNotes] = useState<Item[]>([]);
  const [archived, setArchived] = useState<Item[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayInJst();

  const load = useCallback(() => {
    getJson<ListResult>(NOTES_QUERY)
      .then((r) => setNotes(byUpdatedDesc(r.items)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    getJson<ListResult>(NOTES_ARCHIVE_QUERY)
      .then((r) => setArchived(byUpdatedDesc(r.items)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // この画面からの追加は #memo を自動付与（毎回打たなくてよい）
  async function addNote(payload: QuickAddPayload) {
    setError(null);
    const tags = payload.tags?.includes(MEMO_TAG)
      ? payload.tags
      : [...(payload.tags ?? []), MEMO_TAG];
    try {
      const { item } = await postJson<ItemResult>("/api/items", { ...payload, tags });
      setNotes((prev) => [item, ...prev]);
      notifyInboxChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // メモの完了＝アーカイブ（docs/design.md 13.1）
  async function archive(item: Item) {
    setError(null);
    setBusy(item.id, true);
    setNotes((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await postJson(`/api/items/${item.id}/complete`);
      load();
    } catch (e) {
      setNotes((prev) => byUpdatedDesc([item, ...prev]));
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function unarchive(item: Item) {
    setError(null);
    setBusy(item.id, true);
    setArchived((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const { item: reopened } = await postJson<ItemResult>(`/api/items/${item.id}/uncomplete`);
      setNotes((prev) => byUpdatedDesc([reopened, ...prev]));
    } catch (e) {
      setArchived((prev) => byUpdatedDesc([item, ...prev]));
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">Notes</h1>
        <p className="text-nibi text-xs">{notes.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : notes.length === 0 ? (
        <p className="text-nibi py-4 text-sm">
          タスクに <span className="font-semibold">#memo</span> を付けるとここに集まります。
        </p>
      ) : (
        <ul>
          {notes.map((item) => {
            const due = formatDueLabel(item.due_date, item.due_time, today);
            const preview = firstLine(item.notes);
            return (
              <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                <button
                  type="button"
                  aria-label={`${item.title}をアーカイブ`}
                  disabled={busyIds.has(item.id)}
                  onClick={() => archive(item)}
                  className="border-wakuiro hover:border-tokiwa hit size-6 shrink-0 rounded-full border-[1.75px]"
                />
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  {(preview || due) && (
                    <span className="mt-0.5 flex items-baseline gap-2">
                      {due && (
                        <span
                          className={cn(
                            "shrink-0 text-[11px]",
                            due.late ? "text-beni font-semibold" : "text-nibi",
                          )}
                        >
                          {due.text}
                        </span>
                      )}
                      {preview && (
                        <span className="text-nibi min-w-0 truncate text-[11px]">{preview}</span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <QuickAddInline placeholder={PLACEHOLDER} onAdd={addNote} smart />
      <QuickAddFab placeholder={PLACEHOLDER} onAdd={addNote} smart />

      {archived.length > 0 && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setArchiveOpen((v) => !v)}
            className="text-nibi hit flex items-center gap-1.5 text-xs"
          >
            <span className="text-tokiwa font-bold">✓</span>
            アーカイブ済み {archived.length}件 {archiveOpen ? "▾" : "▸"}
          </button>
          {archiveOpen && (
            <ul>
              {archived.map((item) => (
                <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                  <button
                    type="button"
                    aria-label={`${item.title}をNotesに戻す`}
                    disabled={busyIds.has(item.id)}
                    onClick={() => unarchive(item)}
                    className="bg-tokiwa hit flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  >
                    ✓
                  </button>
                  <span className="text-nibi min-w-0 flex-1 truncate text-sm line-through">
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openId && (
        <ItemModal
          itemId={openId}
          onClose={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
    </section>
  );
}
