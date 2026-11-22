// Benchmark: serve the measurement page and the built cores.
// By hand: node tools/bench/serve.mjs, then http://localhost:8377/tools/bench/bench.html
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".env": "text/plain; charset=utf-8",
};

export function startServer(port = 8377) {
  const server = createServer((req, res) => {
    const path = resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
    try {
      if (path !== ROOT && !path.startsWith(ROOT + sep)) throw new Error("outside");
      if (!statSync(path).isFile()) throw new Error("not a file");
      res.writeHead(200, {
        "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      createReadStream(path).pipe(res);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8377);
  await startServer(port);
  console.log(`Страница замера: http://localhost:${port}/tools/bench/bench.html`);
}
