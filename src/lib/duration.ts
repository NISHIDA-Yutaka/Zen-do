// 所要時間の表記を分に直す（docs/design.md 11章）。
// Smart Input（`~30m`）と右クリックメニューの自由入力欄で同じ書式を使うため、ここに集約する。

/** DBのCHECK制約（1〜1440分）に合わせる */
export const MAX_DURATION_MIN = 1440;

// 例: 5m / 90m / 1h / 1.5h / 1h20m。時だけ小数を許す（1.5h=90分）
const PATTERN = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/i;

/**
 * `~` の有無どちらでも受け付ける。解釈できない・範囲外は null。
 * 「1h20m」のように時と分を並べた表記も1つの値として扱う。
 */
export function parseDuration(text: string): number | null {
  const body = text.trim().replace(/^~/, "").replace(/\s+/g, "");
  if (!body) return null;

  const m = PATTERN.exec(body);
  if (!m) return null;
  const [, hours, minutes] = m;
  // 単位が1つも無い（"~" だけ等）は不正
  if (hours === undefined && minutes === undefined) return null;

  const total = Math.round(Number(hours ?? 0) * 60) + Number(minutes ?? 0);
  if (!Number.isFinite(total) || total < 1 || total > MAX_DURATION_MIN) return null;
  return total;
}
