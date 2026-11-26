import { ArrowRight, Sparkles } from "lucide-react";
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
import { PRStateTag } from "../PRStateTag";
import { prStatus } from "../prStatus";
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

function Fact({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] items-center rounded-sm border border-line px-1 font-mono text-micro whitespace-nowrap text-fg-faint tabular-nums">
      {children}
    </span>
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
  const status = prStatus(pr);

  return (
    <div className="mx-auto flex w-full max-w-[76ch] flex-col gap-5">
      <header className="flex flex-col gap-2">
        {why ? (
          <div className="flex flex-wrap items-center gap-2 font-mono text-micro text-fg-faint">
            {needsYou(pr, tab) ? (
              <span className="font-medium tracking-[0.08em] text-danger uppercase">
                Needs you
              </span>
            ) : null}
            <span>
              <span className="text-fg-muted">{why.author}</span>{" "}
              {verdictLabel(why)}
            </span>
            <span
              aria-hidden="true"
              className="size-0.5 rounded-full bg-line-strong"
            />
            <span className="tabular-nums">{formatAgo(why.createdAt)}</span>
          </div>
        ) : null}

        <h1 className="flex min-w-0 items-baseline gap-2 text-title font-medium tracking-[-0.01em] text-fg">
          <span className="min-w-0">{pr.title}</span>
          <PRStateTag status={status} />
        </h1>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-faint">
          <span className="text-fg-muted">{pr.author}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">
            {pr.branch} → {pr.baseBranch}
          </span>
          {pr.commitCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
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

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Fact>
            <span className="text-accent">+{pr.additions}</span>
            <span className="px-1 text-line-strong">−</span>
            <span className="text-danger">{pr.deletions}</span>
          </Fact>
          <Fact>{pr.changedFiles} files</Fact>
          {steps.length > 0 ? <Fact>{steps.length} steps</Fact> : null}
          {blocking > 0 ? (
            <span className="inline-flex h-[18px] items-center rounded-sm border border-danger/30 bg-danger/8 px-1 font-mono text-micro whitespace-nowrap text-danger tabular-nums">
              {blocking} blocking
            </span>
          ) : null}
        </div>
      </header>

      {why ? (
        <Section
          label={tab === "mine" ? "Why now" : "Why you"}
          tail={formatAgo(why.createdAt)}
        >
          <p className="text-ui text-fg-body">
            <span className="font-medium text-fg">{why.author}</span>{" "}
            <span className="text-fg-faint">{verdictLabel(why)}</span>
          </p>
          {why.body ? (
            <p className="line-clamp-4 text-ui whitespace-pre-wrap text-fg-muted">
              {why.body}
            </p>
          ) : null}
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
          tail={`${files.length} of ${pr.changedFiles} files`}
        >
          <div className="flex flex-col">
            {files.slice(0, 3).map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onOpenInDiff(file.path, file.findings[0]?.line)}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface"
              >
                <span className="min-w-0 truncate font-mono text-meta text-fg-body">
                  {file.path}
                </span>
                <span className="text-micro tracking-[0.06em] text-fg-faint uppercase">
                  {titleCase(file.category)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    {file.findings.slice(0, 3).map((finding) => (
                      <i
                        key={finding.id}
                        className={cx(
                          "block size-2 rounded-[2px]",
                          SEVERITY_MARK[finding.severity] ?? "bg-line-strong",
                        )}
                      />
                    ))}
                  </span>
                  <ArrowRight className="size-3.5 text-fg-faint" aria-hidden />
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
                className="flex flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface"
              >
                <span className="flex items-baseline gap-2 text-ui text-fg-body">
                  <span className="w-5 shrink-0 font-mono text-micro text-fg-faint tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 truncate">{step.title}</span>
                </span>
                <span className="pl-7 font-mono text-micro text-fg-faint tabular-nums">
                  {step.files.length} files · +{step.additions} −
                  {step.deletions}
                </span>
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
