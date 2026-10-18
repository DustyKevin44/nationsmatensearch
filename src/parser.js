import * as cheerio from "cheerio";
import { SOURCE_URL, DAYS, DISH_TYPES, MENU_TYPES } from "./config.js";

function parseDays(text) {
  const [from, to] = text.split("-");
  const start = DAYS.indexOf(from.trim());
  if (start === -1) return [];
  if (!to) return [DAYS[start]];

  const end = DAYS.indexOf(to.trim());
  if (end === -1) return [];

  const days = [];
  for (let i = start; ; i = (i + 1) % 7) {
    days.push(DAYS[i]);
    if (i === end) break;
  }
  return days;
}

function parseOpen(text) {
  const body = text.replace(/^Open:\s*/, "");
  const segments = [];
  for (const part of body.split(",")) {
    const m = part.trim().match(/^([A-Za-z]+(?:-[A-Za-z]+)?)\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (m) segments.push({ days: parseDays(m[1]), from: m[2], to: m[3] });
  }
  return segments;
}

function parseDishes(html) {
  const $ = cheerio.load(html);
  const parsed = [];

  $("button.toggle-btn").each((_, btn) => {
    const header = $(btn);
    const nation = header.find("h4").text().trim();
    const venue = header.find("p").first().text().trim();

    header.next(".collapsible-content").find("h5").each((_, h5) => {
      const card = $(h5).closest("div.border");

      const [menuLabel = "", dishLabel = ""] = card
        .find("p.text-gray-600")
        .first()
        .text()
        .split(" - ")
        .map((s) => s.trim());

      const badges = card
        .find("span.rounded-full")
        .map((_, s) => $(s).text().trim().toLowerCase())
        .get();

      const price = parseFloat(card.find("p.text-amber-600").text());
      const vegan = badges.includes("vegan");
      const href = card.find("a[href^='/nation/']").attr("href") || "";

      parsed.push({
        id: parsed.length + 1,
        name: $(h5).text().trim(),
        description: card.find("p.italic").text().trim(),
        price: price > 0 ? price : null,
        nation,
        nationSlug: decodeURIComponent(href.split("/").pop() || ""),
        venue,
        menuType: MENU_TYPES[menuLabel] || "Other",
        dishType: DISH_TYPES[dishLabel] || "Other",
        vegan,
        vegetarian: vegan || badges.includes("veg"),
        lactoseFree: badges.includes("lactose-free"),
        glutenFree: badges.includes("gluten-free"),
        open: parseOpen(card.find("p.text-gray-600.mt-1").text().trim()),
      });
    });
  });

  const expected = Number($("h3").text().match(/\((\d+)\)/)?.[1]);
  return { parsed, expected };
}

export async function fetchAndParseDishes() {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "nationsmaten-search-dev (own site)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  return parseDishes(html);
}