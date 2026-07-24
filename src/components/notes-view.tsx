"use client";

import { useState } from "react";
import useSWR from "swr";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import {
  getJson,
  makeOptimisticItem,
  MEMO_TAG,
  NOTES_ARCHIVE_QUERY,
  NOTES_QUERY,
  postJson,
  revalidateLists,
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
  const { data: notesData, error: loadError, isLoading, mutate: mutateNotes } =
    useSWR<ListResult>(NOTES_QUERY, getJson);
  const { data: archiveData, mutate: mutateArchive } =
    useSWR<ListResult>(NOTES_ARCHIVE_QUERY, getJson);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayInJst();

  const notes = byUpdatedDesc(notesData?.items ?? []);
  const archived = byUpdatedDesc(archiveData?.items ?? []);

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
    const temp = makeOptimisticItem({ title: payload.title, tags });
    try {
      await mutateNotes(
        async () => {
          const { item } = await postJson<ItemResult>("/api/items", { ...payload, tags });
          return { items: [item, ...notes.filter((i) => i.id !== temp.id)] };
        },
        {
          optimisticData: { items: [temp, ...notes] },
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // メモの完了＝アーカイブ（docs/design.md 13.1）
  async function archive(item: Item) {
    setError(null);
    setBusy(item.id, true);
    try {
      await mutateNotes(
        async () => {
          await postJson(`/api/items/${item.id}/complete`);
          return { items: notes.filter((i) => i.id !== item.id) };
        },
        {
          optimisticData: { items: notes.filter((i) => i.id !== item.id) },
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
      void mutateArchive();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function unarchive(item: Item) {
    setError(null);
    setBusy(item.id, true);
    try {
      await mutateArchive(
        async () => {
          await postJson<ItemResult>(`/api/items/${item.id}/uncomplete`);
          return { items: archived.filter((i) => i.id !== item.id) };
        },
        {
          optimisticData: { items: archived.filter((i) => i.id !== item.id) },
          populateCache: true,
          revalidate: false,
          rollbackOnError: true,
        },
      );
      void mutateNotes();
    } catch (e) {
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

      {isLoading && !notesData ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : loadError && !notesData ? (
        <p className="text-beni py-4 text-sm">{loadError.message}</p>
      ) : notes.length === 0 ? (
        <p className="text-nibi py-4 text-sm">
          タスクに <span className="font-semibold">#memo</span> を付けるとここに集まります。
        </p>
      ) : (
        <ul>
          {notes.map((item) => {
            const due = formatDueLabel(item.due_date, item.due_time, today);
            const preview = firstLine(item.notes);
            const busy = busyIds.has(item.id) || item.id.startsWith("temp-");
            return (
              <li key={item.id} className="border-keisen flex items-center gap-3 border-b py-3">
                <button
                  type="button"
                  aria-label={`${item.title}をアーカイブ`}
                  disabled={busy}
                  onClick={() => archive(item)}
                  className="border-wakuiro hover:border-tokiwa hit size-6 shrink-0 rounded-full border-[1.75px]"
                />
                <button
                  type="button"
                  onClick={() => !item.id.startsWith("temp-") && setOpenId(item.id)}
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
            void revalidateLists();
          }}
        />
      )}
    </section>
  );
}
