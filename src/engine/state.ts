import fs from "node:fs";
import path from "node:path";
import type { Icp } from "./icp";
import type { EnrichRun } from "./types";

export interface State {
  /** The latest enrichment run. Scores are computed from it and the ICP, never stored. */
  run: EnrichRun | null;
  /** The ICP edited in the UI. null means the config file is current. */
  icp: Icp | null;
}

/** Where results are kept: LOOOT_SCORE_DIR, or .looot-score in the working directory. */
export function stateFile(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(env.LOOOT_SCORE_DIR ?? ".looot-score", "state.json");
}

/** Reads the saved state. An empty state when there is none or the file is unreadable. */
export function readState(file: string = stateFile()): State {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>;
    return { run: raw.run ?? null, icp: raw.icp ?? null };
  } catch {
    return { run: null, icp: null };
  }
}

/** Writes the state through a temp file so a crash cannot leave half a file. */
export function writeState(state: State, file: string = stateFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}
