import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      path: fileURLToPath(new URL("./src/shims/path.ts", import.meta.url)),
      esbuild: fileURLToPath(new URL("./src/shims/esbuild.ts", import.meta.url)),
    },
    dedupe: ["react", "react-dom", "@hyperframes/core"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    server: {
      deps: {
        // Bundle @hyperframes/core through Vite so extensionless ESM imports resolve
        inline: ["@hyperframes/core", "@hyperframes/studio"],
      },
    },
  },
});
