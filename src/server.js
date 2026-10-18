import http from "http";
import fs from "fs";
import path from "path";
import { PORT, REFRESH_MS, PUBLIC_DIR, MIME_TYPES } from "./config.js";
import { fetchAndParseDishes } from "./parser.js";
import { searchDishes } from "./search.js";
import { askGemini } from "./gemini.js";

let dishes = [];
let loadedAt = null;
let lastError = null;

async function loadDishes() {
  try {
    const { parsed, expected } = await fetchAndParseDishes();
    dishes = parsed;
    loadedAt = new Date().toISOString();
    lastError = null;

    console.log(`Loaded ${parsed.length} dishes (page says ${expected})`);
    if (expected && expected !== parsed.length) {
      console.warn("Count mismatch: the parser is missing something.");
    }
  } catch (err) {
    lastError = err.message;
    console.error("Could not load dishes:", err.message);
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(res, pathname) {
  const file = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, file);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.searchParams;

  if (url.pathname === "/api/status") {
    return sendJson(res, 200, { dishes: dishes.length, loadedAt, lastError });
  }

  if (url.pathname === "/api/search") {
    const results = searchDishes(dishes, {
      q: p.get("q") || "",
      maxPrice: Number(p.get("maxPrice")) || 0,
      vegan: p.has("vegan"),
      vegetarian: p.has("vegetarian"),
      menuType: p.get("menuType") || "",
      dishType: p.get("dishType") || "",
      day: p.get("day") || "",
    });
    return sendJson(res, 200, { count: results.length, results });
  }

  if (url.pathname === "/api/ask") {
    const text = (p.get("text") || "").trim().slice(0, 200);
    if (!text) return sendJson(res, 400, { message: "Missing ?text= parameter" });

    try {
      const filters = await askGemini(text);
      const results = searchDishes(dishes, filters);
      return sendJson(res, 200, { interpreted: filters, count: results.length, results });
    } catch (err) {
      console.error("Ask failed:", err.message);
      return sendJson(res, 502, { message: err.message });
    }
  }

  return serveStatic(res, url.pathname);
});

async function main() {
  await loadDishes();
  setInterval(loadDishes, REFRESH_MS);
  server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
}

main();