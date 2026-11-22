// Interface build. The port is set by FPGASIM_WEB_PORT (end-to-end tests take a free one), otherwise 5173:
// this address is allowed in the build server CORS (spec section 8.6).
import { readFileSync, writeFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const port = Number(process.env.FPGASIM_WEB_PORT ?? 5173);

// The build server address in public/_headers (decision 173). The default matches web/src/build/client.ts.
const BUILD_URL_MARK = "__BUILD_URL__";
const buildUrl = (process.env.VITE_BUILD_URL ?? "http://localhost:8080").replace(/\/+$/, "");

// Headers from public/_headers (the "/*" block) for vite preview: the end-to-end test setup serves the interface
// with the same content security policy as Cloudflare Pages. The build server address
// in the policy is the setup address from FPGASIM_SERVER.
function previewHeaders(): Plugin {
  return {
    name: "fpgasim-preview-headers",
    configurePreviewServer(server) {
      const headers: [string, string][] = [];
      let inBlock = false;
      for (const line of readFileSync(new URL("public/_headers", import.meta.url), "utf8").split("\n")) {
        if (line.startsWith("#") || line.trim() === "") continue;
        if (!/^\s/.test(line)) {
          inBlock = line.trim() === "/*";
          continue;
        }
        const colon = line.indexOf(":");
        if (!inBlock || colon < 0) continue;
        const value = line.slice(colon + 1).trim();
        headers.push([
          line.slice(0, colon).trim(),
          value.replace(BUILD_URL_MARK, (process.env.FPGASIM_SERVER ?? buildUrl).replace(/\/+$/, "")),
        ]);
      }
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of headers) response.setHeader(name, value);
        next();
      });
    },
  };
}

// The built _headers gets the build server address of this build in place of the mark.
function buildHeaders(): Plugin {
  let outDir = "";
  return {
    name: "fpgasim-build-headers",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir.startsWith("/") ? config.build.outDir : `${config.root}/${config.build.outDir}`;
    },
    closeBundle() {
      const path = `${outDir}/_headers`;
      writeFileSync(path, readFileSync(path, "utf8").replaceAll(BUILD_URL_MARK, buildUrl));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), previewHeaders(), buildHeaders()],
  // shadcn components import interface code through "@/".
  resolve: { alias: { "@": new URL("src", import.meta.url).pathname } },
  // Boards, the message table and examples are taken from the repository root (spec section 10.1).
  server: { port, strictPort: true, fs: { allow: [".."] } },
  preview: { port, strictPort: true },
  worker: { format: "es" },
  // Small font files are not inlined into styles as data: the content policy allows fonts
  // only from the own origin.
  build: { target: "es2022", assetsInlineLimit: 0 },
  test: { include: ["src/**/*.test.ts"], environment: "node", setupFiles: ["src/test-setup.ts"] },
});
