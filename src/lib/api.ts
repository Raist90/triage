import { getHandshake } from "./handshake";
import type {
  ActionArtifact,
  ActionResponse,
  ActionStatus,
  ActionStreamEvent,
  Config,
  HealthResponse,
  InvalidateCacheResponse,
  PRCommentsResponse,
  PRDetailResponse,
  PRDiffResponse,
  PRListResponse,
  ReviewEvent,
} from "./types";

/** The only module that calls `fetch`. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  /** JSON request body; sent as `application/json`. */
  body?: unknown;
  /** `/health` is the one route that does not require the bearer token. */
  auth?: boolean;
};

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { auth: false });
}

export function getConfig(): Promise<Config> {
  return request<Config>("/config");
}

export function invalidateCache(): Promise<InvalidateCacheResponse> {
  return request<InvalidateCacheResponse>("/cache/invalidate", {
    method: "POST",
  });
}

export function clearArtifacts(): Promise<{ cleared: number }> {
  return request<{ cleared: number }>("/artifacts/clear", { method: "POST" });
}

export function clearWorktrees(): Promise<{ cleared: number }> {
  return request<{ cleared: number }>("/worktrees/clear", { method: "POST" });
}

type PRListOptions = {
  tab: string;
  /** `owner/name`, or null for every tracked repo. */
  repo: string | null;
  /** Bypass the server cache read for a manual refresh. */
  refresh?: boolean;
};

export function getPRs({
  tab,
  repo,
  refresh = false,
}: PRListOptions): Promise<PRListResponse> {
  const params = new URLSearchParams({ tab });
  if (repo) params.set("repo", repo);
  if (refresh) params.set("refresh", "1");
  return request<PRListResponse>(`/prs?${params.toString()}`);
}

type PROptions = {
  /** `owner/name`. */
  repo: string;
  number: number;
};

export function getPR({
  repo,
  number,
  refresh = false,
}: PROptions & { refresh?: boolean }): Promise<PRDetailResponse> {
  const params = refresh ? "?refresh=1" : "";
  return request<PRDetailResponse>(`${prPath(repo, number)}${params}`);
}

export function getPRDiff({
  repo,
  number,
}: PROptions): Promise<PRDiffResponse> {
  return request<PRDiffResponse>(`${prPath(repo, number)}/diff`);
}

type SubmitReviewOptions = PROptions & {
  event: ReviewEvent;
  body?: string;
};

/** Post one review. Approved needs no body; the other events require one. */
export function submitReview({
  repo,
  number,
  event,
  body,
}: SubmitReviewOptions): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${prPath(repo, number)}/review`, {
    method: "POST",
    body: { event, body: body ?? "" },
  });
}

type SetPRDraftOptions = PROptions & {
  draft: boolean;
};

/** Toggle a PR between draft and ready for review. Author only. */
export function setPRDraft({
  repo,
  number,
  draft,
}: SetPRDraftOptions): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${prPath(repo, number)}/draft`, {
    method: "POST",
    body: { draft },
  });
}

type MergePROptions = PROptions & {
  /** Head SHA the user reviewed; GitHub rejects the merge if it moved. */
  sha: string;
};

/** Squash merge an open PR. GitHub enforces merge permissions and checks. */
export function mergePR({
  repo,
  number,
  sha,
}: MergePROptions): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${prPath(repo, number)}/merge`, {
    method: "POST",
    body: { method: "squash", sha },
  });
}

export function getPRComments({
  repo,
  number,
  refresh = false,
}: PROptions & { refresh?: boolean }): Promise<PRCommentsResponse> {
  const params = refresh ? "?refresh=1" : "";
  return request<PRCommentsResponse>(
    `${prPath(repo, number)}/comments${params}`,
  );
}

export type SubmitCommentOptions = PROptions & {
  body: string;
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  commitId: string;
};

/** Post one inline review comment. Works on the author's own PR. */
export function submitPRComment({
  repo,
  number,
  body,
  path,
  line,
  side,
  commitId,
}: SubmitCommentOptions): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`${prPath(repo, number)}/comments`, {
    method: "POST",
    body: { body, path, line, side, commitId },
  });
}

/** Delete one inline review comment. GitHub rejects other authors' comments. */
export function deletePRComment({
  repo,
  number,
  commentID,
}: PROptions & { commentID: number }): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `${prPath(repo, number)}/comments/${commentID}`,
    { method: "DELETE" },
  );
}

type ActionOptions = PROptions & {
  actionID: string;
};

export function runAction({
  repo,
  number,
  actionID,
}: ActionOptions): Promise<ActionResponse> {
  return request<ActionResponse>(actionPath(repo, number, actionID), {
    method: "POST",
  });
}

/** GET returns null when the action has never run for this PR. */
export async function getAction({
  repo,
  number,
  actionID,
}: ActionOptions): Promise<ActionResponse | null> {
  try {
    return await request<ActionResponse>(actionPath(repo, number, actionID));
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") return null;
    throw error;
  }
}

export function cancelAction({
  repo,
  number,
  actionID,
}: ActionOptions): Promise<ActionResponse> {
  return request<ActionResponse>(
    `${actionPath(repo, number, actionID)}/cancel`,
    { method: "POST" },
  );
}

type StreamOptions = ActionOptions & {
  signal?: AbortSignal;
  onEvent: (event: ActionStreamEvent) => void;
};

/**
 * SSE over `fetch` because EventSource cannot send the bearer token. Frames are
 * `event: <type>` plus one `data:` JSON line, separated by a blank line.
 */
export async function streamAction({
  repo,
  number,
  actionID,
  signal,
  onEvent,
}: StreamOptions): Promise<void> {
  let base: string;
  let token: string;
  try {
    const handshake = await getHandshake();
    base = `http://127.0.0.1:${handshake.port}`;
    token = handshake.token;
  } catch (error) {
    throw new ApiError(
      "handshake_failed",
      error instanceof Error
        ? error.message
        : "The Triage server handshake is unavailable",
      0,
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `${base}${actionPath(repo, number, actionID)}/stream`,
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw new ApiError("network_error", "Cannot reach the Triage server", 0);
  }

  if (!response.ok) {
    const envelope = errorEnvelope(await readBody(response));
    throw new ApiError(
      envelope?.code ?? "request_failed",
      envelope?.message ?? `Request failed (HTTP ${response.status})`,
      response.status,
    );
  }
  if (!response.body) {
    throw new ApiError(
      "invalid_response",
      "The Triage server returned no stream",
      response.status,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseStreamFrame(frame);
      if (event) {
        onEvent(event);
        if (event.type === "done" || event.type === "error") {
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function parseStreamFrame(frame: string): ActionStreamEvent | null {
  let type = "";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!type || data.length === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data.join("\n")) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  switch (type) {
    case "status":
      return typeof payload.status === "string"
        ? { type, status: payload.status as ActionStatus }
        : null;
    case "delta":
      return typeof payload.text === "string"
        ? { type, text: payload.text }
        : null;
    case "done":
      return isRecord(payload.artifact)
        ? {
            type,
            artifact: payload.artifact as unknown as ActionArtifact,
          }
        : null;
    case "error":
      return {
        type,
        code: typeof payload.code === "string" ? payload.code : "action_failed",
        message:
          typeof payload.message === "string"
            ? payload.message
            : "Action failed",
      };
    default:
      return null;
  }
}

function actionPath(repo: string, number: number, actionID: string): string {
  return `${prPath(repo, number)}/actions/${encodeURIComponent(actionID)}`;
}

type ApplyFindingOptions = ActionOptions & {
  findingID: string;
};

/**
 * Apply one finding's patch to the review worktree. The client sends a finding
 * id only; the server owns the patch text. A second call returns the stored
 * timestamp.
 */
export function applyFindingPatch({
  repo,
  number,
  actionID,
  findingID,
}: ApplyFindingOptions): Promise<{
  ok: boolean;
  appliedAt: string;
  worktree: string;
}> {
  return request(
    `${actionPath(repo, number, actionID)}/patches/${encodeURIComponent(findingID)}`,
    { method: "POST" },
  );
}

function prPath(repo: string, number: number): string {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new ApiError("bad_request", "Invalid pull request repo", 0);
  }
  return `/pr/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${number}`;
}

/** Human-readable message for anything thrown by `request`. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

async function request<T>(
  path: string,
  { method = "GET", body, auth = true }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });

  let base: string;
  try {
    const handshake = await getHandshake();
    if (auth) headers.set("Authorization", `Bearer ${handshake.token}`);
    // Loopback in both dev and prod; the Go server allows the webview origins.
    base = `http://127.0.0.1:${handshake.port}`;
  } catch (error) {
    throw new ApiError(
      "handshake_failed",
      error instanceof Error
        ? error.message
        : "The Triage server handshake is unavailable",
      0,
    );
  }

  let response: Response;
  try {
    if (body !== undefined) headers.set("Content-Type", "application/json");
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network_error", "Cannot reach the Triage server", 0);
  }

  const responseBody = await readBody(response);
  if (!response.ok) {
    const envelope = errorEnvelope(responseBody);
    throw new ApiError(
      envelope?.code ?? "request_failed",
      envelope?.message ?? `Request failed (HTTP ${response.status})`,
      response.status,
    );
  }
  if (responseBody === undefined) {
    throw new ApiError(
      "invalid_response",
      "The Triage server returned an empty response",
      response.status,
    );
  }

  return responseBody as T;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorEnvelope(
  body: unknown,
): { code?: string; message?: string } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { code, message } = body.error;
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
