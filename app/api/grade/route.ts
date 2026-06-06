import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  gradeCoin,
  SUPPORTED_MEDIA_TYPES,
  type CoinImage,
  type SupportedMediaType,
} from "@/lib/grading";

// Grading uses adaptive thinking, which can take a while. Give the function
// headroom (seconds). On Vercel Hobby the ceiling is 60s; Pro allows more.
export const maxDuration = 60;
export const runtime = "nodejs";

// Guard against oversized payloads. Vercel's serverless request-body limit is
// ~4.5MB; the client downsizes images before upload, but we re-check here.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isSupportedMediaType(t: string): t is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(t);
}

async function fileToCoinImage(
  file: FormDataEntryValue | null,
  label: string,
): Promise<CoinImage> {
  if (!file || typeof file === "string") {
    throw new Error(`Missing ${label} image.`);
  }
  if (!isSupportedMediaType(file.type)) {
    throw new Error(
      `${label} image must be JPEG, PNG, WebP, or GIF (got "${file.type || "unknown"}").`,
    );
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${label} image is too large; please use a smaller photo.`);
  }
  return {
    mediaType: file.type,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }

  let obverse: CoinImage;
  let reverse: CoinImage;
  try {
    const form = await request.formData();
    obverse = await fileToCoinImage(form.get("obverse"), "obverse (front)");
    reverse = await fileToCoinImage(form.get("reverse"), "reverse (back)");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid upload." },
      { status: 400 },
    );
  }

  try {
    const { report, usage } = await gradeCoin(obverse, reverse);
    return NextResponse.json({ report, usage });
  } catch (err) {
    // Surface API errors with a sensible status; keep internals out of the body.
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", err.status, err.message);
      return NextResponse.json(
        { error: "Grading service error. Please try again." },
        { status: 502 },
      );
    }
    console.error("Grading failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Grading failed." },
      { status: 500 },
    );
  }
}
