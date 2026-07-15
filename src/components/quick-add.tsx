"use client";

import { useRef, useState } from "react";

type QuickAddProps = {
  placeholder: string;
  onAdd: (title: string) => void;
};

// IME変換確定のEnterで誤送信しないためのガード付きEnterハンドラ。
// 暗黙送信に頼らず自前で処理する（preventDefaultで二重送信も防ぐ）
function submitOnEnter(e: React.KeyboardEvent<HTMLInputElement>, submit: () => void) {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  e.preventDefault();
  submit();
}

// PC用: リスト末尾の常設入力欄（Today/Inbox共通デザイン。docs/design.md 2章）
export function QuickAddInline({ placeholder, onAdd }: QuickAddProps) {
  const [title, setTitle] = useState("");

  function add() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    add();
  }

  return (
    <form onSubmit={submit} className="hidden items-center gap-2.5 py-3 md:flex">
      <span aria-hidden className="text-mikan text-lg font-extrabold">＋</span>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
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
  );
}

// スマホ用: 右下FAB → 下部入力シート（docs/design.md 2章）
export function QuickAddFab({ placeholder, onAdd }: QuickAddProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle("");
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    add();
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
        <form
          onSubmit={submit}
          className="bg-background fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 p-3 pb-4 shadow-2xl md:hidden"
        >
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => submitOnEnter(e, add)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="border-wakuiro focus-visible:border-mikan flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="bg-mikan rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            追加
          </button>
        </form>
      )}
    </>
  );
}
