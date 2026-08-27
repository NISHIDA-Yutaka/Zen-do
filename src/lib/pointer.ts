// ポインタ種別の判定（docs/design.md 19章）。PC=fine（マウス等）/ タッチ端末=coarse。
// 画面幅ではなくポインタで出し分ける方針を、複数コンポーネントで共有する。
export function isFinePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}
