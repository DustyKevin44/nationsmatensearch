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

const TRANSLATION_PROMPT = `Translate the provided food descriptions into natural English.
Preserve ingredient names, quantities, and meaning. Do not add details or translate names of dishes, venues, or nations.
Return only JSON in this format: {"translations": ["English description", ...]}.
The translations array must have exactly one string for each input description, in the same order.`;

const askCache = new Map();
const translationCache = new Map();
const swedishDescriptionMarkers = new Set([
  "av",
  "bestar",
  "brod",
  "bonburgare",
  "bonor",
  "efter",
  "eller",
  "flask",
  "fran",
  "farsk",
  "grillad",
  "grillade",
  "gjord",
  "hemmagjord",
  "innehaller",
  "kokt",
  "kyckling",
  "kott",
  "med",
  "och",
  "ost",
  "pa",
  "potatis",
  "rostad",
  "rostade",
  "rostat",
  "sas",
  "sallad",
  "samt",
  "serverad",
  "serveras",
  "stekt",
  "till",
  "utan",
  "var",
]);

const stockholmDay = () =>
  new Date().toLocaleDateString("en-US", { timeZone: "Europe/Stockholm", weekday: "long" });

function sanitizeFilters(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Gemini response must be a JSON object");
  }

  const pick = (value, allowed) => (allowed.includes(value) ? value : "");
  const maxPrice = Number(raw.maxPrice);
  return {
    q: typeof raw.q === "string" ? raw.q.slice(0, 1000) : "",
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : 0,
    vegan: raw.vegan === true,
    vegetarian: raw.vegetarian === true,
    menuType: pick(raw.menuType, ["Lunch", "Pub", "Breakfast", "Fika", "Night"]),
    dishType: pick(raw.dishType, ["Main", "Side", "Dessert"]),
    day: pick(raw.day, DAYS),
  };
}

function isLikelySwedish(description) {
  const words = description
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z]+/g) || [];
  return words.some((word) => swedishDescriptionMarkers.has(word));
}

class InvalidGeneratedJsonError extends Error {
  constructor(operation, cause, finishReason, responseLength) {
    super(`Gemini generated invalid JSON during ${operation}: ${cause.message}`, { cause });
    this.name = "InvalidGeneratedJsonError";
    this.finishReason = finishReason;
    this.responseLength = responseLength;
  }
}

async function generateJson(systemPrompt, userText, operation, maxOutputTokens) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set");

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
            maxOutputTokens,
          },
        }),
      }
    );
  } catch (error) {
    console.error(`[Gemini] ${operation}: request failed before receiving a response`, {
      model: GEMINI_MODEL,
      error: error.message,
      name: error.name,
    });
    throw new Error(`Gemini request failed: ${error.message}`, { cause: error });
  }

  let responseText;
  try {
    responseText = await res.text();
  } catch (error) {
    console.error(`[Gemini] ${operation}: could not read response body`, {
      model: GEMINI_MODEL,
      httpStatus: res.status,
      error: error.message,
      name: error.name,
    });
    throw new Error(`Could not read Gemini response: ${error.message}`, { cause: error });
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    console.error(`[Gemini] ${operation}: response was not valid JSON`, {
      model: GEMINI_MODEL,
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      responseLength: responseText.length,
      error: error.message,
    });
    throw new Error(`Gemini returned invalid JSON (HTTP ${res.status})`, { cause: error });
  }

  if (!res.ok) {
    const apiError = data?.error;
    console.error(`[Gemini] ${operation}: API returned an error`, {
      model: GEMINI_MODEL,
      httpStatus: res.status,
      statusText: res.statusText,
      apiCode: apiError?.code,
      apiStatus: apiError?.status,
      apiMessage: apiError?.message,
    });
    throw new Error(apiError?.message || `Gemini HTTP ${res.status} ${res.statusText}`.trim());
  }

  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const output = Array.isArray(parts)
    ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : "";

  if (!output) {
    console.error(`[Gemini] ${operation}: response did not contain generated text`, {
      model: GEMINI_MODEL,
      candidateCount: Array.isArray(data?.candidates) ? data.candidates.length : 0,
      finishReason: candidate?.finishReason,
      promptFeedback: data?.promptFeedback,
      responseKeys: data && typeof data === "object" ? Object.keys(data) : [],
    });
    throw new Error(
      candidate?.finishReason
        ? `Gemini returned no text (finish reason: ${candidate.finishReason})`
        : "Gemini returned no text"
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    console.error(`[Gemini] ${operation}: generated text was not valid JSON`, {
      model: GEMINI_MODEL,
      finishReason: candidate?.finishReason,
      responseLength: output.length,
      error: error.message,
    });
    throw new InvalidGeneratedJsonError(operation, error, candidate?.finishReason, output.length);
  }

  return parsed;
}

export async function askGemini(text, onProgress = () => {}) {
  const day = stockholmDay();
  const cacheKey = `${day}|${text.toLowerCase()}`;
  if (askCache.has(cacheKey)) return askCache.get(cacheKey);

  onProgress("Interpreting your search with AI");
  const generated = await generateJson(
    SYSTEM_PROMPT,
    `Current day: ${day}.\n\nSearch: ${text}`,
    "filter generation",
    3064
  );
  let filters;
  try {
    filters = sanitizeFilters(generated);
  } catch (error) {
    console.error("[Gemini] Filter generation returned an unexpected structure", {
      model: GEMINI_MODEL,
      responseType: Array.isArray(generated) ? "array" : typeof generated,
      error: error.message,
    });
    throw new Error(`Gemini returned invalid filters: ${error.message}`, { cause: error });
  }

  if (askCache.size >= 500) askCache.delete(askCache.keys().next().value);
  askCache.set(cacheKey, filters);
  return filters;
}

export async function translateDescriptions(descriptions, onProgress = () => {}) {
  const uniqueMissing = [...new Set(descriptions)]
    .filter((description) =>
      description &&
      isLikelySwedish(description) &&
      !translationCache.has(description)
    );

  async function translateBatch(batch, batchNumber) {
    onProgress(`Translating Swedish descriptions (batch ${batchNumber})`);

    let translations;
    try {
      const parsed = await generateJson(
        TRANSLATION_PROMPT,
        JSON.stringify(batch),
        "description translation",
        8192
      );
      translations =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.translations) &&
        parsed.translations.length === batch.length &&
        parsed.translations.every((translation) => typeof translation === "string")
          ? parsed.translations
          : null;
    } catch (error) {
      if (!(error instanceof InvalidGeneratedJsonError)) throw error;

      if (batch.length > 1) {
        console.warn("[Gemini] Retrying incomplete description translation in smaller batches", {
          model: GEMINI_MODEL,
          batchSize: batch.length,
          finishReason: error.finishReason,
          responseLength: error.responseLength,
        });
        const midpoint = Math.ceil(batch.length / 2);
        await translateBatch(batch.slice(0, midpoint), `${batchNumber}.1`);
        await translateBatch(batch.slice(midpoint), `${batchNumber}.2`);
        return;
      }

      throw new Error(
        `Gemini could not complete description translation${error.finishReason ? ` (finish reason: ${error.finishReason})` : ""}`,
        { cause: error }
      );
    }

    if (!translations) {
      console.warn("[Gemini] Description translation returned an unexpected structure", {
        model: GEMINI_MODEL,
        expectedTranslations: batch.length,
      });
      if (batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        await translateBatch(batch.slice(0, midpoint), `${batchNumber}.1`);
        await translateBatch(batch.slice(midpoint), `${batchNumber}.2`);
        return;
      }
      throw new Error("Gemini returned an invalid translation for a description");
    }

    for (let i = 0; i < batch.length; i++) {
      if (translationCache.size >= 500) {
        translationCache.delete(translationCache.keys().next().value);
      }
      translationCache.set(batch[i], translations[i]);
    }
  }

  for (let offset = 0; offset < uniqueMissing.length; offset += 10) {
    const batch = uniqueMissing.slice(offset, offset + 10);
    await translateBatch(batch, `${Math.floor(offset / 10) + 1} of ${Math.ceil(uniqueMissing.length / 10)}`);
  }

  return descriptions.map((description) =>
    translationCache.has(description) ? translationCache.get(description) : description
  );
}