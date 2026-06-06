import Anthropic from "@anthropic-ai/sdk";
import {
  searchTypes,
  getType,
  getIssues,
  getPrices,
  catalogUrl,
  type NumistaSearchType,
} from "@/lib/numista";
import { getExemplars } from "@/lib/exemplars";

// Catalogue-lookup tools exposed to the model during grading. They let Claude
// confirm its visual identification against the real Numista catalogue, pull
// canonical attribution (mint years, mintmarks, composition), and reconcile any
// disagreement before finalizing the report.
//
// These are only attached when NUMISTA_API_KEY is configured (see grading.ts).

export const CATALOG_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_coin_catalog",
    description:
      "Search the Numista coin catalogue by free-text query (e.g. 'Lincoln cent 1909', 'Morgan dollar', 'Mexico 8 reales'). Returns candidate catalogue types with id, title, issuer, and year range. Use this to find the catalogue entry that matches the coin in the images, then call get_coin_details on the best match.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search, e.g. denomination + series + country + year.",
        },
        issuer: {
          type: "string",
          description:
            "Optional Numista issuer code to narrow results (e.g. 'united_states'). Omit if unsure.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_coin_details",
    description:
      "Get full catalogue details for a Numista type id (composition, weight, size, denomination, mint years, design). Call this on the candidate that best matches the coin to confirm attribution.",
    input_schema: {
      type: "object",
      properties: {
        numista_id: { type: "integer", description: "The Numista type id." },
      },
      required: ["numista_id"],
    },
  },
  {
    name: "get_coin_issues",
    description:
      "List the individual issues (year + mint mark + mintage) for a Numista type id. Each issue has its own issue id. Use this to confirm that the specific year and mint mark you read from the coin actually exist for this type, to read its mintage (for rarity), and to get the issue id needed for pricing.",
    input_schema: {
      type: "object",
      properties: {
        numista_id: { type: "integer", description: "The Numista type id." },
      },
      required: ["numista_id"],
    },
  },
  {
    name: "get_coin_prices",
    description:
      "Get catalogue price estimates by grade for a specific issue. Call this with the Numista type id and the issue id (from get_coin_issues) for the year/mint mark you identified. Returns rough catalogue estimates, not an appraisal. May be unavailable on some API tiers — if it errors, treat value as unknown.",
    input_schema: {
      type: "object",
      properties: {
        numista_id: { type: "integer", description: "The Numista type id." },
        issue_id: { type: "integer", description: "The issue id from get_coin_issues." },
        currency: {
          type: "string",
          description: "3-letter ISO currency code, e.g. 'USD'. Defaults to USD.",
        },
      },
      required: ["numista_id", "issue_id"],
    },
  },
  {
    name: "get_grade_references",
    description:
      "Retrieve stored graded reference examples for a Numista type id from the local reference archive. Call this after matching the coin to a catalogue type to anchor your grade band against known graded examples of this exact type. Returns an empty list if none are on file yet.",
    input_schema: {
      type: "object",
      properties: {
        numista_id: { type: "integer", description: "The Numista type id." },
      },
      required: ["numista_id"],
    },
  },
];

// Keep tool results compact so they don't dominate the context window.
const MAX_RESULT_CHARS = 4000;

function issuerName(issuer: NumistaSearchType["issuer"]): string | undefined {
  if (!issuer) return undefined;
  return typeof issuer === "string" ? issuer : issuer.name ?? issuer.code;
}

function clamp(s: string): string {
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + "…(truncated)" : s;
}

/**
 * Execute a catalog tool call and return the string content for the
 * tool_result block. Errors are returned as readable text (with the caller
 * setting is_error) so the model can recover rather than the request failing.
 */
export async function runCatalogTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "search_coin_catalog": {
      const query = String(input.query ?? "");
      const issuer = input.issuer ? String(input.issuer) : undefined;
      const result = await searchTypes(query, { issuer });
      const candidates = (result.types ?? []).map((t) => ({
        numista_id: t.id,
        title: t.title,
        issuer: issuerName(t.issuer),
        min_year: t.min_year,
        max_year: t.max_year,
        url: catalogUrl(t.id),
      }));
      return clamp(JSON.stringify({ count: result.count, candidates }));
    }
    case "get_coin_details": {
      const id = Number(input.numista_id);
      const data = await getType(id);
      return clamp(JSON.stringify({ ...data, url: catalogUrl(id) }));
    }
    case "get_coin_issues": {
      const id = Number(input.numista_id);
      const data = await getIssues(id);
      return clamp(JSON.stringify(data));
    }
    case "get_coin_prices": {
      const id = Number(input.numista_id);
      const issueId = Number(input.issue_id);
      const currency = input.currency ? String(input.currency) : "USD";
      const data = await getPrices(id, issueId, currency);
      return clamp(JSON.stringify({ currency, prices: data }));
    }
    case "get_grade_references": {
      const id = Number(input.numista_id);
      const references = getExemplars(id);
      return clamp(
        JSON.stringify(
          references.length
            ? { references }
            : { references: [], note: "No graded references on file for this type yet." },
        ),
      );
    }
    default:
      throw new Error(`Unknown catalog tool: ${name}`);
  }
}
