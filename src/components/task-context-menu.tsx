"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ContextMenuItem =
  | { label: string; onSelect: () => void; danger?: boolean }
  | "separator";

type MenuState = { x: number; y: number; items: ContextMenuItem[] } | null;

// PC（マウス）専用。タッチ長押し由来の contextmenu は素通りさせる（19章のポインタ判定に合わせる）
const isFinePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

export function useContextMenu() {
  const [state, setState] = useState<MenuState>(null);

  const open = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    if (!isFinePointer()) return;
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  const menu = state ? <ContextMenu state={state} onClose={close} /> : null;
  return { open, menu };
}

function ContextMenu({ state, onClose }: { state: NonNullable<MenuState>; onClose: () => void }) {
  const ref = useRef<HTMLMenuElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // 画面端で見切れないよう実寸を測ってクランプ
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(state.y, window.innerHeight - height - 8)),
    });
  }, [state]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <menu
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="border-keisen bg-background fixed z-50 w-44 rounded-xl border py-1 text-xs shadow-xl"
    >
      {state.items.map((it, i) =>
        it === "separator" ? (
          <li key={i} className="border-keisen my-1 border-t" aria-hidden />
        ) : (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                it.onSelect();
                onClose();
              }}
              className={cn(
                "hover:bg-kinari w-full px-4 py-2 text-left",
                it.danger && "text-beni hover:bg-beni-soft font-semibold",
              )}
            >
              {it.label}
            </button>
          </li>
        ),
      )}
    </menu>
  );
}
