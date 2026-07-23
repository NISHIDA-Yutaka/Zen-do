"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/push-client";

// 起動時にService Workerを登録するだけの非描画コンポーネント（docs/design.md 16章）。
export function PwaRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
