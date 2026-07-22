import { TodayView } from "@/components/today-view";

// ?item=<id> は通知タップの着地点（docs/design.md 15.3）。
// useSearchParams はSuspense境界を要求するため、サーバー側で受けて渡す。
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const item = (await searchParams).item;
  return <TodayView initialItemId={typeof item === "string" ? item : null} />;
}
