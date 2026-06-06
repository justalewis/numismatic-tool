/*
 * Smoke test for the grading pipeline — exercises each layer without the
 * browser, as far as the available keys allow.
 *
 *   npm run smoke                          # checks env, archive, and (if a
 *                                          #   Numista key is set) catalogue
 *   npm run smoke ./obv.jpg ./rev.jpg      # also runs a full live grade
 *                                          #   (needs ANTHROPIC_API_KEY)
 *
 * Loads .env.local so it sees the same keys the app uses.
 */
import { config as loadEnv } from "dotenv";
// override:true so .env.local wins even if the shell already exports an (empty
// or stale) ANTHROPIC_API_KEY — makes this verifier deterministic. NOTE: the
// real Next.js dev server does NOT override pre-set env vars, so if your own
// shell exports ANTHROPIC_API_KEY, clear it or it will shadow the file there.
loadEnv({ path: ".env.local", override: true });

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { numistaEnabled, searchTypes } from "@/lib/numista";
import { runCatalogTool } from "@/lib/catalog-tools";
import { getExemplars, exemplarCount } from "@/lib/exemplars";
import {
  gradeCoin,
  SUPPORTED_MEDIA_TYPES,
  type CoinImage,
  type SupportedMediaType,
} from "@/lib/grading";

function line() {
  console.log("─".repeat(48));
}

function mediaTypeFor(p: string): SupportedMediaType {
  const ext = path.extname(p).toLowerCase();
  const mt =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/jpeg";
  if (!(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mt)) {
    throw new Error(`Unsupported image type for ${p}`);
  }
  return mt as SupportedMediaType;
}

async function main() {
  console.log("Numismatic Tool — smoke test");
  line();

  // 1. Environment
  console.log("ANTHROPIC_API_KEY :", process.env.ANTHROPIC_API_KEY ? "set" : "MISSING (live grade will be skipped)");
  console.log(
    "NUMISTA_API_KEY   :",
    numistaEnabled() ? "set" : "not set (catalogue grounding + value disabled)",
  );

  // 2. Reference archive (no keys required)
  line();
  console.log(`Reference archive : ${exemplarCount()} exemplar(s) loaded.`);
  const refs = getExemplars(1234);
  console.log(`getExemplars(1234) -> ${refs.length} match(es)`);
  if (refs.length) console.log("   ", JSON.stringify(refs[0]));

  // 3. Numista connectivity + tool dispatch (needs NUMISTA_API_KEY)
  line();
  if (numistaEnabled()) {
    try {
      const res = await searchTypes("Lincoln cent");
      const top = (res.types ?? []).slice(0, 3).map((t) => `${t.id}: ${t.title}`);
      console.log(`Numista search "Lincoln cent": ${res.count} hits`);
      top.forEach((t) => console.log("   ", t));

      const dispatched = await runCatalogTool("search_coin_catalog", {
        query: "Morgan dollar",
      });
      console.log(`Catalog tool dispatch OK (${dispatched.length} bytes returned)`);
    } catch (err) {
      console.log("Numista check FAILED:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("Skipping Numista checks (no NUMISTA_API_KEY).");
  }

  // 4. Claude key validity — a 1-token ping (negligible cost) so we can verify
  //    auth without needing coin images.
  line();
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      await new Anthropic().messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      console.log("Claude key: VALID (authentication OK)");
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        console.log("Claude key: INVALID — authentication failed. Check for a typo (e.g. a leading 'ssk-' should be 'sk-').");
      } else if (err instanceof Anthropic.APIError) {
        console.log(`Claude key: reached the API but got ${err.status} — ${err.message}`);
      } else {
        console.log("Claude ping error:", err instanceof Error ? err.message : err);
      }
    }
  } else {
    console.log("Skipping Claude key check (ANTHROPIC_API_KEY not loaded).");
  }

  // 5. Full live grade (needs image args + ANTHROPIC_API_KEY)
  line();
  const [obvPath, revPath] = process.argv.slice(2);
  if (obvPath && revPath && process.env.ANTHROPIC_API_KEY) {
    const obverse: CoinImage = {
      mediaType: mediaTypeFor(obvPath),
      base64: fs.readFileSync(obvPath).toString("base64"),
    };
    const reverse: CoinImage = {
      mediaType: mediaTypeFor(revPath),
      base64: fs.readFileSync(revPath).toString("base64"),
    };
    console.log(`Grading ${obvPath} + ${revPath} …`);
    const { report, usage } = await gradeCoin(obverse, reverse);
    console.log("  grade        :", report.grade.adjectival, `(${report.grade.sheldon_low}-${report.grade.sheldon_high})`);
    console.log("  identified   :", report.identification.design_type, report.identification.year, report.identification.mint_mark);
    console.log("  catalog match:", report.catalog.matched, report.catalog.title || "");
    console.log("  rarity/value :", report.market.rarity, "/", report.market.estimated_value, report.market.currency);
    // usage reflects the FINAL model call. With the catalogue tool loop, the
    // prefix is written on the first call and read on later ones, so a multi-turn
    // grade shows cache_read > 0 here; a single-turn grade shows cache_write > 0.
    console.log("  final-call cache write:", usage.cache_creation_input_tokens, "tokens");
    console.log("  final-call cache read :", usage.cache_read_input_tokens, "tokens");
  } else {
    console.log("Skipping live grade — pass two image paths AND set ANTHROPIC_API_KEY to run it.");
  }

  line();
  console.log("Smoke test complete.");
}

main().catch((err) => {
  console.error("Smoke test error:", err);
  process.exit(1);
});
