package actions

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/review"
)

const (
	maxStderr    = 4 << 10
	maxLineBytes = 4 << 20

	// cleanupTimeout bounds worktree removal after a failure. It runs on a
	// fresh context because the job context may already be canceled.
	cleanupTimeout = 30 * time.Second
	// defaultTimeout is used when an action carries no timeout of its own.
	defaultTimeout = 5 * time.Minute
)

func (r *Runner) run(j *job, key string, action config.Action, prompt string, req Request) {
	defer r.wg.Done()

	kind := action.Kind
	if kind == "" {
		kind = req.Kind
	}
	if kind == "" {
		kind = KindExplain
	}

	// Preparation and the model run get separate deadlines: a cold fetch plus a
	// sem index must not eat the action's own budget. Both inherit the runner's
	// root context, so shutdown and cancel reach every child.
	ctx, cancel := context.WithCancel(r.rootCtx)
	defer cancel()
	j.setCancel(cancel)

	kept := false
	defer func() {
		if kept || req.Cleanup == nil {
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), cleanupTimeout)
		defer cleanupCancel()
		req.Cleanup(cleanupCtx)
	}()

	if kind == KindReview && len(action.Tools) == 0 {
		r.finishFailed(ctx, j, key, CodeReviewInvalid, "Review tools are not configured")
		return
	}

	var prepared Prepared
	if req.Prepare != nil {
		j.setStatus(StatusPreparing)
		value, err := req.Prepare(ctx)
		if err != nil {
			code, message := CodeOf(err)
			r.finishFailed(ctx, j, key, code, message)
			return
		}
		prepared = value
		r.logger.Info("review prepared", "key", key, "workdir", prepared.WorkDir, "files", len(prepared.Files))

		rendered, err := review.Render(action.Prompt, prepared.Input)
		if err != nil {
			r.logger.Error("review prompt render failed", "err", err)
			r.finishFailed(ctx, j, key, CodeActionFailed, "Action prompt is misconfigured")
			return
		}
		prompt = rendered
	}

	timeout := action.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	runCtx, runCancel := context.WithTimeout(ctx, timeout)
	defer runCancel()

	j.setStatus(StatusRunning)

	args := []string{
		"-p",
		"--model", action.Model,
		"--output-format", "stream-json",
		"--verbose",
		"--no-session-persistence",
	}
	if kind == KindReview {
		// Restricted, read-only. The worktree is the working directory and the
		// tools list is the whole filesystem surface. Never skip permissions.
		args = append(args,
			"--restricted",
			"--tools", strings.Join(action.Tools, ","),
			"--permission-mode", "dontAsk",
			"--json-schema", review.JSONSchema(),
			"--append-system-prompt", review.SystemPrompt,
		)
	} else {
		// Diff-only: no filesystem, no shell, no network tools.
		args = append(args,
			"--tools", "",
			"--append-system-prompt", SystemPrompt,
		)
	}
	if action.MaxBudgetUSD > 0 {
		args = append(args, "--max-budget-usd", strconv.FormatFloat(action.MaxBudgetUSD, 'f', 2, 64))
	}

	cmd := exec.CommandContext(runCtx, r.claudePath, args...)
	cmd.Stdin = strings.NewReader(prompt)
	cmd.SysProcAttr = processGroupAttr()
	cmd.Cancel = func() error { return killProcessGroup(cmd) }
	cmd.WaitDelay = 2 * time.Second
	if kind == KindReview {
		cmd.Dir = prepared.WorkDir
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		r.finishFailed(runCtx, j, key, CodeActionFailed, "Could not read Claude output")
		return
	}
	var stderr limitedBuffer
	stderr.limit = maxStderr
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		r.logger.Warn("claude start failed", "err", err)
		r.finishFailed(runCtx, j, key, CodeActionFailed, "Could not start Claude Code")
		return
	}

	var final *finalResult
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64<<10), maxLineBytes)
	for scanner.Scan() {
		update, err := parseStreamLine(scanner.Bytes())
		if err != nil {
			continue
		}
		// Review output is JSON: streaming it would only show noise.
		if update.text != "" && kind != KindReview {
			j.appendText(update.text)
			j.emit(Event{Type: "delta", Text: update.text})
		}
		if update.final != nil {
			final = update.final
		}
	}
	scanErr := scanner.Err()
	waitErr := cmd.Wait()

	switch {
	case errors.Is(runCtx.Err(), context.DeadlineExceeded):
		r.finishFailed(runCtx, j, key, CodeActionTimeout, fmt.Sprintf("Timed out after %s", timeout))
		return
	case errors.Is(ctx.Err(), context.Canceled):
		r.finishCanceled(j)
		return
	}

	if scanErr != nil {
		r.logger.Warn("claude stream read failed", "err", scanErr)
	}
	if final == nil || final.isError {
		message := "Claude Code failed"
		if trimmed := strings.TrimSpace(stderr.String()); trimmed != "" && waitErr != nil {
			message = shortenMessage(trimmed)
		}
		if final != nil && final.isError {
			message = "Claude Code reported an error"
		}
		r.finishFailed(ctx, j, key, CodeActionFailed, message)
		return
	}
	if waitErr != nil {
		// A result event is authoritative; the CLI sometimes exits non-zero
		// after reporting one. Keep the answer.
		r.logger.Warn("claude exited non-zero after a result event", "err", waitErr)
	}

	artifact := &Artifact{
		ActionID:      action.ID,
		Model:         action.Model,
		SHA:           j.Info().SHA,
		PromptVersion: PromptVersionFor(action),
		CreatedAt:     time.Now().UTC(),
		Usage:         final.usage,
	}
	if kind == KindReview {
		j.setStatus(StatusValidating)
		parsed, err := review.Parse(final.structured, final.markdown)
		if err != nil {
			r.logger.Warn("review output invalid", "err", err)
			r.finishFailed(ctx, j, key, CodeReviewInvalid, "The review did not return valid JSON")
			return
		}
		parsed = review.Sanitize(parsed, review.Grounding{
			Files:      prepared.Files,
			Guidelines: prepared.Guidelines,
		})
		parsed = review.ValidatePatches(ctx, prepared.WorkDir, parsed, prepared.Files)
		artifact.Review = &parsed
		artifact.Worktree = prepared.WorkDir
	} else {
		markdown := final.markdown
		if strings.TrimSpace(markdown) == "" {
			markdown = j.currentText()
		}
		artifact.Markdown = markdown
	}

	if err := r.store.Put(req.Owner, req.Name, j.Info().Number, *artifact); err != nil {
		r.logger.Warn("artifact write failed", "err", err)
	}

	// The worktree stays on success: patches need somewhere to land.
	kept = true
	j.mu.Lock()
	j.artifact = artifact
	j.info.Status = StatusDone
	subs := copySubs(j.subs)
	j.mu.Unlock()
	for _, sub := range subs {
		select {
		case sub <- Event{Type: "done", Artifact: artifact}:
		default:
		}
	}
	j.closeDone()
}

func (r *Runner) finishFailed(ctx context.Context, j *job, key, code, message string) {
	if errors.Is(ctx.Err(), context.Canceled) {
		r.finishCanceled(j)
		return
	}
	r.logger.Warn("action failed", "key", key, "code", code, "message", message)
	j.mu.Lock()
	j.info.Status = StatusFailed
	j.info.Error = message
	j.code = code
	subs := copySubs(j.subs)
	j.mu.Unlock()
	for _, sub := range subs {
		select {
		case sub <- Event{Type: "error", Code: code, Message: message}:
		default:
		}
	}
	j.closeDone()
}

func (r *Runner) finishCanceled(j *job) {
	j.mu.Lock()
	j.info.Status = StatusCanceled
	j.info.Error = "Action canceled"
	j.code = CodeActionCanceled
	subs := copySubs(j.subs)
	j.mu.Unlock()
	for _, sub := range subs {
		select {
		case sub <- Event{Type: "error", Code: CodeActionCanceled, Message: "Action canceled"}:
		default:
		}
	}
	j.closeDone()
}

// limitedBuffer keeps the first limit bytes, enough for a short provider error.
type limitedBuffer struct {
	data  []byte
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := b.limit - len(b.data)
	if remaining > 0 {
		if len(p) < remaining {
			remaining = len(p)
		}
		b.data = append(b.data, p[:remaining]...)
	}
	return len(p), nil
}

func (b *limitedBuffer) String() string { return string(b.data) }

func shortenMessage(value string) string {
	const limit = 240
	value = strings.Join(strings.Fields(value), " ")
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
