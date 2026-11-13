/** PR selection key shape: `owner/name#number`. */
export type PRKey = {
  repo: string;
  number: number;
};

export function parsePRKey(key: string): PRKey | null {
  const hash = key.lastIndexOf("#");
  if (hash <= 0) return null;
  const repo = key.slice(0, hash);
  const number = Number(key.slice(hash + 1));
  if (!repo.includes("/") || !Number.isInteger(number) || number <= 0) {
    return null;
  }
  return { repo, number };
}
