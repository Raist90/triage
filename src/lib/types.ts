// Mirrors the Go response types in backend/internal/api. Keep in sync.

/** Handshake payload written by `triage-server` and read by the shell. */
export type Handshake = {
  port: number;
  token: string;
};

export type HealthResponse = {
  ok: boolean;
};

export type User = {
  login: string;
  name: string;
};

export type Repo = {
  owner: string;
  name: string;
};

/** `/config` repo entry. */
export type RepoView = Repo & {
  actions: boolean;
  review: RepoReview;
};

export type RepoReview = {
  available: boolean;
  /** Why review cannot run, e.g. no local path configured. */
  reason?: string;
};

/** Tab IDs are runtime data from `/config`; never hardcode them. */
export type Tab = {
  id: string;
  label: string;
};

export type LinearConfig = {
  teamKeys: string[];
};

export type ActionKind = "explain" | "review";

export type ActionView = {
  id: string;
  label: string;
  kind: ActionKind;
};

export type Config = {
  user: User;
  repos: RepoView[];
  tabs: Tab[];
  linear: LinearConfig;
  actions: ActionView[];
  /** Why the actions list is empty, e.g. the CLI is missing. */
  actionsReason?: string;
  /** Absolute path of the config file the server read. */
  configPath: string;
  /** Set when that file could not be read or parsed; defaults are in use. */
  configError?: string;
};

export type ActionStatus =
  | "queued"
  | "preparing"
  | "running"
  | "validating"
  | "done"
  | "failed"
  | "canceled";

export type ActionJob = {
  action: string;
  sha: string;
  status: ActionStatus;
  startedAt: string;
  error?: string;
};

export type ActionUsage = {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
};

export type ActionArtifact = {
  action: string;
  model: string;
  sha: string;
  promptVersion: string;
  createdAt: string;
  markdown: string;
  usage: ActionUsage;
  /** Automatic review only: the structured document. */
  review?: ReviewDocument;
  /** Automatic review only: the worktree the run used. */
  worktree?: string;
};

export type ReviewSeverity = "blocking" | "warning" | "nitpick" | "praise";

/** Page order for severity groups and verdict counts. */
export const REVIEW_SEVERITY_ORDER: ReviewSeverity[] = [
  "blocking",
  "warning",
  "nitpick",
  "praise",
];

export type ReviewCategory =
  "risk" | "design" | "architecture" | "conventions" | "tests";

export type ReviewVerdict = {
  safeToMerge: boolean;
  summary: string;
  overridden?: boolean;
};

export type ReviewFinding = {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  claim: string;
  suggestion?: string;
  file: string;
  line: number;
  endLine?: number;
  entity?: string;
  patch?: string;
  anchored: boolean;
  appliedAt?: string;
};

export type ReviewDocument = {
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  omitted?: number;
};

export type ActionResponse = {
  job?: ActionJob;
  artifact?: ActionArtifact;
  /** The artifact was produced for an older SHA. */
  stale?: boolean;
};

export type ActionStreamEvent =
  | { type: "status"; status: ActionStatus }
  | { type: "delta"; text: string }
  | { type: "done"; artifact: ActionArtifact }
  | { type: "error"; code: string; message: string };

export type InvalidateCacheResponse = {
  cleared: number;
};

export type CheckState =
  "success" | "failure" | "pending" | "expected" | "error" | "none";

export type ReviewState =
  "approved" | "changes_requested" | "review_required" | "none";

/** Review actions accepted by the server. */
export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export type Comment = {
  author: string;
  body: string;
  createdAt: string;
  kind: "comment" | "review" | "verdict";
  /** Verdict only: approved, changes_requested, commented, dismissed. */
  state?: string;
  /** Inline review comment anchor. */
  path?: string;
  line?: number;
};

export type PR = {
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string;
  headSHA: string;
  branch: string;
  baseBranch: string;
  checkStatus: CheckState;
  reviewState: ReviewState;
  /** Detail responses only: the authenticated GitHub login. */
  viewerLogin?: string;
  /** Detail responses only: the viewer's latest review, e.g. "approved". */
  viewerReview?: string;
  /** Detail responses only: false on your own PR, where approval is rejected. */
  viewerCanApprove?: boolean;
  state: string;
  description: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Detail responses only. */
  createdAt?: string;
  updatedAt: string;
  isDraft: boolean;
  /** Detail responses only: mergeable, conflicting or unknown. */
  mergeable?: "mergeable" | "conflicting" | "unknown";
  /** Detail responses only: clean, blocked, dirty, draft, unstable, unknown. */
  mergeStateStatus?: string;
  /** Detail responses only: false when the repo disables squash merges. */
  squashMergeAllowed?: boolean;
  /** Detail responses only. */
  comments?: Comment[];
};

export type PRListResponse = {
  viewer: User;
  prs: PR[];
};

export type PRDetailResponse = {
  pr: PR;
};

export type SemanticChange = {
  changeType: string;
  entityType: string;
  entityName: string;
  startLine?: number;
  endLine?: number;
  oldStartLine?: number;
  oldEndLine?: number;
  oldEntityName?: string;
  oldFilePath?: string;
  /** True when sem saw only formatting, whitespace, or comment edits. */
  cosmetic?: boolean;
};

export type SemanticSummary = {
  fileCount: number;
  added: number;
  modified: number;
  deleted: number;
  moved: number;
  renamed: number;
  reordered: number;
  orphan: number;
  binary: number;
  total: number;
};

export type ReviewBand = "high" | "medium" | "low";

/** Deterministic focus ranking from the Go side; never a safety verdict. */
export type FileReview = {
  score: number;
  band: ReviewBand;
  changes: {
    added?: number;
    modified?: number;
    deleted?: number;
    moved?: number;
    cosmetic?: number;
  };
  signals: {
    deletes?: number;
    rewrites?: number;
    renameRipples?: number;
    cosmeticOnly?: boolean;
    moduleOnly?: boolean;
    noTests?: boolean;
  };
};

/** PR-level review effort from the Go side. Absent when sem found nothing. */
export type Complexity = {
  score: number;
  band: ReviewBand;
  sourceFiles: number;
  changes: number;
  deletes: number;
  rewrites: number;
  ripples?: number;
};

export type DiffSpan = {
  text: string;
  kind?:
    | "keyword"
    | "string"
    | "number"
    | "comment"
    | "type"
    | "func"
    | "variable"
    | "tag"
    | "property"
    | "builtin";
  emph?: boolean;
};

export type DiffLine = {
  kind: "context" | "add" | "del";
  oldNumber?: number;
  newNumber?: number;
  text: string;
  spans?: DiffSpan[];
};

export type DiffHunk = {
  header: string;
  section?: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffFile = {
  path: string;
  oldPath?: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
  hunks?: DiffHunk[];
  binary: boolean;
  /** Path classification from the Go side: test, docs, generated. */
  kinds?: string[];
  semantic?: SemanticChange[];
  review?: FileReview;
};

export type PRDiffResponse = {
  files: DiffFile[];
  semanticAvailable: boolean;
  semanticSummary?: SemanticSummary;
  complexity?: Complexity;
};

/** One inline review comment anchored to a diff line. */
export type InlineComment = {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line?: number;
  originalLine?: number;
  startLine?: number;
  side?: "RIGHT" | "LEFT";
  commitID: string;
  inReplyToID?: number;
  /** GitHub could not place the comment in the current diff. */
  outdated?: boolean;
};

export type PRCommentsResponse = {
  comments: InlineComment[];
};
