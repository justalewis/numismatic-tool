"use client";

import { useState } from "react";
import type { GradingReport } from "@/lib/grading";

// Downscale a chosen image in the browser before upload: keeps the request
// under the serverless body limit, trims image-token cost, and speeds things
// up. Long edge is capped; JPEG re-encode keeps it small.
async function downscale(file: File, maxEdge = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) =>
    canvas.toBlob(
      (blob) => resolve(blob ?? file),
      "image/jpeg",
      0.9,
    ),
  );
}

function ImagePicker({
  label,
  onPick,
  preview,
}: {
  label: string;
  onPick: (file: File) => void;
  preview: string | null;
}) {
  return (
    <div className="drop">
      <label>{label}</label>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
      {preview && <img className="preview" src={preview} alt={`${label} preview`} />}
    </div>
  );
}

function Component({
  name,
  data,
}: {
  name: string;
  data: GradingReport["components"][keyof GradingReport["components"]];
}) {
  return (
    <div className="component">
      <span className="name">{name.replace(/_/g, " ")}</span>
      <span className="tag">{data.confidence} confidence</span>
      <div>
        <strong>{data.rating}</strong> — {data.observations}
      </div>
    </div>
  );
}

export default function Home() {
  const [obverse, setObverse] = useState<File | null>(null);
  const [reverse, setReverse] = useState<File | null>(null);
  const [obversePreview, setObversePreview] = useState<string | null>(null);
  const [reversePreview, setReversePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GradingReport | null>(null);

  function pick(
    setFile: (f: File) => void,
    setPreview: (s: string) => void,
  ) {
    return (file: File) => {
      setFile(file);
      setPreview(URL.createObjectURL(file));
    };
  }

  async function submit() {
    if (!obverse || !reverse) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const [ob, rev] = await Promise.all([downscale(obverse), downscale(reverse)]);
      const form = new FormData();
      form.append("obverse", ob, "obverse.jpg");
      form.append("reverse", rev, "reverse.jpg");
      const res = await fetch("/api/grade", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Grading failed.");
      setReport(data.report as GradingReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const id = report?.identification;
  const g = report?.grade;

  return (
    <main className="wrap">
      <h1>Numismatic Tool</h1>
      <p className="lede">
        Upload a clear photo of the front and back of a single coin. You&apos;ll
        get an estimated grading report — identification, a Sheldon-scale grade
        band, and notes on the five grading components. It&apos;s an estimate
        from photographs, not a certified grade.
      </p>

      <div className="uploads">
        <ImagePicker
          label="Obverse (front)"
          preview={obversePreview}
          onPick={pick(setObverse, setObversePreview)}
        />
        <ImagePicker
          label="Reverse (back)"
          preview={reversePreview}
          onPick={pick(setReverse, setReversePreview)}
        />
      </div>

      <button
        className="grade"
        onClick={submit}
        disabled={!obverse || !reverse || loading}
      >
        {loading ? "Grading…" : "Grade this coin"}
      </button>

      {error && <p className="error">{error}</p>}

      {report && id && g && (
        <section className="report">
          <h2>Grade</h2>
          <p className="grade-band">
            {g.adjectival} (Sheldon {g.sheldon_low}
            {g.sheldon_high !== g.sheldon_low ? `–${g.sheldon_high}` : ""})
            <span className="tag">{g.overall_confidence} confidence</span>
          </p>
          <p>{g.summary}</p>
          {g.reference_basis && (
            <p className="muted-note">
              <strong>Calibration:</strong> {g.reference_basis}
            </p>
          )}

          <h2>Rarity &amp; estimated value</h2>
          <dl className="kv">
            <dt>Rarity</dt>
            <dd>{report.market.rarity}</dd>
            <dt>Mintage</dt>
            <dd>{report.market.mintage}</dd>
            <dt>Estimated value</dt>
            <dd>
              {report.market.estimated_value}
              {report.market.currency ? ` ${report.market.currency}` : ""}
            </dd>
            <dt>Basis</dt>
            <dd>{report.market.basis}</dd>
          </dl>

          <h2>Identification</h2>
          <dl className="kv">
            <dt>Country</dt>
            <dd>{id.country}</dd>
            <dt>Denomination</dt>
            <dd>{id.denomination}</dd>
            <dt>Year</dt>
            <dd>{id.year}</dd>
            <dt>Mint mark</dt>
            <dd>{id.mint_mark}</dd>
            <dt>Design / series</dt>
            <dd>{id.design_type}</dd>
            <dt>Variety</dt>
            <dd>{id.variety}</dd>
            <dt>Pedigree</dt>
            <dd>{id.pedigree}</dd>
            <dt>Strike type</dt>
            <dd>{id.strike_type}</dd>
          </dl>

          <h2>Catalogue match</h2>
          {report.catalog.matched ? (
            <dl className="kv">
              <dt>Numista</dt>
              <dd>
                {report.catalog.url ? (
                  <a href={report.catalog.url} target="_blank" rel="noreferrer">
                    {report.catalog.title || `Type ${report.catalog.numista_id}`}
                  </a>
                ) : (
                  report.catalog.title
                )}
              </dd>
              <dt>Issuer</dt>
              <dd>{report.catalog.issuer}</dd>
              <dt>Minted</dt>
              <dd>{report.catalog.year_range}</dd>
              <dt>Composition</dt>
              <dd>{report.catalog.composition}</dd>
              <dt>Weight</dt>
              <dd>{report.catalog.weight_g}</dd>
              <dt>Diameter</dt>
              <dd>{report.catalog.diameter_mm}</dd>
              <dt>Match notes</dt>
              <dd>{report.catalog.notes}</dd>
            </dl>
          ) : (
            <p className="muted-note">
              No catalogue match — attribution is from the model&apos;s own
              knowledge. {report.catalog.notes}
            </p>
          )}

          <h2>Grading components</h2>
          {(
            [
              "strike",
              "surface_preservation",
              "luster",
              "coloration",
              "eye_appeal",
            ] as const
          ).map((key) => (
            <Component key={key} name={key} data={report.components[key]} />
          ))}

          <h2>Per-side notes</h2>
          <p>
            <strong>Obverse:</strong> {report.obverse.observations}
          </p>
          <p>
            <strong>Reverse:</strong> {report.reverse.observations}
          </p>

          {report.flags.length > 0 && (
            <>
              <h2>Caveats</h2>
              <ul className="flags">
                {report.flags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}

          <p className="disclaimer">{report.disclaimer}</p>
        </section>
      )}
    </main>
  );
}
