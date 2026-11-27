// Finds a Playwright install: this repo first, then sibling checkouts that have one. Chromium comes from /usr/bin/chromium.
// Modules will not load from file://, so the play script serves public/ over HTTP.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const bases = [new URL("../", import.meta.url).pathname, "/home/matt/Code/flop-lab/", "/home/matt/Code/killsaws/", "/home/matt/Code/readerful/"];
let found = null;
for (const b of bases) for (const m of ["playwright-core", "playwright"]) { if (found) break; try { found = createRequire(b + "noop.js")(m); } catch { /* keep looking */ } }
if (!found) throw new Error("No playwright or playwright-core found in " + bases.join(", "));
export const chromium = found.chromium;
export const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM || "/usr/bin/chromium" });

const root = new URL("../public/", import.meta.url);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

export function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    if (pathname.includes("..")) { res.writeHead(400); res.end(); return; }
    try {
      const buf = await readFile(new URL(`.${pathname}`, root));
      res.writeHead(200, { "content-type": types[extname(pathname)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("missing");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let base = "";
export function setBase(next) { base = next; }
export const pageUrl = (q = "") => `${base}/${q.replace(/^\//, "")}`;
