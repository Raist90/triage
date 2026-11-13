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
};

/** Tab IDs are runtime data from `/config`; never hardcode them. */
export type Tab = {
  id: string;
  label: string;
};

export type LinearConfig = {
  teamKeys: string[];
};

export type ActionView = {
  id: string;
  label: string;
};

/** Optional external CLI, gated at startup like the actions list. */
export type OmnidiffConfig = {
  available: boolean;
  reason?: string;
};

export type Config = {
  user: User;
  repos: RepoView[];
  tabs: Tab[];
  linear: LinearConfig;
  actions: ActionView[];
  /** Why the actions list is empty, e.g. the CLI is missing. */
  actionsReason?: string;
  omnidiff: OmnidiffConfig;
  /** Absolute path of the config file the server read. */
  configPath: string;
  /** Set when that file could not be read or parsed; defaults are in use. */
  configError?: string;
};

export type ActionStatus =
  "queued" | "running" | "done" | "failed" | "canceled";

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
  /** Detail responses only: the base commit the Omnidiff tab diffs against. */
  baseSHA?: string;
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

/** The paint omnidiff asked for, mapped to our tokens by the view. */
export type OmnidiffSpanKind =
  "plain" | "add" | "del" | "change" | "dim" | "strong";

export type OmnidiffSpan = {
  text: string;
  kind: OmnidiffSpanKind;
};

export type OmnidiffLineKind =
  "context" | "add" | "del" | "change" | "meta" | "summary";

export type OmnidiffLine = {
  kind: OmnidiffLineKind;
  spans: OmnidiffSpan[];
};

export type OmnidiffSection = {
  side: "before" | "after";
  path: string;
  lines: OmnidiffLine[];
};

/** One changed file rendered by the omnidiff CLI. */
export type OmnidiffFile = {
  path: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  summary?: OmnidiffLine[];
  sections?: OmnidiffSection[];
  /** Why this file was not rendered. */
  skipped?: string;
  /** A render failure for this file only. */
  error?: string;
};

export type PROmnidiffResponse = {
  available: boolean;
  reason?: string;
  files: OmnidiffFile[];
  truncated?: boolean;
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
