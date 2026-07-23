import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, mergeConfig, type PluginOption } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { hyperframesRenderPlugin } from "./src/studio/hyperframes/render-plugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    viteReact(),
    hyperframesRenderPlugin({
      elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    }),
  ];

  return mergeConfig(
    { server: { host: "127.0.0.1", port: 8080 } },
    {
      plugins,
      define: {
        // Vite supplies mode-correct NODE_ENV; these remaining Node globals are browser shims for
        // bundled HyperFrames dependencies.
        "process.platform": JSON.stringify("browser"),
        "process.version": JSON.stringify(""),
        "process.env": "{}",
        global: "globalThis",
      },
      resolve: {
        alias: {
          "@": fileURLToPath(new URL("./src", import.meta.url)),
          "@hyperframes/core/runtime/lottie-readiness": fileURLToPath(
            new URL("./src/shims/lottie-readiness.ts", import.meta.url),
          ),
          path: fileURLToPath(new URL("./src/shims/path.ts", import.meta.url)),
          "node:path": fileURLToPath(new URL("./src/shims/path.ts", import.meta.url)),
          "node:url": fileURLToPath(new URL("./src/shims/node-url.ts", import.meta.url)),
          "node:fs": fileURLToPath(new URL("./src/shims/node-fs.ts", import.meta.url)),
          esbuild: fileURLToPath(new URL("./src/shims/esbuild.ts", import.meta.url)),
        },
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "@hyperframes/core",
        ],
      },
    },
  );
});
