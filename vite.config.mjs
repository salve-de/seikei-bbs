import { cloudflare } from "@cloudflare/vite-plugin";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { defineConfig } from "vite";

function sitesMetadata() {
  return {
    name: "sites-metadata",
    apply: "build",
    async closeBundle() {
      await rm("dist/.openai", { recursive: true, force: true });
      await mkdir("dist/.openai", { recursive: true });
      await cp(".openai/hosting.json", "dist/.openai/hosting.json");
      await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
      await cp("public", "dist/client", { recursive: true });
      await cp("dist/server/index.mjs", "dist/server/index.js");
      const workerConfigPath = "dist/server/wrangler.json";
      const workerConfig = JSON.parse(await readFile(workerConfigPath, "utf8"));
      workerConfig.main = "index.js";
      await writeFile(workerConfigPath, `${JSON.stringify(workerConfig, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [
    sitesMetadata(),
    cloudflare({
      config: {
        name: "server",
        main: "./worker/index.js",
        compatibility_date: "2026-07-10",
        assets: {
          binding: "ASSETS",
          html_handling: "none",
          run_worker_first: ["/api/*", "/", "/room/*", "/thread/*", "/politician/*", "/politicians", "/new"],
        },
        d1_databases: [
          {
            binding: "DB",
            database_name: "political-economy-forum",
            database_id: "00000000-0000-4000-8000-000000000000",
          },
        ],
      },
    }),
  ],
});
