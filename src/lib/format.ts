// 期限表記ルール（docs/design.md 2章）:
// 当日 = 時刻のみ（時刻指定がなければ表示しない）/ 過去・未来 = 「M月D日」＋時刻あれば併記 / 超過は紅
export function formatDueLabel(
  dueDate: string | null,
  dueTime: string | null,
  today: string,
): { text: string; late: boolean } | null {
  if (!dueDate) return null;
  const time = dueTime ? dueTime.slice(0, 5) : null;
  if (dueDate === today) {
    return time ? { text: time, late: false } : null;
  }
  const [, m, d] = dueDate.split("-").map(Number);
  return {
    text: `${m}月${d}日${time ? ` ${time}` : ""}`,
    late: dueDate < today,
  };
}
