package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/worktree"
)

// configView derives what the webview may know: no models, no prompts.
func (s *Server) configView(ctx context.Context) configResponse {
	view := configResponse{
		User:        s.cfg.User,
		Tabs:        s.cfg.Tabs,
		Linear:      s.cfg.Linear,
		Actions:     []actionView{},
		Repos:       make([]repoView, 0, len(s.cfg.Repos)),
		ConfigPath:  s.cfg.Source,
		ConfigError: s.cfg.Problem,
	}

	available := s.runner != nil && s.runner.Available()
	if available {
		for _, action := range s.cfg.Actions.Items {
			view.Actions = append(view.Actions, actionView{ID: action.ID, Label: action.Label, Kind: action.Kind})
		}
	} else {
		view.ActionsReason = "Claude Code CLI not found"
	}

	// Explain needs only a tracked repo and the CLI. Review also needs a local
	// checkout, so its readiness is per repo.
	for _, repo := range s.cfg.Repos {
		view.Repos = append(view.Repos, repoView{
			Owner:   repo.Owner,
			Name:    repo.Name,
			Actions: available,
			Review:  repoReview(ctx, s.worktrees, repo, available),
		})
	}
	return view
}

// repoReview reports whether automatic review can run for one repo: the CLI must
// be present and the configured local path must be a git repository.
func repoReview(ctx context.Context, manager *worktree.Manager, repo config.Repo, claudeAvailable bool) repoReviewView {
	if repo.Path == "" {
		return repoReviewView{Available: false, Reason: "No local path configured"}
	}
	if manager != nil {
		if ok, reason := worktree.Status(ctx, repo.Path); !ok {
			return repoReviewView{Available: false, Reason: reason}
		}
	}
	return repoReviewView{Available: claudeAvailable}
}

func (s *Server) findRepo(owner, name string) (config.Repo, bool) {
	for _, repo := range s.cfg.Repos {
		if equalFold(repo.Owner, owner) && equalFold(repo.Name, name) {
			return repo, true
		}
	}
	return config.Repo{}, false
}

func (s *Server) findAction(actionID string) (config.Action, bool) {
	if s.runner == nil || !s.runner.Available() {
		return config.Action{}, false
	}
	for _, action := range s.cfg.Actions.Items {
		if action.ID == actionID {
			return action, true
		}
	}
	return config.Action{}, false
}

// handleAction serves POST/GET /pr/{owner}/{repo}/{n}/actions/{actionID}.
func (s *Server) handleAction(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, actionID string) {
	switch r.Method {
	case http.MethodPost:
		s.handleActionRun(w, r, owner, repo, rawNumber, actionID)
	case http.MethodGet:
		s.handleActionStatus(w, r, owner, repo, rawNumber, actionID)
	default:
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET and POST are allowed")
	}
}

func (s *Server) handleActionRun(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, actionID string) {
	number, action, tracked, ok := s.resolveAction(w, owner, repo, rawNumber, actionID)
	if !ok {
		return
	}

	// A run is user-initiated: bypass the TTLs so the artifact is keyed by the
	// real head SHA and the diff matches it.
	pr, err := s.prMetadata(r, owner, repo, number, true)
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	if pr.HeadSHA == "" {
		s.writeActionError(w, actions.ErrNoHead)
		return
	}

	// Second click with a current artifact: no fetch, no spawn.
	if artifact, found := s.artifacts.Get(owner, repo, number, pr.HeadSHA, action.ID); found &&
		artifact.Model == action.Model && artifact.PromptVersion == actions.PromptVersionFor(action) {
		writeJSON(w, http.StatusOK, actionResponse{Artifact: artifact})
		return
	}

	unified, err := s.loadDiff(r.Context(), owner, repo, number, true)
	if err != nil {
		s.writeProviderError(w, err)
		return
	}

	request := actions.Request{
		Owner:         tracked.Owner,
		Name:          tracked.Name,
		Number:        number,
		ActionID:      action.ID,
		SHA:           pr.HeadSHA,
		BaseBranch:    pr.BaseBranch,
		PRTitle:       pr.Title,
		PRDescription: pr.Description,
		Branch:        pr.Branch,
		Diff:          unified,
	}
	if action.Kind == actions.KindReview {
		request.Kind = action.Kind
		request.Prepare = func(ctx context.Context) (actions.Prepared, error) {
			return s.prepareReview(ctx, tracked, number, pr, unified)
		}
		if s.worktrees != nil {
			request.Cleanup = func(ctx context.Context) {
				if err := s.worktrees.Remove(ctx, tracked, number); err != nil {
					s.logger.Warn("worktree cleanup failed", "repo", tracked.Owner+"/"+tracked.Name, "number", number, "err", err)
				}
			}
		}
	}

	result, err := s.runner.Start(request)
	if err != nil {
		s.writeActionError(w, err)
		return
	}

	response := actionResponse{Job: &result.Job}
	if result.Artifact != nil {
		response.Artifact = result.Artifact
		writeJSON(w, http.StatusOK, response)
		return
	}
	writeJSON(w, http.StatusAccepted, response)
}

func (s *Server) handleActionStatus(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, actionID string) {
	number, action, tracked, ok := s.resolveAction(w, owner, repo, rawNumber, actionID)
	if !ok {
		return
	}

	key := actions.JobKey(tracked.Owner, tracked.Name, number, action.ID)
	response := actionResponse{}
	if job, found := s.runner.Status(key); found {
		response.Job = &job
	}

	// The PR's current head is authoritative for staleness. Fall back to the
	// job SHA when GitHub metadata is unavailable.
	sha := ""
	if pr, err := s.prMetadata(r, owner, repo, number, false); err == nil {
		sha = pr.HeadSHA
	}
	if sha == "" && response.Job != nil {
		sha = response.Job.SHA
	}

	if response.Job != nil {
		if artifact, found := s.runner.Artifact(key); found {
			response.Artifact = artifact
			response.Stale = artifact.SHA != sha
		}
	}
	if response.Artifact == nil && sha != "" {
		if artifact, found := s.artifacts.Get(tracked.Owner, tracked.Name, number, sha, action.ID); found {
			response.Artifact = artifact
		}
	}
	if response.Artifact == nil {
		if artifact, found := s.artifacts.Latest(tracked.Owner, tracked.Name, number, action.ID); found {
			response.Artifact = artifact
			response.Stale = artifact.SHA != sha
		}
	}

	if response.Job == nil && response.Artifact == nil {
		writeError(w, http.StatusNotFound, codeNotFound, "action has not run")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleActionCancel(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, actionID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	number, action, tracked, ok := s.resolveAction(w, owner, repo, rawNumber, actionID)
	if !ok {
		return
	}
	key := actions.JobKey(tracked.Owner, tracked.Name, number, action.ID)
	s.runner.Cancel(key)
	job, found := s.runner.Status(key)
	if !found {
		writeError(w, http.StatusNotFound, codeNotFound, "action has not run")
		return
	}
	writeJSON(w, http.StatusOK, actionResponse{Job: &job})
}

// handleActionStream serves GET .../actions/{actionID}/stream as SSE. The
// response is JSON lines prefixed with `data: `, one event per blank line.
func (s *Server) handleActionStream(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, actionID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
		return
	}
	number, action, tracked, ok := s.resolveAction(w, owner, repo, rawNumber, actionID)
	if !ok {
		return
	}

	key := actions.JobKey(tracked.Owner, tracked.Name, number, action.ID)
	events, done, unsubscribe, found := s.runner.Subscribe(key)
	if !found {
		writeError(w, http.StatusNotFound, codeNotFound, "action is not running")
		return
	}
	defer unsubscribe()

	controller := http.NewResponseController(w)
	// A job may run for five minutes; the server-wide WriteTimeout must not
	// cut the stream short.
	_ = controller.SetWriteDeadline(time.Time{})

	header := w.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_ = controller.Flush()

	writeEvent := func(event actions.Event) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, eventPayload(event)); err != nil {
			return false
		}
		return controller.Flush() == nil
	}

	for {
		select {
		case event := <-events:
			if !writeEvent(event) {
				return
			}
			if terminalEvent(event) {
				return
			}
		case <-done:
			for {
				select {
				case event := <-events:
					if !writeEvent(event) {
						return
					}
				default:
					return
				}
			}
		case <-r.Context().Done():
			return
		}
	}
}

func terminalEvent(event actions.Event) bool {
	return event.Type == "done" || event.Type == "error"
}

func eventPayload(event actions.Event) string {
	var payload any
	switch event.Type {
	case "status":
		payload = struct {
			Status string `json:"status"`
		}{Status: event.Status}
	case "delta":
		payload = struct {
			Text string `json:"text"`
		}{Text: event.Text}
	case "done":
		payload = struct {
			Artifact *actions.Artifact `json:"artifact"`
		}{Artifact: event.Artifact}
	default:
		payload = struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}{Code: event.Code, Message: event.Message}
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// resolveAction validates the route and returns the action plus the tracked
// repo. It writes the error envelope itself when it returns false.
func (s *Server) resolveAction(w http.ResponseWriter, owner, repo, rawNumber, actionID string) (int, config.Action, config.Repo, bool) {
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return 0, config.Action{}, config.Repo{}, false
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return 0, config.Action{}, config.Repo{}, false
	}
	if !actions.ValidActionID(actionID) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid action")
		return 0, config.Action{}, config.Repo{}, false
	}
	if s.runner == nil || !s.runner.Available() {
		writeError(w, http.StatusServiceUnavailable, actions.CodeClaudeUnavailable, "Claude Code CLI not found")
		return 0, config.Action{}, config.Repo{}, false
	}
	action, ok := s.findAction(actionID)
	if !ok {
		writeError(w, http.StatusNotFound, codeNotFound, "unknown action")
		return 0, config.Action{}, config.Repo{}, false
	}
	tracked, ok := s.findRepo(owner, repo)
	if !ok {
		writeError(w, http.StatusBadRequest, actions.CodeRepoNotConfigured, "repository is not tracked")
		return 0, config.Action{}, config.Repo{}, false
	}
	return number, action, tracked, true
}

func (s *Server) writeActionError(w http.ResponseWriter, err error) {
	code, message := actions.CodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case actions.CodeClaudeUnavailable:
		status = http.StatusServiceUnavailable
	case actions.CodeRepoNotConfigured:
		status = http.StatusBadRequest
	case worktree.CodeRepoPathMissing, worktree.CodeRepoPathInvalid:
		status = http.StatusBadRequest
	case actions.CodeDiffUnavailable, worktree.CodeWorktreeFailed, actions.CodeReviewInvalid:
		status = http.StatusBadGateway
	case actions.CodeActionTimeout:
		status = http.StatusGatewayTimeout
	}
	if status >= 500 {
		s.logger.Error("action request failed", "code", code, "message", message)
	}
	writeError(w, status, code, message)
}

// prMetadata reads PR detail through the same cache as the detail route.
func (s *Server) prMetadata(r *http.Request, owner, repo string, number int, refresh bool) (github.PR, error) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}

	var pr github.PR
	err := s.loadCached(prDetailRoute, vars, s.cfg.Cache.GraphQL, refresh, &pr, func() error {
		fetched, err := s.github.GetPR(r.Context(), owner, repo, number)
		if err != nil {
			return err
		}
		pr = fetched
		return nil
	})
	return pr, err
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
