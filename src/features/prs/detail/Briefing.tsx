import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Markdown } from "../../../components/Markdown";
import { StatusIcon } from "../../../components/StatusBadge";
import { MicroLabel } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import { formatAgo } from "../../../lib/time";
import { REVIEW_SEVERITY_ORDER } from "../../../lib/types";
import type {
  Comment,
  PR,
  PRDiffResponse,
  ReviewDocument,
  ReviewFinding,
} from "../../../lib/types";
import { Avatar } from "./Avatar";
import { RecentConversation } from "./Conversation";

type BriefingProps = {
  pr: PR;
  /** The list tab the PR was opened from; drives the Why label and kicker. */
  tab: string;
  diff?: PRDiffResponse;
  review?: ReviewDocument;
  reviewStale: boolean;
  onOpenInDiff: (path: string, line?: number) => void;
  onOpenConversation: () => void;
};

function Section({
  label,
  tail,
  children,
}: {
  label: string;
  tail?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 border-t border-line pt-2">
        <MicroLabel className="text-fg-muted">{label}</MicroLabel>
        {tail ? (
          <span className="ml-auto font-mono text-micro text-fg-faint">
            {tail}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * "Needs you" is a claim, so it has a rule: a requested change, a failing
 * check, or a review request opened from the Review requested list.
 */
function needsYou(pr: PR, tab: string): boolean {
  if (pr.reviewState === "changes_requested") return true;
  if (pr.checkStatus === "failure" || pr.checkStatus === "error") return true;
  return tab === "review" && pr.reviewRequested === true;
}

function verdictLabel(comment: Comment): string {
  if (comment.kind !== "verdict" || !comment.state) return "commented";
  switch (comment.state) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "requested changes";
    case "commented":
      return "commented";
    default:
      return comment.state.replace(/_/g, " ");
  }
}

/**
 * The newest verdict or comment, preferring a verdict on a tie. On the
 * viewer's own PR, only other people's entries are "why now".
 */
function whyEntry(pr: PR, tab: string): Comment | null {
  const comments = pr.comments ?? [];
  const viewer = (pr.viewerLogin ?? "").toLowerCase();
  const eligible = comments.filter((comment) => {
    if (tab !== "mine" || viewer === "") return true;
    return comment.author.toLowerCase() !== viewer;
  });

  let best: Comment | null = null;
  for (const comment of eligible) {
    if (!best) {
      best = comment;
      continue;
    }
    const current = Date.parse(comment.createdAt) || 0;
    const previous = Date.parse(best.createdAt) || 0;
    if (
      current > previous ||
      (current === previous &&
        comment.kind === "verdict" &&
        best.kind !== "verdict")
    ) {
      best = comment;
    }
  }
  return best;
}

const SEVERITY_MARK: Record<string, string> = {
  blocking: "bg-danger",
  warning: "bg-fg-muted",
  nitpick: "bg-line-strong",
  praise: "bg-accent",
};

type RiskFile = {
  path: string;
  category: string;
  findings: ReviewFinding[];
  blocking: number;
  warning: number;
  nitpick: number;
};

function severityRank(severity: string): number {
  const index = REVIEW_SEVERITY_ORDER.indexOf(
    severity as (typeof REVIEW_SEVERITY_ORDER)[number],
  );
  return index < 0 ? REVIEW_SEVERITY_ORDER.length : index;
}

function riskFiles(findings: ReviewFinding[]): RiskFile[] {
  const byPath = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const list = byPath.get(finding.file);
    if (list) list.push(finding);
    else byPath.set(finding.file, [finding]);
  }

  const files = [...byPath.entries()].map(([path, items]) => {
    const ordered = [...items].sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) || a.line - b.line,
    );
    return {
      path,
      category: ordered[0].category,
      findings: ordered,
      blocking: ordered.filter((item) => item.severity === "blocking").length,
      warning: ordered.filter((item) => item.severity === "warning").length,
      nitpick: ordered.filter((item) => item.severity === "nitpick").length,
    };
  });

  return files.sort(
    (a, b) =>
      b.blocking - a.blocking ||
      b.warning - a.warning ||
      b.nitpick - a.nitpick ||
      a.path.localeCompare(b.path),
  );
}

function titleCase(value: string): string {
  return value === "" ? value : value[0].toUpperCase() + value.slice(1);
}

function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function Fact({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <span
      className={cx(
        "inline-flex h-4.5 items-center rounded-sm px-1 font-mono text-micro whitespace-nowrap tabular-nums",
        tone === "danger"
          ? "border border-danger/30 bg-danger/8 text-danger"
          : "border border-line text-fg-faint",
      )}
    >
      {children}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="size-0.5 rounded-full bg-line-strong" />
  );
}

/**
 * The open-PR document: identity, why you, context, risk, changes and the two
 * latest conversation entries. Every section hides when its data is absent.
 */
export function Briefing({
  pr,
  tab,
  diff,
  review,
  reviewStale,
  onOpenInDiff,
  onOpenConversation,
}: BriefingProps) {
  const why = whyEntry(pr, tab);
  const findings = review && !reviewStale ? review.findings : [];
  const files = riskFiles(findings);
  const steps = diff?.walkthrough?.steps ?? [];
  const comments = pr.comments ?? [];
  const entries = comments.length;
  const blocking = findings.filter(
    (finding) => finding.severity === "blocking",
  ).length;
  const warning = findings.filter(
    (finding) => finding.severity === "warning",
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-[74ch] flex-col gap-4.5">
      <header className="flex flex-col gap-2">
        {why ? (
          <div className="flex flex-wrap items-center gap-2 font-mono text-micro text-fg-faint">
            {needsYou(pr, tab) ? (
              <>
                <span className="font-medium tracking-[0.08em] text-danger uppercase">
                  Needs you
                </span>
                <Dot />
              </>
            ) : null}
            <span>
              {why.author} {verdictLabel(why)}
            </span>
            <Dot />
            <span className="tabular-nums">{formatAgo(why.createdAt)}</span>
          </div>
        ) : null}

        <h1 className="max-w-[36ch] text-display font-medium tracking-[-0.015em] text-balance text-fg">
          {pr.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-faint">
          <span className="text-fg-body">{pr.author}</span>
          <span aria-hidden="true" className="text-line-strong">
            ·
          </span>
          <span className="font-mono">
            {pr.branch} → {pr.baseBranch}
          </span>
          {pr.commitCount > 0 ? (
            <>
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              <span className="tabular-nums">{pr.commitCount} commits</span>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {pr.checkStatus !== "none" ? (
            <StatusIcon kind="check" state={pr.checkStatus} withLabel />
          ) : null}
          {pr.reviewState !== "none" ? (
            <StatusIcon kind="review" state={pr.reviewState} withLabel />
          ) : null}
          {review ? (
            <span className="flex items-center gap-1.5 text-meta text-fg-muted">
              <Sparkles className="size-3.5 text-fg-faint" aria-hidden />
              <span className="tabular-nums">
                {blocking} blocking · {warning} warning
              </span>
            </span>
          ) : null}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="font-mono text-meta whitespace-nowrap text-fg-faint tabular-nums">
            +{pr.additions} −{pr.deletions}
          </span>
          <Fact>{pr.changedFiles} files</Fact>
          {steps.length > 0 ? <Fact>{steps.length} steps</Fact> : null}
          {blocking > 0 ? <Fact tone="danger">{blocking} blocking</Fact> : null}
        </div>
      </header>

      {why ? (
        <Section
          label={tab === "mine" ? "Why now" : "Why you"}
          tail={
            pr.headSHA
              ? `on ${pr.headSHA.slice(0, 7)}`
              : formatAgo(why.createdAt)
          }
        >
          <div className="flex items-start gap-2.5">
            <Avatar name={why.author} />
            <div className="min-w-0 text-ui leading-5 text-fg-body">
              <span className="font-medium text-fg">{why.author}</span>{" "}
              {verdictLabel(why)}
              <span className="ml-1.5 font-mono text-micro text-fg-faint">
                {formatAgo(why.createdAt)}
              </span>
              {why.body ? (
                <blockquote className="mt-1.5 border-l-2 border-line pl-2.5 whitespace-pre-wrap text-fg-muted">
                  {why.body}
                </blockquote>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      <Section label="Context">
        {pr.description.trim() === "" ? (
          <p className="text-ui text-fg-faint">No description.</p>
        ) : (
          <Markdown>{pr.description}</Markdown>
        )}
      </Section>

      {files.length > 0 ? (
        <Section
          label="Where the risk is"
          tail={`${Math.min(files.length, 3)} of ${pr.changedFiles} files`}
        >
          <div className="flex flex-col border-t border-line">
            {files.slice(0, 3).map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onOpenInDiff(file.path, file.findings[0]?.line)}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line px-1 py-2 text-left transition-colors hover:bg-surface/55"
              >
                <span className="min-w-0 truncate font-mono text-meta text-fg-body">
                  {file.path}
                </span>
                <span className="text-micro tracking-[0.06em] text-fg-faint uppercase">
                  {titleCase(file.category)}
                </span>
                <span className="flex items-center gap-1">
                  {file.findings.slice(0, 3).map((finding) => (
                    <i
                      key={finding.id}
                      aria-hidden="true"
                      className={cx(
                        "block size-2 rounded-[2px]",
                        SEVERITY_MARK[finding.severity] ?? "bg-line-strong",
                      )}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {steps.length > 0 ? (
        <Section label="What changed" tail={`${steps.length} phases`}>
          <div className="flex flex-col gap-1">
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  const path = step.files[0]?.path;
                  if (path) onOpenInDiff(path);
                }}
                className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-sm p-1 text-left transition-colors hover:bg-surface/55"
              >
                <span className="font-mono text-micro leading-5 text-fg-faint tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="block max-w-[58ch] text-meta leading-5 text-pretty text-fg-body">
                  {step.title}
                </span>
                {step.files[0] ? (
                  <span className="mt-0.5 inline-flex h-5 max-w-40 items-center gap-1 rounded-sm border border-line bg-surface px-1 font-mono text-micro whitespace-nowrap text-fg-muted">
                    <span
                      aria-hidden="true"
                      className="size-1 shrink-0 rounded-full bg-current"
                    />
                    <span className="truncate">
                      {fileName(step.files[0].path)}
                    </span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {entries > 0 ? (
        <Section
          label="Conversation"
          tail={`${entries} ${entries === 1 ? "entry" : "entries"}`}
        >
          <RecentConversation
            comments={comments}
            onOpenAll={onOpenConversation}
          />
        </Section>
      ) : null}
    </div>
  );
}
