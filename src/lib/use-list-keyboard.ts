"use client";

import { useCallback, useRef, useState } from "react";

// タスク一覧のキーボード操作（docs/design.md 18.1）。Today/Inbox で共用。
//  Tab でリストにフォーカス→先頭選択 / ↑↓ で移動 / Enter=詳細 / C・Space=完了 / Delete=破棄。
//  入力欄からの ArrowUp は focusList(true) で最下部を選択する。
type Options = {
  ids: string[];
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onDrop: (id: string) => void;
};

export function useListKeyboard({ ids, onOpen, onComplete, onDrop }: Options) {
  const [rawSelected, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 完了/破棄で消えたidは描画時に無効化（effectで消さないことでstate同期のちらつきを避ける）
  const selectedId = rawSelected && ids.includes(rawSelected) ? rawSelected : null;

  const move = useCallback(
    (delta: number) => {
      setSelectedId((cur) => {
        if (ids.length === 0) return null;
        const curValid = cur && ids.includes(cur) ? cur : null;
        const i = curValid ? ids.indexOf(curValid) : -1;
        const next = Math.min(ids.length - 1, Math.max(0, i + delta));
        return ids[next];
      });
    },
    [ids],
  );

  const focusList = useCallback(
    (fromEnd = false) => {
      if (ids.length === 0) return;
      setSelectedId(fromEnd ? ids[ids.length - 1] : ids[0]);
      listRef.current?.focus();
    },
    [ids],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 一覧そのものにフォーカスがある時だけ効かせる。行の中のボタン（完了の丸・子の開閉など）を
      // クリックした後のキー入力まで拾うと、知らないうちに選ばれた行が破棄される（2026-09-26に実害）
      if (e.target !== e.currentTarget) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
          if (selectedId) {
            e.preventDefault();
            onOpen(selectedId);
          }
          break;
        case "c":
        case "C":
        case " ":
          if (selectedId) {
            e.preventDefault();
            onComplete(selectedId);
          }
          break;
        // Backspaceは文字を消すつもりで押しやすく、確認なしの破棄には割り当てない
        case "Delete":
          if (selectedId) {
            e.preventDefault();
            onDrop(selectedId);
          }
          break;
      }
    },
    [selectedId, move, onOpen, onComplete, onDrop],
  );

  // Tab等でリストにフォーカスが来たら未選択なら先頭を選ぶ。
  // 中のボタンのフォーカスも伝わってくるので、一覧そのものが対象の時だけにする
  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      if (e.target !== e.currentTarget) return;
      setSelectedId((cur) => (cur && ids.includes(cur) ? cur : (ids[0] ?? null)));
    },
    [ids],
  );

  const listProps = {
    ref: listRef,
    tabIndex: 0,
    onKeyDown,
    onFocus,
    className: "outline-none",
  } as const;

  return { selectedId, listProps, focusList };
}
