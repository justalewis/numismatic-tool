import data from "@/data/exemplars.json";

// Graded-reference archive.
//
// This is the v1 of the "graded-exemplar reference archive": a store of known
// graded reference points keyed by Numista type id. Once the grader matches a
// coin to a catalogue type, it can pull any stored references for that exact
// type and use them to anchor (calibrate) its grade band — the model is told
// "here are known graded examples of this exact type" rather than grading in a
// vacuum.
//
// Keying off the Numista type id sidesteps the hard part (visual similarity
// search) by reusing the catalogue match as the join key. The upgrade path is
// to add image embeddings (e.g. a Coin-CLIP service) and do nearest-neighbour
// retrieval against graded images; the retrieval interface below (getExemplars)
// stays the same — only its backing store changes.
//
// To grow the archive: append verified entries to data/exemplars.json keyed by
// real Numista type ids. Good sources are slabbed coins (grade is on the
// holder) and auction records that pair a photo with a PCGS/NGC grade — store
// the grade + notes, not redistributed images.

export interface Exemplar {
  /** Numista type id this reference belongs to. */
  numista_id: number;
  /** Human label for the reference. */
  label: string;
  /** Sheldon grade (1–70) of the reference example. */
  grade: number;
  /** Strike type: MS, PF, SP, etc. */
  strike_type: string;
  /** What makes this reference useful for calibration. */
  notes: string;
  /** Provenance of the grade (e.g. "PCGS cert", "auction record", "placeholder"). */
  source: string;
}

const exemplars = data as Exemplar[];

/** All stored graded references for a given Numista type id. */
export function getExemplars(numistaId: number): Exemplar[] {
  return exemplars.filter((e) => e.numista_id === numistaId);
}

/** Total number of references in the archive (for diagnostics). */
export function exemplarCount(): number {
  return exemplars.length;
}
