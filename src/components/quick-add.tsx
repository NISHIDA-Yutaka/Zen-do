"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectSuggest, SmartPreview } from "@/components/smart-input-preview";
import { getJson, postJson } from "@/lib/client";
import { todayInJst } from "@/lib/date";
import { parseSmartInput, type ProjectRef, type SmartParseResult } from "@/lib/smart-input";
import type { Item } from "@/lib/types";

/** 確定時に渡す解釈済みペイロード。smart=false の画面ではタイトルのみ入る。 */
export type QuickAddPayload = {
  title: string;
  due_date?: string | null;
  due_time?: string | null;
  tags?: string[];
  parent_id?: string | null;
  captured_raw?: string;
};

type QuickAddProps = {
  placeholder: string;
  onAdd: (payload: QuickAddPayload) => void;
  /** Smart Input（解釈＋プレビュー）を有効にする。Today/Inboxのみtrue（docs/design.md 11.1） */
  smart?: boolean;
  /** 日付トークンが無いときの既定期日（Today=今日 / Inbox=なし） */
  defaultDueDate?: string | null;
};

// IME変換確定のEnterで誤送信しないためのガード付きEnterハンドラ
function submitOnEnter(e: React.KeyboardEvent<HTMLInputElement>, submit: () => void) {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  e.preventDefault();
  submit();
}

/** Smart Input の状態（解釈・取り消し・プロジェクト一覧）をまとめる。 */
function useSmartInput(text: string, smart: boolean) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [cancelled, setCancelled] = useState<string[]>([]);

  const loadProjects = useCallback(() => {
    if (!smart) return;
    getJson<{ items: Item[] }>("/api/items?kind=project&status=todo")
      .then((r) => setProjects(r.items.map((p) => ({ id: p.id, title: p.title }))))
      .catch(() => {});
  }, [smart]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const parsed: SmartParseResult | null = smart
    ? parseSmartInput(text, { today: todayInJst(), projects, cancelled })
    : null;

  return {
    parsed,
    projects,
    cancelToken: (key: string) => setCancelled((c) => [...c, key]),
    resetCancelled: () => setCancelled([]),
    reloadProjects: loadProjects,
    addProject: (p: ProjectRef) => setProjects((ps) => [...ps, p]),
  };
}

function buildPayload(
  text: string,
  parsed: SmartParseResult | null,
  defaultDueDate: string | null | undefined,
): QuickAddPayload | null {
  if (!parsed) {
    const t = text.trim();
    return t ? { title: t } : null;
  }
  const title = parsed.title.trim();
  if (!title) return null;
  return {
    title,
    due_date: parsed.dueDate ?? defaultDueDate ?? null,
    due_time: parsed.dueTime,
    tags: parsed.tags,
    parent_id: parsed.projectId,
    captured_raw: text,
  };
}

// PC用: リスト末尾の常設入力欄（Today/Inbox共通デザイン。docs/design.md 2章）
export function QuickAddInline({ placeholder, onAdd, smart = false, defaultDueDate }: QuickAddProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const s = useSmartInput(text, smart);

  function add() {
    const payload = buildPayload(text, s.parsed, defaultDueDate);
    if (!payload) return;
    onAdd(payload);
    setText("");
    s.resetCancelled();
  }

  function pickProject(p: ProjectRef) {
    if (!s.parsed?.projectQuery) return;
    const { start, end } = s.parsed.projectQuery;
    setText(text.slice(0, start) + `!${p.title}` + text.slice(end));
    inputRef.current?.focus();
  }

  async function createProject(title: string) {
    try {
      const { item } = await postJson<{ item: Item }>("/api/items", { kind: "project", title });
      s.addProject({ id: item.id, title: item.title });
      pickProject({ id: item.id, title: item.title });
    } catch {
      /* 失敗時はサジェストを閉じるだけ（入力は保持） */
    }
  }

  return (
    <div className="relative hidden md:block">
      {s.parsed && <SmartPreview parsed={s.parsed} onCancelToken={s.cancelToken} />}
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-2.5 pb-3">
        <span aria-hidden className="text-mikan text-lg font-extrabold">＋</span>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => submitOnEnter(e, add)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="border-wakuiro placeholder:text-nibi/70 focus-visible:border-mikan flex-1 border-b border-dashed bg-transparent pb-1 text-sm outline-none"
        />
        <span className="text-nibi/60 text-xs">Enterで追加</span>
        {/* 送信ボタンなしのformはEnterの暗黙送信が発火しない環境があるため、不可視のsubmitを置く */}
        <button type="submit" className="sr-only">
          追加
        </button>
      </form>
      {s.parsed?.projectQuery && (
        <ProjectSuggest
          query={s.parsed.projectQuery.query}
          projects={s.projects}
          onPick={pickProject}
          onCreate={createProject}
        />
      )}
    </div>
  );
}

// スマホ用: 右下FAB → 下部入力シート（docs/design.md 2章）
export function QuickAddFab({ placeholder, onAdd, smart = false, defaultDueDate }: QuickAddProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const s = useSmartInput(text, smart);

  function add() {
    const payload = buildPayload(text, s.parsed, defaultDueDate);
    if (!payload) return;
    onAdd(payload);
    setText("");
    s.resetCancelled();
    inputRef.current?.focus();
  }

  function pickProject(p: ProjectRef) {
    if (!s.parsed?.projectQuery) return;
    const { start, end } = s.parsed.projectQuery;
    setText(text.slice(0, start) + `!${p.title}` + text.slice(end));
    inputRef.current?.focus();
  }

  async function createProject(title: string) {
    try {
      const { item } = await postJson<{ item: Item }>("/api/items", { kind: "project", title });
      s.addProject({ id: item.id, title: item.title });
      pickProject({ id: item.id, title: item.title });
    } catch {
      /* 失敗時はサジェストを閉じるだけ */
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="タスクを追加"
        onClick={() => setOpen(true)}
        className="bg-mikan fixed right-4 bottom-20 z-30 flex size-14 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg md:hidden"
      >
        ＋
      </button>
      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/35 md:hidden"
        />
      )}
      {open && (
        <div className="bg-background fixed inset-x-0 bottom-0 z-50 p-3 pb-4 shadow-2xl md:hidden">
          {/* プレビューは入力欄の上＝キーボードに隠れない位置（docs/design.md 11.1） */}
          <div className="relative">
            {s.parsed && <SmartPreview parsed={s.parsed} onCancelToken={s.cancelToken} />}
            {s.parsed?.projectQuery && (
              <ProjectSuggest
                query={s.parsed.projectQuery.query}
                projects={s.projects}
                onPick={pickProject}
                onCreate={createProject}
              />
            )}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-2">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => submitOnEnter(e, add)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="border-wakuiro focus-visible:border-mikan flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="bg-mikan rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              追加
            </button>
          </form>
        </div>
      )}
    </>
  );
}
