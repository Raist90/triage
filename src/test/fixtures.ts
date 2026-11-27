import type {
  Config,
  DiffFile,
  DiffHunk,
  DiffLine,
  InlineComment,
  PR,
  PRDiffResponse,
} from "../lib/types";
import type { DiffCommentsController } from "../features/prs/diff/useDiffComments";

export function makeLine(line: Partial<DiffLine> & { text: string }): DiffLine {
  return { kind: "context", ...line };
}

let hunkCounter = 0;

export function makeHunk(hunk: Partial<DiffHunk> = {}): DiffHunk {
  hunkCounter += 1;
  return {
    header: `@@ -1,2 +1,2 @@ section-${hunkCounter}`,
    oldStart: 1,
    oldCount: 2,
    newStart: 1,
    newCount: 2,
    lines: [
      makeLine({
        kind: "context",
        oldNumber: 1,
        newNumber: 1,
        text: "context",
      }),
      makeLine({ kind: "add", newNumber: 2, text: "added" }),
    ],
    ...hunk,
  };
}

export function makeFile(file: Partial<DiffFile> = {}): DiffFile {
  const path = file.path ?? "src/app.ts";
  return {
    path,
    oldPath: undefined,
    status: "modified",
    binary: false,
    additions: 1,
    deletions: 0,
    patch: "",
    hunks: [makeHunk()],
    ...file,
  };
}

export function makePR(pr: Partial<PR> = {}): PR {
  return {
    repo: "acme/web",
    number: 42,
    title: "Add checkout flow",
    author: "octocat",
    branch: "feat/checkout",
    baseBranch: "main",
    state: "open",
    isDraft: false,
    additions: 12,
    deletions: 4,
    changedFiles: 2,
    commitCount: 3,
    checkStatus: "success",
    reviewState: "review_required",
    headSHA: "abc1234def5678",
    description: "Adds checkout.",
    updatedAt: "2026-06-15T11:55:00Z",
    url: "https://github.com/acme/web/pull/42",
    squashMergeAllowed: true,
    viewerCanApprove: true,
    viewerLogin: "viewer",
    ...pr,
  };
}

export function makeDiffResponse(
  files: DiffFile[],
  overrides: Partial<PRDiffResponse> = {},
): PRDiffResponse {
  return {
    headSHA: "abc1234def5678",
    files,
    semanticAvailable: false,
    ...overrides,
  };
}

export function makeConfig(config: Partial<Config> = {}): Config {
  return {
    configPath: "/Users/test/.triage/config.json",
    user: { login: "viewer", name: "Viewer" },
    repos: [
      {
        owner: "acme",
        name: "web",
        actions: true,
        review: { available: true },
      },
    ],
    linear: { teamKeys: ["ENG"] },
    tabs: [
      { id: "mine", label: "My PRs" },
      { id: "review", label: "Review requested" },
      { id: "all", label: "All open" },
    ],
    actions: [],
    ...config,
  };
}

export function makeInlineComment(
  comment: Partial<InlineComment> = {},
): InlineComment {
  return {
    id: 1,
    author: "viewer",
    body: "Looks good",
    commitID: "abc1234def5678",
    createdAt: "2026-06-15T11:50:00Z",
    path: "src/app.ts",
    side: "RIGHT",
    line: 2,
    ...comment,
  };
}

export function makeCommentsController(
  overrides: Partial<DiffCommentsController> = {},
): DiffCommentsController {
  return {
    comments: [],
    pending: false,
    deletingID: null,
    submit: async () => null,
    remove: async () => null,
    ...overrides,
  };
}
