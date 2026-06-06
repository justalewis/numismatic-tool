# Numismatic Tool

Upload the front (obverse) and back (reverse) of a coin and get an **estimated
numismatic grading report**: identification and attribution, a Sheldon-scale
grade band, and an assessment of the five grading components (strike, surface
preservation, luster, coloration, eye appeal).

The grading is done by Claude vision (`claude-opus-4-8`). It is an estimate from
photographs, **not** a certified grade — luster and fine surface marks can't be
fully judged from a still image, so grades are returned as a band with a
confidence level, never a single authoritative number.

> **Disclaimer:** this is a hobby/AI tool that produces *estimated* assessments
> from photographs. It is not a substitute for in-hand inspection or a
> professional grading service (PCGS, NGC). Don't make buying/selling decisions
> on its output alone.

## Prerequisites

- **Node.js 20+** and npm — check with `node --version`.
- An **Anthropic API key** (required) with billing enabled — https://console.anthropic.com.
- A **Numista API key** (optional, for catalogue grounding) — https://en.numista.com/api/.
- To deploy: a **Fly.io account** and the `flyctl` CLI (optional — it also runs on Vercel).

## Quick start (local)

```bash
git clone <your-repo-url>
cd numismatic-tool
npm install

# create your local secrets file (see "API keys" below for what to put in it)
cp .env.local.example .env.local
#   Windows PowerShell:  Copy-Item .env.local.example .env.local

npm run dev
```

Open **http://localhost:3000**, upload a clear front and back photo of one coin,
and click **Grade this coin**.

## Stack

- **Next.js** (App Router) — runs as a Node container on Fly.io (Dockerfile +
  `fly.toml` included); also deployable on Vercel.
- **API route** `app/api/grade/route.ts` — accepts the two images, calls Claude.
- **Grading logic** `lib/grading.ts` — the rubric system prompt, the JSON output
  schema, and the model call. This is the file to edit when you tune grading.
- **Catalogue grounding** `lib/numista.ts` + `lib/catalog-tools.ts` — a thin
  Numista API client and the lookup tools the model can call to confirm
  identification against the real catalogue (see below).

## How the grading call works

`lib/grading.ts` sends both images to Claude with three things configured:

1. **Structured output** (`output_config.format`) — the model is constrained to
   return JSON matching `REPORT_SCHEMA`, so the response is always parseable.
2. **Prompt caching** — a cache breakpoint sits at the end of the first user
   turn, so the cached prefix is rubric + tool defs + both images (~9.5K
   tokens, over the Opus 4096-token cache minimum). During the catalogue tool
   loop the model re-sends that exact prefix on every turn, so turns after the
   first read the images from cache (~0.1×) instead of re-paying full price —
   the images are the dominant cost. (The rubric alone is ~2.4K tokens, under
   the minimum, so the breakpoint can't sit on the system block.) Watch
   `usage.cache_read_input_tokens` to confirm hits.
3. **Adaptive thinking** at `medium` effort — lets the model reason about
   wear-vs-strike and the circulated/uncirculated boundary before answering.
   Tune `effort` (`low`/`medium`/`high`) in `gradeCoin()`.

Images are downscaled in the browser (`app/page.tsx`) before upload to keep
request payloads small and reduce image-token cost.

## Catalogue grounding (Numista)

Identification is the reliable half of the tool, and it's grounded against the
real [Numista](https://en.numista.com) catalogue rather than the model's memory
alone. When `NUMISTA_API_KEY` is set, the grading call gives Claude catalogue
tools — `search_coin_catalog`, `get_coin_details`, `get_coin_issues`,
`get_coin_prices`, `get_grade_references` — and runs a
tool-use loop: the model searches the catalogue from what it reads on the coin,
opens the best match, verifies the year/mint mark actually exist for that type,
and corrects its own attribution if the catalogue disagrees. The matched
catalogue entry (id, title, mint years, composition, weight, diameter, URL)
appears in the report's `catalog` block.

The catalogue is used for **identification and attribution only** — it does not
grade coins; strike, surfaces, luster, colour, and the grade remain the model's
visual assessment.

`NUMISTA_API_KEY` is **optional**. Without it the grader still runs and
attributes from the model's own knowledge (`catalog.matched` is `false`).

### Rarity & value signal

When the catalogue is available, the grader also reads the **mintage** for the
identified year/mint mark (from `get_coin_issues`) to judge whether it's a key,
semi-key, or common date, and — if `get_coin_prices` is available on your API
tier — pulls catalogue **price estimates by grade** to report a rough value
range bracketing the grade band. This lands in the report's `market` block. It's
a catalogue estimate, explicitly **not an appraisal**; if pricing isn't
available the value is reported as unknown but rarity still comes through.

### Graded-reference archive

`data/exemplars.json` + `lib/exemplars.ts` are the v1 of a graded-reference
archive: known graded reference points keyed by Numista type id. Once a coin is
matched to a catalogue type, the `get_grade_references` tool pulls any stored
references for that exact type so the model can **anchor its grade band** against
known examples (recorded in `grade.reference_basis`). The shipped file is a
placeholder — append verified entries keyed by real type ids to grow it. Keying
off the catalogue match sidesteps visual-similarity search for now; the upgrade
path is image embeddings (e.g. a Coin-CLIP service) behind the same
`getExemplars()` interface.

## Verify with the smoke test

```bash
npm run smoke                       # env + archive + (if key set) catalogue
npm run smoke ./obverse.jpg ./reverse.jpg   # also runs a full live grade
```

The smoke test (`scripts/smoke.ts`) exercises each layer without the browser and
loads `.env.local`. With no keys it still verifies the archive and the no-key
fallbacks; with `NUMISTA_API_KEY` it checks catalogue connectivity and tool
dispatch; with two image paths and `ANTHROPIC_API_KEY` it runs an end-to-end
grade and prints the grade, catalogue match, rarity/value, and cache-hit tokens.

## API keys

All secrets live in `.env.local` (gitignored — never committed). It holds:

```
ANTHROPIC_API_KEY=sk-ant-...     # required
NUMISTA_API_KEY=...              # optional — catalogue grounding
BASIC_AUTH_USER=                 # optional — password gate (set BOTH to enable)
BASIC_AUTH_PASSWORD=
```

- **`ANTHROPIC_API_KEY`** (required): https://console.anthropic.com → **API Keys**.
  Your account needs billing/credits or calls fail with a billing error.
- **`NUMISTA_API_KEY`** (optional): https://en.numista.com/api/ — turns on
  catalogue grounding, rarity, and value. Without it the grader still works and
  attributes from the model's own knowledge.
- **`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`** (optional): set both to put the
  whole app behind a browser login. Leave unset to run open (fine locally).

Restart the dev server after editing `.env.local` — env vars are read at startup.
In production, don't use this file; set the same names as Fly secrets (below).

## Troubleshooting

- **PowerShell: _"npm.ps1 cannot be loaded because running scripts is disabled"_** —
  Windows blocks scripts by default. Run `npm.cmd run dev`, or enable it once for
  your user: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
- **_"Server is missing ANTHROPIC_API_KEY"_ even though it's in `.env.local`** —
  a shell variable of the same name shadows the file (Next.js doesn't override
  real env vars). Clear it (`Remove-Item Env:ANTHROPIC_API_KEY` in PowerShell,
  `unset ANTHROPIC_API_KEY` in bash) and restart.
- **Editing `.env.local` in Notepad** — save as plain **UTF-8** (not "UTF-8 with
  BOM") so a byte-order mark doesn't sneak into the first line.

## Deploy to Fly.io

The repo ships a `Dockerfile` and `fly.toml`; Next.js is configured for
standalone output, so it runs as a long-lived Node container (no serverless
function timeout — good for the thinking latency on complex coins).

```bash
# one-time: install flyctl and sign in
fly auth login

# create the app (edit the name in fly.toml or let launch set it).
# --no-deploy so we can add secrets before the first deploy.
fly launch --no-deploy

# add the keys as secrets (NOT committed)
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set NUMISTA_API_KEY=...        # optional

fly deploy
```

Subsequent deploys are just `fly deploy`. `fly.toml` scales the app to zero when
idle (cheap; first request after idle pays a short cold start) — set
`min_machines_running = 1` to keep one warm.

### Password gate

`middleware.ts` puts the whole app (page + `/api/grade`) behind HTTP Basic Auth
when `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are set. In production set them
as Fly secrets alongside the API keys:

```bash
fly secrets set BASIC_AUTH_USER=coin BASIC_AUTH_PASSWORD=your-strong-password
```

Visitors get a browser login prompt; the credentials are cached for the session.
Leave the vars unset to run ungated (e.g. local dev). Change the password any
time with another `fly secrets set` (triggers a redeploy).

> The repo also still works on Vercel (import from GitHub, set the env vars). The
> `maxDuration` export in the API route only affects Vercel's serverless cap; it
> is ignored by the Fly Node server.

## Roadmap

Identification/attribution is the reliable half and works across coin types.
Grading accuracy is best when narrowed to a single well-documented series — see
the project notes for the plan to seed a graded-exemplar reference set and
ground the grade band against it.
