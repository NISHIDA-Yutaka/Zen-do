import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// tsconfig の "@/*" -> "src/*" エイリアスをテストでも解決できるようにする
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
