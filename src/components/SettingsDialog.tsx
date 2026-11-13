import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { clearArtifacts, describeError, invalidateCache } from "../lib/api";
import type { Config } from "../lib/types";
import { Button, MicroLabel } from "./ui";

type SettingsDialogProps = {
  open: boolean;
  config: Config | undefined;
  onClose: () => void;
};

export function SettingsDialog({ open, config, onClose }: SettingsDialogProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"cache" | "artifacts" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function refreshCache() {
    setBusy("cache");
    setError(null);
    setMessage(null);
    try {
      const result = await invalidateCache();
      setMessage(
        `Cleared ${result.cleared} cached response${result.cleared === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function clearStoredArtifacts() {
    setBusy("artifacts");
    setError(null);
    setMessage(null);
    try {
      const result = await clearArtifacts();
      await queryClient.invalidateQueries({ queryKey: ["pr-action"] });
      setMessage(
        `Cleared ${result.cleared} artifact${result.cleared === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  const claudeReady = (config?.actions.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-[6px] border border-line-strong bg-canvas"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-1 pl-4">
          <h2 id="settings-title" className="text-ui font-medium text-fg">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-[4px] text-fg-faint transition-colors hover:bg-surface hover:text-fg"
            aria-label="Close settings"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <section>
            <MicroLabel>Configuration</MicroLabel>
            <p className="mt-2 text-meta text-fg-muted">
              Repositories and Linear teams come from this file. Edit it and
              restart Triage to apply changes.
            </p>
            <p className="mt-2 rounded-[4px] border border-line bg-surface px-3 py-2 font-mono text-meta break-all text-fg-body select-all">
              {config?.configPath ?? "…"}
            </p>
            {config?.configError ? (
              <p className="mt-2 text-meta text-danger">{config.configError}</p>
            ) : null}
          </section>

          <section className="mt-6">
            <MicroLabel>Claude actions</MicroLabel>
            <p className="mt-2 text-meta text-fg-muted">
              {claudeReady ? (
                <span className="text-accent">Claude Code CLI found.</span>
              ) : (
                <span>
                  {config?.actionsReason ?? "Claude Code CLI not found."}
                </span>
              )}
            </p>
          </section>

          <section className="mt-6">
            <MicroLabel>Omnidiff</MicroLabel>
            <p className="mt-2 text-meta text-fg-muted">
              {config?.omnidiff.available ? (
                <span className="text-accent">
                  omnidiff CLI found. The comparison tab is available.
                </span>
              ) : (
                <span>
                  {config?.omnidiff.reason ?? "omnidiff CLI not found."} Install
                  it with brew install ivankovic/omnidiff/omnidiff.
                </span>
              )}
            </p>
          </section>

          <section className="mt-6">
            <MicroLabel>Repositories</MicroLabel>
            <div className="mt-2 rounded-[4px] border border-line">
              {(config?.repos ?? []).map((repo) => (
                <div
                  key={`${repo.owner}/${repo.name}`}
                  className="border-b border-line px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-3 text-meta">
                    <span className="truncate font-mono text-fg-body">
                      {repo.owner}/{repo.name}
                    </span>
                    <span className="text-fg-faint">
                      {repo.actions ? "Explain ready" : "Actions off"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void refreshCache()}
              disabled={busy !== null}
            >
              <RefreshCw
                className={`size-3.5 ${busy === "cache" ? "animate-spin" : ""}`}
                aria-hidden
              />
              Refresh data
            </Button>
            <Button
              variant="outline"
              onClick={() => void clearStoredArtifacts()}
              disabled={busy !== null}
            >
              <Trash2
                className={`size-3.5 ${busy === "artifacts" ? "animate-spin" : ""}`}
                aria-hidden
              />
              Clear artifacts
            </Button>
          </section>

          {message ? (
            <p className="mt-3 text-meta text-fg-faint">{message}</p>
          ) : null}
          {error ? <p className="mt-3 text-meta text-danger">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
