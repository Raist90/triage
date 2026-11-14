package actions

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/diff"
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

	// Error codes shared with the HTTP envelope and the webview.
	CodeClaudeUnavailable = "claude_unavailable"
	CodeRepoNotConfigured = "repo_not_configured"
	CodeDiffUnavailable   = "diff_unavailable"
	CodeActionFailed      = "action_failed"
	CodeActionTimeout     = "action_timeout"
	CodeActionCanceled    = "action_canceled"
	CodeReviewInvalid     = "review_invalid"
)

// Action kinds. The registry sets these; an empty kind means explain, the
// original diff-only action.
const (
	KindExplain = "explain"
	KindReview  = "review"
)

// Job statuses.
const (
	StatusQueued     = "queued"
	StatusPreparing  = "preparing"
	StatusRunning    = "running"
	StatusValidating = "validating"
	StatusDone       = "done"
	StatusFailed     = "failed"
	StatusCanceled   = "canceled"
)

// Error is a classified runner failure. Message is safe for the webview.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func errorf(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// CodeOf extracts the safe code and message from a runner error.
func CodeOf(err error) (string, string) {
	var actionErr *Error
	if errors.As(err, &actionErr) {
		return actionErr.Code, actionErr.Message
	}
	return CodeActionFailed, "Claude action failed"
}

// ErrNoHead means the pull request metadata carried no head SHA.
var ErrNoHead = &Error{Code: CodeDiffUnavailable, Message: "Could not resolve the pull request head"}

// Job is the public status shape.
type Job struct {
	Key       string    `json:"-"`
	ActionID  string    `json:"action"`
	Repo      string    `json:"repo,omitempty"`
	Number    int       `json:"number,omitempty"`
	SHA       string    `json:"sha"`
	Status    string    `json:"status"`
	StartedAt time.Time `json:"startedAt"`
	Error     string    `json:"error,omitempty"`
}

// Prepared is what a review needs before the model can run: a checked-out PR
// head plus the bounded prompt input and the parsed diff files.
type Prepared struct {
	WorkDir string
	Input   review.Input
	Files   []diff.File
}

// Request starts one action for one PR.
type Request struct {
	Owner         string
	Name          string
	Number        int
	ActionID      string
	SHA           string
	BaseBranch    string
	PRTitle       string
	PRDescription string
	Branch        string
	Diff          []byte
	Kind          string
	// Prepare runs inside the job goroutine after the preparing status, never
	// in Start. Explain has none: its diff is already in Diff.
	Prepare func(ctx context.Context) (Prepared, error)
	// Cleanup runs when the job fails or is canceled, on a fresh context. It
	// removes the worktree so a failed review leaves nothing behind.
	Cleanup func(ctx context.Context)
}

// StartResult is the outcome of Start.
type StartResult struct {
	Job            Job
	Artifact       *Artifact
	AlreadyRunning bool
}

// Event is one SSE payload.
type Event struct {
	Type     string
	Status   string
	Text     string
	Artifact *Artifact
	Code     string
	Message  string
}

type job struct {
	mu       sync.Mutex
	info     Job
	text     strings.Builder
	subs     map[chan Event]struct{}
	cancel   context.CancelFunc
	done     chan struct{}
	artifact *Artifact
	code     string
}

// Runner owns the child processes and the job registry.
type Runner struct {
	claudePath string
	actions    map[string]config.Action
	store      *Store
	logger     *slog.Logger

	startMu sync.Mutex
	mu      sync.Mutex
	jobs    map[string]*job

	rootCtx    context.Context
	rootCancel context.CancelFunc
	wg         sync.WaitGroup
}

// New builds a runner. claudePath is empty when the CLI is missing.
func New(cfg config.ActionsConfig, store *Store, claudePath string, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	actions := make(map[string]config.Action, len(cfg.Items))
	for _, action := range cfg.Items {
		actions[action.ID] = action
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Runner{
		claudePath: claudePath,
		actions:    actions,
		store:      store,
		logger:     logger,
		jobs:       map[string]*job{},
		rootCtx:    ctx,
		rootCancel: cancel,
	}
}

// Actions returns the configured action IDs.
func (r *Runner) Actions() []config.Action {
	out := make([]config.Action, 0, len(r.actions))
	for _, action := range r.actions {
		out = append(out, action)
	}
	return out
}

// Available reports whether the claude CLI was found at startup.
func (r *Runner) Available() bool { return r.claudePath != "" }

// Store exposes the artifact store.
func (r *Runner) Store() *Store { return r.store }

// Start spawns one job. A running job for the same PR and action is returned
// unchanged.
func (r *Runner) Start(req Request) (StartResult, error) {
	action, ok := r.actions[req.ActionID]
	if !ok {
		return StartResult{}, errorf(CodeActionFailed, "Unknown action")
	}
	if r.claudePath == "" {
		return StartResult{}, errorf(CodeClaudeUnavailable, "Claude Code CLI not found")
	}
	if req.SHA == "" {
		return StartResult{}, errorf(CodeDiffUnavailable, "Could not resolve the pull request head")
	}
	if req.Prepare == nil && len(req.Diff) == 0 {
		return StartResult{}, errorf(CodeDiffUnavailable, "This pull request has no changes to explain")
	}

	key := jobKey(req.Owner, req.Name, req.Number, req.ActionID)
	if existing, ok := r.lookup(key); ok {
		if liveStatus(existing.Status()) {
			return StartResult{Job: existing.Info(), AlreadyRunning: true}, nil
		}
	}

	r.startMu.Lock()
	defer r.startMu.Unlock()

	if existing, ok := r.lookup(key); ok {
		if liveStatus(existing.Status()) {
			return StartResult{Job: existing.Info(), AlreadyRunning: true}, nil
		}
	}

	if artifact, ok := r.store.Get(req.Owner, req.Name, req.Number, req.SHA, req.ActionID); ok {
		if artifact.Model == action.Model && artifact.PromptVersion == PromptVersionFor(action) {
			return StartResult{
				Job:      Job{Key: key, ActionID: req.ActionID, Repo: req.Owner + "/" + req.Name, Number: req.Number, SHA: req.SHA, Status: StatusDone, StartedAt: artifact.CreatedAt},
				Artifact: artifact,
			}, nil
		}
	}

	// Explain is fully prepared at Start, so a broken template fails the request.
	// Review renders after Prepare, inside the job, because its input comes from
	// the worktree.
	var prompt string
	if req.Prepare == nil {
		rendered, err := RenderPrompt(action.Prompt, PromptData{
			Repo:        req.Owner + "/" + req.Name,
			Number:      req.Number,
			Title:       req.PRTitle,
			Branch:      req.Branch,
			BaseBranch:  req.BaseBranch,
			Description: req.PRDescription,
		}.WithDiff(req.Diff))
		if err != nil {
			r.logger.Error("prompt render failed", "err", err)
			return StartResult{}, errorf(CodeActionFailed, "Action prompt is misconfigured")
		}
		prompt = rendered
	}

	created := &job{
		info: Job{
			Key:       key,
			ActionID:  req.ActionID,
			Repo:      req.Owner + "/" + req.Name,
			Number:    req.Number,
			SHA:       req.SHA,
			Status:    StatusQueued,
			StartedAt: time.Now().UTC(),
		},
		subs: map[chan Event]struct{}{},
		done: make(chan struct{}),
	}
	r.mu.Lock()
	r.jobs[key] = created
	r.mu.Unlock()

	r.wg.Add(1)
	go r.run(created, key, action, prompt, req)
	return StartResult{Job: created.Info()}, nil
}

// Status returns a job snapshot.
func (r *Runner) Status(key string) (Job, bool) {
	value, ok := r.lookup(key)
	if !ok {
		return Job{}, false
	}
	return value.Info(), true
}

// Artifact returns the finished artifact for a job, if any.
func (r *Runner) Artifact(key string) (*Artifact, bool) {
	value, ok := r.lookup(key)
	if !ok {
		return nil, false
	}
	value.mu.Lock()
	defer value.mu.Unlock()
	if value.artifact == nil {
		return nil, false
	}
	artifact := *value.artifact
	return &artifact, true
}

// CurrentSHA returns the SHA a job is working on.
func (r *Runner) CurrentSHA(key string) (string, bool) {
	value, ok := r.lookup(key)
	if !ok {
		return "", false
	}
	return value.Info().SHA, true
}

// Cancel kills a running job. It reports whether a live job existed.
func (r *Runner) Cancel(key string) bool {
	value, ok := r.lookup(key)
	if !ok {
		return false
	}
	value.mu.Lock()
	cancel := value.cancel
	status := value.info.Status
	value.mu.Unlock()
	if cancel == nil || !liveStatus(status) {
		return false
	}
	cancel()
	return true
}

// Subscribe attaches to a live job. The returned channel is pre-filled with a
// status event and the text produced so far, so a late subscriber catches up.
// The channel is never closed: callers stop on the done channel or a terminal
// event.
func (r *Runner) Subscribe(key string) (<-chan Event, <-chan struct{}, func(), bool) {
	value, ok := r.lookup(key)
	if !ok {
		return nil, nil, nil, false
	}
	ch := make(chan Event, 256)
	value.mu.Lock()
	value.subs[ch] = struct{}{}
	status := value.info.Status
	text := value.text.String()
	artifact := value.artifact
	code := value.code
	message := value.info.Error
	value.mu.Unlock()

	ch <- Event{Type: "status", Status: status}
	if text != "" {
		ch <- Event{Type: "delta", Text: text}
	}
	switch status {
	case StatusDone:
		ch <- Event{Type: "done", Artifact: artifact}
	case StatusFailed:
		ch <- Event{Type: "error", Code: code, Message: message}
	case StatusCanceled:
		ch <- Event{Type: "error", Code: CodeActionCanceled, Message: "Action canceled"}
	}

	unsubscribe := func() {
		value.mu.Lock()
		delete(value.subs, ch)
		value.mu.Unlock()
	}
	return ch, value.done, unsubscribe, true
}

// Shutdown cancels every job and waits for children to exit.
func (r *Runner) Shutdown() {
	r.rootCancel()
	r.wg.Wait()
}

// ClearArtifacts removes ~/.triage/artifacts contents.
func (r *Runner) ClearArtifacts() (int, error) {
	return r.store.Clear()
}

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
		parsed = review.Sanitize(parsed, prepared.Files)
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

func (r *Runner) lookup(key string) (*job, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	value, ok := r.jobs[key]
	return value, ok
}

// PromptVersionFor is the artifact prompt version for one action's kind. A
// review prompt edit must invalidate old reviews without invalidating explain.
func PromptVersionFor(action config.Action) string {
	kind := action.Kind
	if kind == "" {
		kind = KindExplain
	}
	if kind == KindReview {
		return review.PromptVersion
	}
	return PromptVersion
}

// liveStatus reports whether a job still owns its key: a second Start must
// dedupe against it and Cancel must be able to stop it.
func liveStatus(status string) bool {
	switch status {
	case StatusQueued, StatusPreparing, StatusRunning, StatusValidating:
		return true
	default:
		return false
	}
}

func jobKey(owner, name string, number int, actionID string) string {
	return fmt.Sprintf("%s/%s#%d:%s", owner, name, number, actionID)
}

// JobKey is the stable registry key for one PR action.
func JobKey(owner, name string, number int, actionID string) string {
	return jobKey(owner, name, number, actionID)
}

func (j *job) Info() Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.info
}

func (j *job) Status() string {
	return j.Info().Status
}

func (j *job) setStatus(status string) {
	j.mu.Lock()
	j.info.Status = status
	j.mu.Unlock()
	j.emit(Event{Type: "status", Status: status})
}

func (j *job) setCancel(cancel context.CancelFunc) {
	j.mu.Lock()
	j.cancel = cancel
	j.mu.Unlock()
}

func (j *job) appendText(text string) {
	j.mu.Lock()
	j.text.WriteString(text)
	j.mu.Unlock()
}

func (j *job) currentText() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.text.String()
}

func (j *job) emit(event Event) {
	j.mu.Lock()
	subs := copySubs(j.subs)
	j.mu.Unlock()
	for _, sub := range subs {
		select {
		case sub <- event:
		default:
		}
	}
}

func (j *job) closeDone() {
	select {
	case <-j.done:
	default:
		close(j.done)
	}
}

func copySubs(subs map[chan Event]struct{}) []chan Event {
	out := make([]chan Event, 0, len(subs))
	for sub := range subs {
		out = append(out, sub)
	}
	return out
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
