import type { MetadataRoute } from "next";

// Web App Manifest（docs/design.md 16章）。App Router規約で /manifest.webmanifest として配信され、
// <link rel="manifest"> も自動注入される。ホーム画面追加＝ブラウザ標準UIに任せる。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zendo",
    short_name: "Zendo",
    description: "ADHD向けパーソナルタスク管理",
    // "/" は /today へリダイレクトするため、直接todayに着地させて起動時の一拍を省く
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "ja",
    // スプラッシュ/テーマはアプリのchromeに合わせ無彩色。装飾色は出さない（0章）
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
