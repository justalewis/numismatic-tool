import Anthropic from "@anthropic-ai/sdk";
import { CATALOG_TOOLS, runCatalogTool } from "@/lib/catalog-tools";
import { numistaEnabled } from "@/lib/numista";

// Lazily-constructed client, reused across requests. Reads ANTHROPIC_API_KEY
// from the environment (set in .env.local locally, Vercel env vars in
// production). Lazy so importing this module (e.g. from the smoke test) doesn't
// require the key to be present until a grade is actually requested.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const GRADING_MODEL = "claude-opus-4-8";

// Safety cap on the catalog tool-use loop. The model rarely needs more than a
// few lookups; past this we force it to finalize the JSON report.
const MAX_TOOL_LOOPS = 6;

// Image media types Claude vision accepts.
export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

// ---------------------------------------------------------------------------
// The grading rubric.
//
// This is the model's standing instruction set. It is deliberately long and
// frozen: it is sent as a cached system block on every request, so the same
// bytes are reused and only the per-request images are billed at full price.
// Keep it byte-stable — interpolating anything dynamic (dates, IDs) here would
// silently break the prompt cache. Edit the rubric freely between deploys; just
// don't template per-request values into it.
//
// Note on caching: the Opus tier only caches prefixes of >= 4096 tokens. This
// rubric is sized to clear that bar. If you trim it below ~4096 tokens the
// cache silently stops engaging (no error) — watch usage.cache_read_input_tokens.
// ---------------------------------------------------------------------------
export const GRADING_SYSTEM_PROMPT = `You are a numismatic grading assistant. You are given two photographs of a single coin — the obverse (front) and the reverse (back) — and you produce a structured grading report.

You must respond ONLY with a JSON object matching the schema provided to you. Do not include any prose outside the JSON.

# Your stance and limits

You are an expert-level assistant, but you are working from still photographs, not a coin in hand. State your assessments with appropriate, honest confidence. Two things you genuinely cannot judge fully from a single still image, and you must say so:

- LUSTER: cartwheel luster is observed by rotating a coin under a single light source. A still photo captures one frozen reflection. You can note whether luster appears present, broken, or absent in the image, but flag that any luster assessment from a photo is provisional.
- SURFACE PRESERVATION at fine scale: hairlines, light cleaning, and faint contact marks may not resolve in a photo. Note what you can see; flag what you cannot rule out.

Never present a single authoritative grade as if it were a slab-certified result. Always express the numerical grade as a BAND (a low and a high on the Sheldon scale) plus a confidence level. A photo-based estimate that spans several points is honest; a single exact number is not.

# 1. Identification and attribution

Identify, as far as the images allow:
- Country/issuing authority and denomination (face value).
- Year of issue. If the date is worn or out of frame, say so rather than guessing; you may give a probable range with low confidence.
- Mint mark (e.g., D, S, O, CC, P, or none). Note its location and whether it is legible.
- Design type / series (e.g., "Lincoln Wheat cent", "Morgan dollar", "Indian Head cent", "Mercury dime"). Name the series precisely when you can.
- Variety or notable die characteristics, IF clearly visible: over-dates, doubled dies, repunched mint marks, large/small date, type differences. Only claim a variety when the image actually supports it; otherwise leave it as none/unknown and say the image cannot confirm one.
- Pedigree: only if a holder, label, or provenance marking is visible in the image. Otherwise none.
- Strike type, as a code: MS (Mint State, normal circulation strike), PF (Proof), or SP (Specimen). Infer from surface character (mirrored fields and squared rims suggest PF; satiny/frosty fields suggest MS). If you cannot tell, use Unknown.

When a field is not determinable from the images, use the literal value "Unknown" (or "None" where that is the meaningful answer, e.g. no mint mark, no variety, no pedigree). Do not fabricate.

# Catalogue grounding

You may be given tools to look up the Numista coin catalogue: search_coin_catalog, get_coin_details, get_coin_issues, get_coin_prices, and get_grade_references. WHEN THESE TOOLS ARE AVAILABLE, you must use them before finalizing the report:
- Search the catalogue using what you can read from the images (country, denomination, series, year). Refine the query if the first results don't match.
- Open the best-matching candidate with get_coin_details and confirm the design type, denomination, composition, and the years the type was actually minted.
- Use get_coin_issues to verify that the specific year and mint mark you read from the coin genuinely exist for this type, and to note whether it is a scarce date.
- If the catalogue contradicts your visual read, trust the catalogue for ATTRIBUTION (country, denomination, series, valid years/mint marks) and correct your identification fields accordingly — then record the correction in "flags".
- Fill the "catalog" block from the matched type: set matched to true and record numista_id, title, url, issuer, year_range, composition, weight_g, and diameter_mm from the catalogue. In "notes", say how confident the match is and how you confirmed it.

## Rarity and value (catalogue tools available)

- From the get_coin_issues data, find the mintage for the specific year and mint mark you identified. Judge rarity relative to the series: a well-known key date or a very low mintage is "key"; a noticeably scarce date is "semi-key"; an ordinary high-mintage date is "common"; if you cannot determine mintage, "unknown". Record the mintage and rarity in the "market" block.
- If get_coin_prices is available, call it with the matched type id and the issue id (from get_coin_issues) for your identified year/mint mark. Report a value RANGE in market.estimated_value that brackets your grade band — roughly the catalogue estimate at your low grade up to the estimate at your high grade — with the currency. State in market.basis that this is a rough catalogue estimate, NOT an appraisal. If pricing is unavailable or errors, set estimated_value to "Unknown" and explain in basis.

## Grade calibration with stored references

- Call get_grade_references with the matched type id to retrieve any stored graded reference examples for this exact type. If references come back, compare the coin against them and use them to anchor your grade band, and describe how in grade.reference_basis. If none are on file, set grade.reference_basis to "".

IF THE CATALOGUE TOOLS ARE NOT AVAILABLE, set catalog.matched to false and leave catalogue fields "Unknown" (note in catalog.notes that no lookup was performed); set market.rarity to "unknown", market.mintage / estimated_value to "Unknown", market.currency to "", and explain in market.basis; set grade.reference_basis to ""; and base attribution on your own knowledge (flag the reduced confidence).

The catalogue is for identification, attribution, rarity, and value ONLY. It does not grade coins. Strike, surface, luster, coloration, eye appeal, wear, and the numerical grade are always YOUR assessment from the images.

# 2. The numerical grade and adjective

Use the 70-point Sheldon scale. Give a grade BAND: a low and a high integer from 1 to 70, where 1 is barely identifiable and 70 is a flawless example. Then give the adjectival grade that corresponds to the band.

Adjectival reference (approximate Sheldon ranges):
- Poor (PO-1), Fair (FR-2), About Good (AG-3)
- Good (G-4, G-6)
- Very Good (VG-8, VG-10)
- Fine (F-12, F-15)
- Very Fine (VF-20, VF-25, VF-30, VF-35)
- Extremely Fine / Extra Fine (EF/XF-40, XF-45)
- About Uncirculated (AU-50, AU-53, AU-55, AU-58)
- Mint State (MS-60 through MS-70) for circulation strikes
- Proof (PF-60 through PF-70) for proof strikes

How wear maps to the scale, in brief:
- Heavy wear, rims merging into the field, only outlines of the design: G to VG.
- Moderate wear, all major features present but flat, some letters worn: F to VF.
- Light wear only on the highest points, most detail sharp: XF.
- A trace of friction on the very highest points, near full detail, often residual luster: AU.
- No wear at all — only the marks and frost of a coin that never circulated: MS/PF, separated by the number and severity of contact marks, strike quality, and eye appeal.

The single most important thing to get right is the circulated-vs-uncirculated boundary: is there actual wear (a band, AU or below) or only mint-made marks on an unworn surface (MS/PF)? Look at the highest design points for friction that breaks the luster.

# 3. The five grading components

Assess each of these individually. For each, give a short rating label, a sentence or two of specific observations tied to what you actually see in the images, and a confidence level.

- STRIKE: sharpness and completeness of the design transfer. Are high-relief elements (hair, feathers, stars, lettering, denticles) fully struck up, or soft/mushy in the centers? Distinguish a weak STRIKE (mint-made softness, present from day one) from WEAR (metal lost in circulation) — they look different: a weak strike is soft but undisturbed, wear is flattened and often discolored on the high points.
- SURFACE PRESERVATION: contact marks, bag marks, hairlines, scratches, rim dings, evidence of cleaning or damage. Note location and severity. For Mint State coins this is the primary driver of the grade. Flag anything that looks like cleaning, polishing, or environmental damage explicitly.
- LUSTER: the original mint frost / reflectivity. Note whether it appears full, impaired, or absent — and remember to flag that luster cannot be fully judged from a still image.
- COLORATION: for copper, classify as Red (RD), Red-Brown (RB), or Brown (BN) and comment on originality. For silver and gold, describe any toning, its color and distribution, and whether it reads as natural and attractive or as artificial/questionable. Note any spots, fingerprints, or environmental staining.
- EYE APPEAL: the overall aesthetic impression — the subjective sum of strike, surfaces, luster, and color. Is the coin attractive for its grade, average, or below average? This is explicitly a judgment call; say so.

# Per-side observations

Briefly note what is distinctive on the obverse and on the reverse separately — wear points, marks, and strike characteristics specific to each side.

# Flags and disclaimer

In "flags", list short caveats: anything you could not determine, anything that limits the assessment (image quality, lighting, cropping, glare, suspected cleaning, luster-not-judgeable-from-photo, etc.).

In "disclaimer", restate plainly that this is an estimated assessment from photographs, not a certified grade, and that an in-hand examination or professional grading service (e.g., PCGS, NGC) is required for an authoritative grade and any valuation.

Be specific and tie every claim to something visible in the images. When the images do not support a determination, say so rather than inventing detail.`;

// ---------------------------------------------------------------------------
// Output schema. This is the API contract for output_config.format. The model
// is constrained to emit JSON matching this exactly. Structured-output schemas
// must set additionalProperties:false and list every property in `required`;
// numeric min/max and string-length constraints are NOT supported, so ranges
// (like "1 to 70") are conveyed in descriptions instead.
// ---------------------------------------------------------------------------
const componentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rating: {
      type: "string",
      description: "Short label for this component, e.g. 'sharp', 'soft center', 'heavily bag-marked', 'full red'.",
    },
    observations: {
      type: "string",
      description: "One or two sentences tied to what is visible in the images.",
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["rating", "observations", "confidence"],
} as const;

export const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identification: {
      type: "object",
      additionalProperties: false,
      properties: {
        country: { type: "string", description: "Issuing country/authority, or 'Unknown'." },
        denomination: { type: "string", description: "Face value, e.g. 'One Cent', '$1', or 'Unknown'." },
        year: { type: "string", description: "Year of issue, or a probable range, or 'Unknown'. String to allow values like 'c. 1880' or 'Unknown'." },
        mint_mark: { type: "string", description: "Mint mark letter, 'None', or 'Unknown'." },
        design_type: { type: "string", description: "Series / design type, e.g. 'Lincoln Wheat cent', or 'Unknown'." },
        variety: { type: "string", description: "Notable variety if clearly visible, else 'None' or 'Unknown'." },
        pedigree: { type: "string", description: "Provenance/holder markings if visible, else 'None'." },
        strike_type: { type: "string", enum: ["MS", "PF", "SP", "Unknown"] },
      },
      required: [
        "country",
        "denomination",
        "year",
        "mint_mark",
        "design_type",
        "variety",
        "pedigree",
        "strike_type",
      ],
    },
    catalog: {
      type: "object",
      additionalProperties: false,
      properties: {
        matched: { type: "boolean", description: "True if a Numista catalogue type was matched via the lookup tools." },
        numista_id: { type: "string", description: "Numista type id as a string, or '' if unmatched." },
        title: { type: "string", description: "Catalogue title of the matched type, or 'Unknown'." },
        url: { type: "string", description: "Numista catalogue URL, or ''." },
        issuer: { type: "string", description: "Issuer/country per the catalogue, or 'Unknown'." },
        year_range: { type: "string", description: "Years this type was minted per the catalogue, e.g. '1909-1958', or 'Unknown'." },
        composition: { type: "string", description: "Metal composition per the catalogue, or 'Unknown'." },
        weight_g: { type: "string", description: "Weight in grams per the catalogue, or 'Unknown'." },
        diameter_mm: { type: "string", description: "Diameter in millimeters per the catalogue, or 'Unknown'." },
        notes: { type: "string", description: "How the match was confirmed and how confident it is; or why no lookup was done." },
      },
      required: [
        "matched",
        "numista_id",
        "title",
        "url",
        "issuer",
        "year_range",
        "composition",
        "weight_g",
        "diameter_mm",
        "notes",
      ],
    },
    grade: {
      type: "object",
      additionalProperties: false,
      properties: {
        sheldon_low: { type: "integer", description: "Low end of the Sheldon grade band, 1 to 70." },
        sheldon_high: { type: "integer", description: "High end of the Sheldon grade band, 1 to 70. Equal to or greater than sheldon_low." },
        adjectival: { type: "string", description: "Adjectival grade matching the band, e.g. 'About Uncirculated (AU-50 to AU-55)'." },
        overall_confidence: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string", description: "One or two sentences explaining the grade band." },
        reference_basis: { type: "string", description: "How the band was calibrated against stored graded references, if any were retrieved; '' if none." },
      },
      required: ["sheldon_low", "sheldon_high", "adjectival", "overall_confidence", "summary", "reference_basis"],
    },
    market: {
      type: "object",
      additionalProperties: false,
      properties: {
        rarity: { type: "string", enum: ["key", "semi-key", "common", "unknown"] },
        mintage: { type: "string", description: "Reported mintage for the matched year/mint mark, or 'Unknown'." },
        estimated_value: { type: "string", description: "Rough value RANGE tied to the grade band from catalogue price estimates, or 'Unknown'. Never a single figure." },
        currency: { type: "string", description: "Currency of estimated_value, e.g. 'USD', or ''." },
        basis: { type: "string", description: "How rarity and value were derived (mintage, catalogue price estimates) and the caveat that this is not an appraisal." },
      },
      required: ["rarity", "mintage", "estimated_value", "currency", "basis"],
    },
    components: {
      type: "object",
      additionalProperties: false,
      properties: {
        strike: componentSchema,
        surface_preservation: componentSchema,
        luster: componentSchema,
        coloration: componentSchema,
        eye_appeal: componentSchema,
      },
      required: ["strike", "surface_preservation", "luster", "coloration", "eye_appeal"],
    },
    obverse: {
      type: "object",
      additionalProperties: false,
      properties: { observations: { type: "string" } },
      required: ["observations"],
    },
    reverse: {
      type: "object",
      additionalProperties: false,
      properties: { observations: { type: "string" } },
      required: ["observations"],
    },
    flags: {
      type: "array",
      description: "Short caveats and things that could not be determined.",
      items: { type: "string" },
    },
    disclaimer: { type: "string" },
  },
  required: [
    "identification",
    "catalog",
    "grade",
    "market",
    "components",
    "obverse",
    "reverse",
    "flags",
    "disclaimer",
  ],
} as const;

// TypeScript shape of the report the model returns. Kept in sync with the
// schema above by hand (the schema is the wire contract; this is for typing
// the parsed result).
export interface GradingComponent {
  rating: string;
  observations: string;
  confidence: "low" | "medium" | "high";
}

export interface GradingReport {
  identification: {
    country: string;
    denomination: string;
    year: string;
    mint_mark: string;
    design_type: string;
    variety: string;
    pedigree: string;
    strike_type: "MS" | "PF" | "SP" | "Unknown";
  };
  catalog: {
    matched: boolean;
    numista_id: string;
    title: string;
    url: string;
    issuer: string;
    year_range: string;
    composition: string;
    weight_g: string;
    diameter_mm: string;
    notes: string;
  };
  grade: {
    sheldon_low: number;
    sheldon_high: number;
    adjectival: string;
    overall_confidence: "low" | "medium" | "high";
    summary: string;
    reference_basis: string;
  };
  market: {
    rarity: "key" | "semi-key" | "common" | "unknown";
    mintage: string;
    estimated_value: string;
    currency: string;
    basis: string;
  };
  components: {
    strike: GradingComponent;
    surface_preservation: GradingComponent;
    luster: GradingComponent;
    coloration: GradingComponent;
    eye_appeal: GradingComponent;
  };
  obverse: { observations: string };
  reverse: { observations: string };
  flags: string[];
  disclaimer: string;
}

export interface CoinImage {
  mediaType: SupportedMediaType;
  base64: string;
}

/**
 * Calls Claude vision with the obverse and reverse images and returns the
 * structured grading report.
 *
 * When NUMISTA_API_KEY is configured, the model is given catalogue-lookup tools
 * and may call them across several turns to ground its identification before it
 * emits the final JSON — this function runs that tool loop, executing each
 * lookup against Numista. Without a key, it's a single grounded-by-knowledge
 * pass. Throws on refusal, truncation, or malformed JSON.
 */
export async function gradeCoin(
  obverse: CoinImage,
  reverse: CoinImage,
): Promise<{ report: GradingReport; usage: Anthropic.Messages.Usage }> {
  const tools = numistaEnabled() ? CATALOG_TOOLS : undefined;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "OBVERSE (front) of the coin:" },
        {
          type: "image",
          source: { type: "base64", media_type: obverse.mediaType, data: obverse.base64 },
        },
        { type: "text", text: "REVERSE (back) of the coin:" },
        {
          type: "image",
          source: { type: "base64", media_type: reverse.mediaType, data: reverse.base64 },
        },
        {
          type: "text",
          text: "Grade this coin. If catalogue tools are available, use them to confirm attribution first, then return only the JSON report matching the required schema.",
          // Cache breakpoint at the end of the first user turn. The cached prefix
          // is tools + system (rubric) + both images (~9.5K tokens, over Opus's
          // 4096-token cache minimum). The catalogue tool loop re-sends this exact
          // prefix on every iteration, so iterations after the first read the
          // images from cache (~0.1x) instead of re-paying full price each turn —
          // the images are the dominant cost. (Rubric+tools alone is ~3.1K tokens,
          // under the minimum, which is why the breakpoint can't sit on the system
          // block.) The accumulating tool-result turns after this point are small
          // and left uncached.
          cache_control: { type: "ephemeral" },
        },
      ],
    },
  ];

  let response: Anthropic.Message | undefined;
  for (let loops = 0; ; loops++) {
    // Past the safety cap, force the model to finalize by forbidding further
    // tool calls. In the normal path tool_choice is omitted on every iteration,
    // so the image cache holds; this only kicks in on the rare forced-finalize
    // call (where invalidating one call's cache is fine).
    const toolChoice =
      tools && loops >= MAX_TOOL_LOOPS
        ? ({ type: "none" } as const)
        : undefined;

    response = await client().messages.create({
      model: GRADING_MODEL,
      max_tokens: 4000,
      // Adaptive thinking lets the model reason about wear vs. strike, the
      // circulated/uncirculated boundary, etc. "medium" effort balances grading
      // quality against API-route latency — bump to "high" for more careful
      // analysis, "low" for faster/cheaper responses.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: REPORT_SCHEMA },
      },
      // Frozen rubric. The cache breakpoint lives at the end of the first user
      // turn (see messages below), so the cached prefix covers tools + this
      // system block + the images together — putting the breakpoint here instead
      // would not cache, because tools + rubric is under the 4096-token minimum.
      system: [{ type: "text", text: GRADING_SYSTEM_PROMPT }],
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      messages,
    });

    if (response.stop_reason !== "tool_use") break;

    // Preserve the full assistant turn (thinking blocks + tool_use blocks) —
    // required so interleaved thinking signatures round-trip correctly.
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const content = await runCatalogTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Catalogue lookup failed: ${err instanceof Error ? err.message : "unknown error"}. Proceed using your own knowledge and note this in flags.`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to grade these images.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The grading report was cut off (max_tokens). Try again.");
  }

  // With output_config.format the final text block is valid JSON matching the
  // schema. Thinking/tool_use blocks (if any) precede it.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No JSON report was returned by the model.");
  }

  const report = JSON.parse(textBlock.text) as GradingReport;
  return { report, usage: response.usage };
}
