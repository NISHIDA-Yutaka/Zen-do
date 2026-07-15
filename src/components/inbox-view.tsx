"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { addDays, todayInJst } from "@/lib/date";
import { getJson, notifyInboxChanged, patchJson, postJson } from "@/lib/client";
import type { Item } from "@/lib/types";

type CaptureResult = { item: Item };
type ListResult = { items: Item[] };

function tempInboxItem(title: string): Item {
  const now = new Date().toISOString();
  return {
    id: `temp-${crypto.randomUUID()}`,
    kind: "inbox",
    title,
    notes: "",
    tags: [],
    is_memo: false,
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
  };
}

export function InboxView() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getJson<ListResult>("/api/items?kind=inbox")
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function capture() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    const optimistic = tempInboxItem(trimmed);
    setItems((prev) => [optimistic, ...prev]);
    setTitle("");
    try {
      const { item } = await postJson<CaptureResult>("/api/items", { title: trimmed });
      setItems((prev) => prev.map((i) => (i.id === optimistic.id ? item : i)));
      notifyInboxChanged();
    } catch (e) {
      setItems((prev) => prev.filter((i) => i.id !== optimistic.id));
      setTitle(trimmed);
      setError((e as Error).message);
    }
  }

  async function triage(item: Item, patch: { kind: "todo" | "project"; due_date?: string | null }) {
    setError(null);
    setBusyIds((prev) => new Set(prev).add(item.id));
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await patchJson(`/api/items/${item.id}`, patch);
      notifyInboxChanged();
    } catch (e) {
      setItems((prev) => [item, ...prev]);
      setError((e as Error).message);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <p className="text-muted-foreground mt-1 text-sm">思いついたら、まず投げ込む。仕分けは後で。</p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void capture();
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクや思いつきを入力…"
          aria-label="クイックキャプチャ"
          className="border-input bg-background focus-visible:ring-ring flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
        />
        <Button type="submit" disabled={!title.trim()}>
          追加
        </Button>
      </form>

      {error && <p className="text-destructive mt-3 text-sm">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground mt-6 text-sm">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">未仕分けはありません。身軽ですね。</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => {
            const busy = busyIds.has(item.id) || item.id.startsWith("temp-");
            return (
              <li
                key={item.id}
                className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => triage(item, { kind: "todo", due_date: todayInJst() })}
                  >
                    今日
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => triage(item, { kind: "todo", due_date: addDays(todayInJst(), 1) })}
                  >
                    明日
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => triage(item, { kind: "todo" })}
                  >
                    ToDo
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => triage(item, { kind: "project" })}
                  >
                    Project
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
