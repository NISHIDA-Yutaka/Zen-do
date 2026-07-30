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
        case "Delete":
        case "Backspace":
          if (selectedId) {
            e.preventDefault();
            onDrop(selectedId);
          }
          break;
      }
    },
    [selectedId, move, onOpen, onComplete, onDrop],
  );

  // Tab等でリストにフォーカスが来たら未選択なら先頭を選ぶ
  const onFocus = useCallback(() => {
    setSelectedId((cur) => (cur && ids.includes(cur) ? cur : (ids[0] ?? null)));
  }, [ids]);

  const listProps = {
    ref: listRef,
    tabIndex: 0,
    onKeyDown,
    onFocus,
    className: "outline-none",
  } as const;

  return { selectedId, listProps, focusList };
}
