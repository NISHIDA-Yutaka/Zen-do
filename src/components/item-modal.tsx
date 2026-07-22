"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DuePicker } from "@/components/due-picker";
import { ProjectPicker, RecurrenceEditor, ReminderEditor } from "@/components/item-editors";
import { PushNotice } from "@/components/push-notice";
import { deleteJson, getJson, notifyInboxChanged, patchJson, postJson } from "@/lib/client";
import { todayInJst } from "@/lib/date";
import { formatDueFull, formatRecurrenceRule } from "@/lib/format";
import type { Item, Reminder, ReminderRule } from "@/lib/types";
import { cn } from "@/lib/utils";

type Detail = { item: Item; reminders: Reminder[]; children: Item[]; parent: Item | null };
type Expanded = "due" | "recur" | "project" | null;
type PatchResult = { item: Item; reminders: Reminder[] };

// タスク詳細モーダル（docs/design.md 7章）。全リストの行タップで開く・項目ごと自動保存。
export function ItemModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [stack, setStack] = useState<string[]>([itemId]);
  const currentId = stack[stack.length - 1];
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const today = todayInJst();

  // 閉じる操作は全て history.back() を通し、popstate を唯一の実クローズ経路にする。
  // これで Androidの戻るジェスチャと画面内の✕/Esc/背景タップが同じ挙動になり、
  // StrictModeの二重マウントでも誤クローズしない（cleanupで履歴を触らないため）。
  const requestClose = useCallback(() => {
    if (window.history.state?.zendoModal) window.history.back();
    else onCloseRef.current();
  }, []);

  const load = useCallback(() => {
    getJson<Detail>(`/api/items/${currentId}`)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [currentId]);

  useEffect(() => {
    setDetail(null);
    setExpanded(null);
    setMenuOpen(false);
    setError(null);
    load();
  }, [load]);

  // popstate（=戻る）が唯一の実クローズ。マウント時に履歴を1つ積む
  useEffect(() => {
    window.history.pushState({ zendoModal: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  function showNotice(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 4000);
  }

  async function save(patch: Record<string, unknown>): Promise<PatchResult | null> {
    setError(null);
    try {
      const res = await patchJson<PatchResult>(`/api/items/${currentId}`, patch);
      setDetail((d) => (d ? { ...d, item: res.item, reminders: res.reminders } : d));
      notifyInboxChanged();
      return res;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function changeDue(dueDate: string | null, dueTime: string | null) {
    const before = detail?.reminders.length ?? 0;
    // 期日クリア時は繰り返しも外す（DB制約: recurrence_requires_due_date）
    const patch =
      dueDate === null
        ? { due_date: null, due_time: null, recurrence_rule: null }
        : { due_date: dueDate, due_time: dueTime };
    const res = await save(patch);
    if (res && res.item.parent_id === null && res.reminders.length < before) {
      showNotice("期日の変更で解決できなくなったリマインダーを削除しました");
    } else if (res && res.reminders.length < before) {
      showNotice("時刻基準のリマインダーを削除しました");
    }
    if (res && res.item.parent_id !== null && detail?.parent) load();
  }

  async function saveReminders(rules: ReminderRule[]) {
    await save({ reminders: rules });
  }

  async function changeParent(parentId: string | null) {
    const res = await save({ parent_id: parentId });
    if (res) {
      setExpanded(null);
      load(); // parent表示を更新
    }
  }

  async function toggleChild(child: Item) {
    setError(null);
    try {
      await postJson(`/api/items/${child.id}/${child.status === "done" ? "uncomplete" : "complete"}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addChild(title: string) {
    setError(null);
    try {
      await postJson("/api/items", { title, parent_id: currentId });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function convertKind() {
    if (!detail) return;
    const toProject = detail.item.kind === "todo";
    setMenuOpen(false);
    await save(
      toProject ? { kind: "project", recurrence_rule: null } : { kind: "todo" },
    );
  }

  async function dropItem() {
    if (!detail) return;
    if (!confirm(`「${detail.item.title}」を破棄しますか？子ToDoもまとめて破棄されます。`)) return;
    setError(null);
    try {
      await postJson(`/api/items/${currentId}/drop`);
      notifyInboxChanged();
      requestClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteItem() {
    if (!detail) return;
    if (!confirm(`「${detail.item.title}」を完全に削除しますか？子ToDoとリマインダーも削除されます。`)) return;
    setError(null);
    try {
      await deleteJson(`/api/items/${currentId}`);
      notifyInboxChanged();
      requestClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function back() {
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
    else requestClose();
  }

  const item = detail?.item ?? null;
  const isProject = item?.kind === "project";
  const due = item?.due_date ? formatDueFull(item.due_date, item.due_time, today) : null;
  const activeChildren = detail?.children.filter((c) => c.status !== "dropped") ?? [];
  const convertDisabled =
    item !== null && item.kind === "todo" && (item.habit_id !== null || item.generated_from !== null);

  return (
    <div className="fixed inset-0 z-50">
      <div role="presentation" onClick={requestClose} className="absolute inset-0 bg-black/35" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="タスクの詳細"
        className="bg-background absolute inset-0 flex flex-col overflow-y-auto md:inset-auto md:top-12 md:left-1/2 md:max-h-[85vh] md:w-[430px] md:-translate-x-1/2 md:rounded-2xl md:shadow-2xl"
      >
        <header className="relative flex items-center justify-between px-4 pt-3">
          <button
            type="button"
            aria-label={stack.length > 1 ? "親に戻る" : "閉じる"}
            onClick={back}
            className="text-nibi hover:text-foreground hit text-lg md:hidden"
          >
            ←
          </button>
          <span className="text-nibi/70 text-[10.5px]">変更は自動保存されます</span>
          <span className="flex items-center gap-3.5">
            <button
              type="button"
              aria-label="その他の操作"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="text-nibi hover:text-foreground hit text-lg leading-none"
            >
              ⋯
            </button>
            <button
              type="button"
              aria-label="閉じる"
              onClick={requestClose}
              className="text-nibi hover:text-foreground hit hidden text-base leading-none md:block"
            >
              ✕
            </button>
          </span>
          {menuOpen && item && (
            <menu className="border-keisen bg-background absolute top-9 right-4 z-10 w-52 rounded-xl border py-1 text-xs shadow-xl">
              <li>
                <button
                  type="button"
                  disabled={convertDisabled}
                  title={convertDisabled ? "習慣・繰り返し由来のタスクは変換できません" : undefined}
                  onClick={convertKind}
                  className="hover:bg-kinari w-full px-4 py-2 text-left disabled:opacity-40"
                >
                  {isProject ? "タスクに変換" : "Projectに変換"}
                </button>
              </li>
              <li>
                <button type="button" onClick={dropItem} className="hover:bg-kinari w-full px-4 py-2 text-left">
                  破棄（繰り返しを終了）
                </button>
              </li>
              <li className="border-keisen border-t">
                <button type="button" onClick={deleteItem} className="text-beni hover:bg-beni-soft w-full px-4 py-2 text-left font-semibold">
                  削除
                </button>
              </li>
            </menu>
          )}
        </header>

        {error && <p className="text-beni px-4 pt-2 text-xs">{error}</p>}
        {notice && <p className="text-nibi px-4 pt-2 text-xs">{notice}</p>}

        {!item ? (
          <p className="text-nibi px-4 py-8 text-sm">読み込み中…</p>
        ) : (
          <>
            <TitleField key={item.id} title={item.title} onSave={(t) => save({ title: t })} />

            <section className="px-4 pt-1">
              <FieldRow
                label="期日"
                onToggle={() => setExpanded((e) => (e === "due" ? null : "due"))}
                trailing={
                  item.due_date && (
                    <button
                      type="button"
                      aria-label="期日をクリア"
                      onClick={() => changeDue(null, null)}
                      className="text-nibi/60 hover:text-foreground hit-y text-sm"
                    >
                      ✕
                    </button>
                  )
                }
              >
                {due ? (
                  <span className={cn(due.late && "text-beni font-semibold")}>{due.text}</span>
                ) : (
                  <span className="text-nibi/70">なし</span>
                )}
              </FieldRow>
              {expanded === "due" && (
                <span className="block pb-3">
                  <DuePicker
                    dueDate={item.due_date}
                    dueTime={item.due_time}
                    today={today}
                    onChange={changeDue}
                  />
                </span>
              )}

              {!isProject && (
                <>
                  <FieldRow
                    label="繰り返し"
                    onToggle={() => setExpanded((e) => (e === "recur" ? null : "recur"))}
                  >
                    {item.recurrence_rule ? (
                      formatRecurrenceRule(item.recurrence_rule)
                    ) : (
                      <span className="text-nibi/70">なし</span>
                    )}
                  </FieldRow>
                  {expanded === "recur" && (
                    <span className="block pb-3">
                      <RecurrenceEditor
                        rule={item.recurrence_rule}
                        hasDue={item.due_date !== null}
                        today={today}
                        onChange={(r) => save({ recurrence_rule: r })}
                      />
                    </span>
                  )}

                  <FieldRow label="リマインダー">
                    <ReminderEditor
                      reminders={detail?.reminders ?? []}
                      dueDate={item.due_date}
                      dueTime={item.due_time}
                      onSave={saveReminders}
                    />
                  </FieldRow>
                  <PushNotice show={(detail?.reminders ?? []).length > 0} />
                </>
              )}

              <FieldRow
                label="プロジェクト"
                onToggle={() => setExpanded((e) => (e === "project" ? null : "project"))}
                trailing={
                  item.parent_id && (
                    <button
                      type="button"
                      aria-label="プロジェクトを外す"
                      onClick={() => changeParent(null)}
                      className="text-nibi/60 hover:text-foreground hit-y text-sm"
                    >
                      ✕
                    </button>
                  )
                }
              >
                {detail?.parent ? detail.parent.title : <span className="text-nibi/70">なし</span>}
              </FieldRow>
              {expanded === "project" && (
                <span className="block pb-3">
                  <ProjectPicker
                    selfId={item.id}
                    currentParentId={item.parent_id}
                    onChange={changeParent}
                  />
                </span>
              )}

              <TagsRow tags={item.tags} onSave={(tags) => save({ tags })} />
            </section>

            <NotesField key={`n-${item.id}`} notes={item.notes} onSave={(n) => save({ notes: n })} />

            <section className="px-4 pt-3 pb-5">
              <h3 className="text-nibi text-xs font-semibold">子ToDo</h3>
              <ul>
                {activeChildren.map((c) => (
                  <li key={c.id} className="border-keisen/70 flex items-center gap-2.5 border-b py-2">
                    <button
                      type="button"
                      aria-label={c.status === "done" ? `${c.title}の完了を取り消す` : `${c.title}を完了`}
                      onClick={() => toggleChild(c)}
                      className={cn(
                        "hit flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                        c.status === "done"
                          ? "bg-tokiwa text-white"
                          : "border-wakuiro hover:border-tokiwa border-[1.75px]",
                      )}
                    >
                      {c.status === "done" ? "✓" : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStack((s) => [...s, c.id])}
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-xs",
                        c.status === "done" && "text-nibi line-through",
                      )}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
              <AddChildField onAdd={addChild} />
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function FieldRow({
  label,
  children,
  onToggle,
  trailing,
}: {
  label: string;
  children: React.ReactNode;
  onToggle?: () => void;
  trailing?: React.ReactNode;
}) {
  const Value = onToggle ? "button" : "span";
  return (
    <span className="border-keisen flex items-start gap-2.5 border-b py-2.5 text-[13px]">
      <span className="text-nibi w-21 shrink-0 pt-px text-xs">{label}</span>
      <Value
        {...(onToggle ? { type: "button" as const, onClick: onToggle } : {})}
        className="min-w-0 flex-1 text-left"
      >
        {children}
      </Value>
      {trailing}
    </span>
  );
}

function TitleField({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [v, setV] = useState(title);
  useEffect(() => setV(title), [title]);

  function commit() {
    const t = v.trim();
    if (t === "") setV(title); // 空タイトルは保存しない（元値に戻す）
    else if (t !== title) onSave(t);
  }

  return (
    <input
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label="タイトル"
      className="focus:border-mikan mx-4 mt-1.5 border-b border-transparent bg-transparent pb-1 text-[16.5px] font-bold outline-none"
    />
  );
}

function NotesField({ notes, onSave }: { notes: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(notes);
  useEffect(() => setV(notes), [notes]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== notes) onSave(v);
      }}
      placeholder="メモを書く…"
      aria-label="メモ"
      rows={3}
      className="border-keisen placeholder:text-nibi/60 focus:border-mikan mx-4 mt-3 resize-y rounded-xl border px-3 py-2 text-xs outline-none"
    />
  );
}

function TagsRow({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");

  function commit() {
    const t = v.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) onSave([...tags, t]);
    setV("");
  }

  return (
    <FieldRow
      label="タグ"
      trailing={
        <button
          type="button"
          aria-label="タグを追加"
          onClick={() => setAdding((a) => !a)}
          className="text-mikan hit-y text-xs font-bold"
        >
          ＋
        </button>
      }
    >
      <span className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && !adding && <span className="text-nibi/70">なし</span>}
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            title="タップで削除"
            onClick={() => onSave(tags.filter((x) => x !== t))}
            className="bg-kinari text-foreground/80 hover:bg-beni-soft hover:text-beni rounded-full px-2 py-px text-[10.5px] font-semibold"
          >
            #{t}
          </button>
        ))}
        {adding && (
          <input
            autoFocus
            type="text"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => {
              commit();
              setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="タグ名"
            aria-label="新しいタグ"
            className="border-wakuiro focus:border-mikan w-24 rounded-md border px-1.5 py-0.5 text-[11px] outline-none"
          />
        )}
      </span>
    </FieldRow>
  );
}

function AddChildField({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");

  function commit() {
    const t = v.trim();
    if (!t) return;
    onAdd(t);
    setV("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-mikan hit-y pt-2.5 text-xs font-bold"
      >
        ＋ 子ToDoを追加
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") setOpen(false);
      }}
      placeholder="子ToDoのタイトル…（Enterで追加）"
      aria-label="子ToDoを追加"
      className="border-wakuiro focus:border-mikan mt-2 w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none"
    />
  );
}
