import { GEMINI_KEY, GEMINI_MODEL, DAYS } from "./config.js";

const SYSTEM_PROMPT = `You convert a food search from a student into JSON filters for a menu search of Uppsala student nations.
Dish names are creative ("Hagfors", "The Hot Chick") and mix English and Swedish, so the word the user types rarely appears in the dish text.

Return ONLY JSON. Omit every field the user did not ask for:
{
  "q": string,
  "maxPrice": number,
  "vegan": boolean,
  "vegetarian": boolean,
  "menuType": "Lunch" | "Pub" | "Breakfast" | "Fika" | "Night",
  "dishType": "Main" | "Side" | "Dessert",
  "day": "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday"
}

Rules for "q":
- Syntax: "+" means AND, a space means OR. Every keyword is ONE lowercase word, never a phrase.
- Make one OR-list per concept the user asked for, and join the lists with "+".
- Example for "a burger with some spiciness":
  burger burgare patty bun brioche smash beef notkott+chili chilli jalapeno sriracha chipotle het stark spicy
- Each list has 10-25 words, in English AND Swedish: synonyms, typical ingredients, spellings.
- Use word stems, because matching is by substring ("burger" also matches "Cheeseburger").
- Only include concepts the user actually asked for.
- Never put vegan, vegetarian, prices, days or menu types in "q". Use their own fields.
- "today" and "tonight" mean the current day given in the message.
- "cheap" or "budget" means maxPrice 70.`;

const askCache = new Map();

const stockholmDay = () =>
  new Date().toLocaleDateString("en-US", { timeZone: "Europe/Stockholm", weekday: "long" });

function sanitizeFilters(raw) {
  const pick = (value, allowed) => (allowed.includes(value) ? value : "");
  return {
    q: typeof raw.q === "string" ? raw.q.slice(0, 1000) : "",
    maxPrice: Number(raw.maxPrice) > 0 ? Number(raw.maxPrice) : 0,
    vegan: raw.vegan === true,
    vegetarian: raw.vegetarian === true,
    menuType: pick(raw.menuType, ["Lunch", "Pub", "Breakfast", "Fika", "Night"]),
    dishType: pick(raw.dishType, ["Main", "Side", "Dessert"]),
    day: pick(raw.day, DAYS),
  };
}

export async function askGemini(text) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set");

  const day = stockholmDay();
  const cacheKey = `${day}|${text.toLowerCase()}`;
  if (askCache.has(cacheKey)) return askCache.get(cacheKey);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Current day: ${day}.\n\nSearch: ${text}` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);

  const filters = sanitizeFilters(JSON.parse(data.candidates[0].content.parts[0].text));

  if (askCache.size >= 500) askCache.delete(askCache.keys().next().value);
  askCache.set(cacheKey, filters);
  return filters;
}