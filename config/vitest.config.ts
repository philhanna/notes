import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export default mergeConfig(
  viteConfig,
  defineConfig({
    root: projectRoot,
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      globals: false,
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.{idea,git,cache,output,temp}/**",
        "e2e/**",
      ],
    },
  }),
);
