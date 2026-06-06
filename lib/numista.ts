// Thin client for the Numista catalogue API (v3).
//
// Verified against the official example client and the namachieli/numista-api-sdk
// source:
//   base URL : https://api.numista.com/api/v3
//   auth     : header `Numista-API-Key: <key>`
//   search   : GET /types?q=&category=coin&issuer=&page=&count=&lang=en
//   details  : GET /types/{id}?lang=en
//   issues   : GET /types/{id}/issues?lang=en
//
// A Numista API key is OPTIONAL. Without one, the grader still runs and falls
// back to the model's own knowledge for attribution (catalog.matched = false).
// Get a key at https://en.numista.com/api/ and set NUMISTA_API_KEY.

const NUMISTA_BASE = "https://api.numista.com/api/v3";
const REQUEST_TIMEOUT_MS = 10_000;

export function numistaEnabled(): boolean {
  return Boolean(process.env.NUMISTA_API_KEY);
}

/** Public catalogue page for a type id. */
export function catalogUrl(id: number | string): string {
  return `https://en.numista.com/catalogue/pieces${id}.html`;
}

async function numistaGet(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const key = process.env.NUMISTA_API_KEY;
  if (!key) throw new Error("NUMISTA_API_KEY is not set.");

  const url = new URL(NUMISTA_BASE + path);
  url.searchParams.set("lang", "en");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "Numista-API-Key": key, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Numista API ${res.status} for ${path}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- Typed-enough views over the responses ---------------------------------
// We forward most fields straight to the model as JSON, so these interfaces
// only name the fields we actively read in code; everything else passes through.

export interface NumistaSearchType {
  id: number;
  title?: string;
  category?: string;
  issuer?: { code?: string; name?: string } | string;
  min_year?: number;
  max_year?: number;
}

export interface NumistaSearchResult {
  count: number;
  types: NumistaSearchType[];
}

export async function searchTypes(
  query: string,
  opts: { issuer?: string; count?: number } = {},
): Promise<NumistaSearchResult> {
  const data = (await numistaGet("/types", {
    q: query,
    category: "coin",
    issuer: opts.issuer,
    count: opts.count ?? 8,
    page: 1,
  })) as NumistaSearchResult;
  return data;
}

export async function getType(id: number): Promise<Record<string, unknown>> {
  return (await numistaGet(`/types/${id}`)) as Record<string, unknown>;
}

export async function getIssues(id: number): Promise<unknown> {
  return await numistaGet(`/types/${id}/issues`);
}

// Catalogue price estimates by grade for one issue. Verified path:
// GET /types/{id}/issues/{issueId}/prices?currency=USD&lang=en
// May require API-key permissions / a paid tier; callers treat failure as
// "value unavailable" rather than fatal.
export async function getPrices(
  id: number,
  issueId: number,
  currency = "USD",
): Promise<unknown> {
  return await numistaGet(`/types/${id}/issues/${issueId}/prices`, {
    currency: currency.toUpperCase(),
  });
}
