package actions

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/review"
)

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

// Available reports whether the claude CLI was found at startup.
func (r *Runner) Available() bool { return r.claudePath != "" }

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

	key := JobKey(req.Owner, req.Name, req.Number, req.ActionID)
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

// JobKey is the stable registry key for one PR action.
func JobKey(owner, name string, number int, actionID string) string {
	return fmt.Sprintf("%s/%s#%d:%s", owner, name, number, actionID)
}
