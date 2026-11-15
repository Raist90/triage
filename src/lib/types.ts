// The server contract lives in Go (`backend/internal/api`) and is generated
// into `src/lib/generated` by `make api`. This module is the app-facing facade:
// it keeps the names the app already imports and holds the few shapes OpenAPI
// cannot express, such as the SSE event union.
//
// Never hand-write a response shape here. Change the Go type, then run
// `make api`.

import type {
  ActionView,
  Artifact,
  FileReview,
  Finding,
  Job,
  Pr,
} from "./generated";

export type {
  ActionResponse,
  ActionView,
  Artifact as ActionArtifact,
  ClearedResponse as InvalidateCacheResponse,
  Comment,
  CommentsResponse as PRCommentsResponse,
  Complexity,
  ConfigResponse as Config,
  DroppedFinding as ReviewDroppedFinding,
  File as DiffFile,
  FileReview,
  Finding as ReviewFinding,
  Hunk as DiffHunk,
  InlineComment,
  Job as ActionJob,
  Line as DiffLine,
  LinearConfig,
  ListResult as PRListResponse,
  OkResponse as HealthResponse,
  Pr as PR,
  PrDetailResponse as PRDetailResponse,
  RepoReviewView as RepoReview,
  RepoView,
  Response as PRDiffResponse,
  Review as ReviewDocument,
  SemanticChange,
  SemanticSummary,
  Span as DiffSpan,
  TabConfig as Tab,
  Usage as ActionUsage,
  UserConfig as User,
  Verdict as ReviewVerdict,
} from "./generated";

/** Handshake payload written by `triage-server` and read by the shell. */
export type Handshake = {
  port: number;
  token: string;
};

/** One tracked repository, as the config file names it. */
export type Repo = {
  owner: string;
  name: string;
};

export type ActionKind = ActionView["kind"];

export type ActionStatus = Job["status"];

export type CheckState = Pr["checkStatus"];

export type ReviewState = Pr["reviewState"];

export type ReviewSeverity = Finding["severity"];

export type ReviewCategory = Finding["category"];

export type ReviewBand = FileReview["band"];

/** Review actions accepted by the server. */
export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** Page order for severity groups and verdict counts. */
export const REVIEW_SEVERITY_ORDER: ReviewSeverity[] = [
  "blocking",
  "warning",
  "nitpick",
  "praise",
];

/**
 * SSE frames from an action stream. The stream is not part of the OpenAPI
 * document, so this union is the one hand-written contract left.
 */
export type ActionStreamEvent =
  | { type: "status"; status: ActionStatus }
  | { type: "delta"; text: string }
  | { type: "done"; artifact: Artifact }
  | { type: "error"; code: string; message: string };
