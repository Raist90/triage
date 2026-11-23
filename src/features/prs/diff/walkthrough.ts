import type { DiffFile, WalkthroughStep } from "../../../lib/types";
import { fileKey } from "./diffFile";

/** One file of a path step resolved against the loaded diff. */
export type PathFileEntry = {
  file: DiffFile;
  index: number;
  key: string;
  hunks: number[];
};

/**
 * Resolve one step to the files and hunk indices the diff pane may render.
 * A step file missing from the current diff is skipped rather than invented.
 */
export function pathEntries(
  files: DiffFile[],
  step: WalkthroughStep | undefined,
): PathFileEntry[] {
  if (!step) return [];
  const byPath = new Map<
    string,
    { file: DiffFile; index: number; key: string }
  >();
  files.forEach((file, index) => {
    const entry = { file, index, key: fileKey(file, index) };
    byPath.set(file.path, entry);
    if (file.oldPath) byPath.set(file.oldPath, entry);
  });

  const entries: PathFileEntry[] = [];
  const seen = new Set<string>();
  for (const reference of step.files) {
    const found = byPath.get(reference.path);
    if (!found || seen.has(found.key)) continue;
    seen.add(found.key);
    entries.push({ ...found, hunks: reference.hunks });
  }
  return entries;
}
