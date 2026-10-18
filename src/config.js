import path from "path";

export const PORT = process.env.PORT || 3000;
export const SOURCE_URL = "https://nationsmaten.se/search?q=";
export const REFRESH_MS = 6 * 60 * 60 * 1000;
export const GEMINI_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = "gemini-2.5-flash";
export const PUBLIC_DIR = path.join(process.cwd(), "public");

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DISH_TYPES = { Huvudrätt: "Main", Sidorätt: "Side", Efterrätt: "Dessert", Övrigt: "Other" };
export const MENU_TYPES = { Frukost: "Breakfast", Fika: "Fika", Lunch: "Lunch", Pub: "Pub", Nattmeny: "Night", Övrigt: "Other" };