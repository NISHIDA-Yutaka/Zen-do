"use client";

import { SWRConfig } from "swr";
import { getJson } from "@/lib/client";

// SWRのグローバル設定（docs/design.md 17章）。
// グローバルキャッシュはアンマウント後も残るため、タブを戻ると即キャッシュ描画→裏で再取得になる。
export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key: string) => getJson(key),
        revalidateOnFocus: true, // タブ復帰で再取得（二拠点作業の鮮度確保）
        keepPreviousData: true,
        dedupingInterval: 2000,
        // 起動直後の一過性の失敗（Vercelのコールドスタートや電波の立ち上がり）で
        // エラー画面のまま止まらないよう、既定5秒より短い間隔で自動再試行する
        errorRetryInterval: 1000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
