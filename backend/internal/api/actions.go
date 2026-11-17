package api

import (
	"context"
	"net/http"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/worktree"
)

type actionInput struct {
	PRPath
	ActionID string `path:"actionID" doc:"Action id from GET /config"`
}

// runAction serves POST /pr/{owner}/{repo}/{n}/actions/{actionID}. It returns
// the current artifact when there is one, otherwise 202 with the started job.
func (s *Server) runAction(ctx context.Context, in *actionInput) (*actionRunOutput, error) {
	action, tracked, err := s.resolveAction(in)
	if err != nil {
		return nil, err
	}

	// A run is user-initiated: bypass the TTLs so the artifact is keyed by the
	// real head SHA and the diff matches it.
	pr, err := s.prMetadata(ctx, in.Owner, in.Repo, in.Number, true)
	if err != nil {
		return nil, s.providerError(err)
	}
	if pr.HeadSHA == "" {
		return nil, s.actionError(actions.ErrNoHead)
	}

	// Second click with a current artifact: no fetch, no spawn.
	if artifact, found := s.artifacts.Get(in.Owner, in.Repo, in.Number, pr.HeadSHA, action.ID); found &&
		artifact.Model == action.Model && artifact.PromptVersion == actions.PromptVersionFor(action) {
		return &actionRunOutput{Status: http.StatusOK, Body: actionResponse{Artifact: artifact}}, nil
	}

	unified, err := s.loadDiff(ctx, in.Owner, in.Repo, in.Number, pr.HeadSHA, true)
	if err != nil {
		return nil, s.providerError(err)
	}

	request := actions.Request{
		Owner:         tracked.Owner,
		Name:          tracked.Name,
		Number:        in.Number,
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
			return s.prepareReview(ctx, tracked, in.Number, pr, unified)
		}
		if s.worktrees != nil {
			request.Cleanup = func(ctx context.Context) {
				if err := s.worktrees.Remove(ctx, tracked, in.Number); err != nil {
					s.logger.Warn("worktree cleanup failed", "repo", tracked.Owner+"/"+tracked.Name, "number", in.Number, "err", err)
				}
			}
		}
	}

	result, err := s.runner.Start(request)
	if err != nil {
		return nil, s.actionError(err)
	}

	response := actionResponse{Job: &result.Job}
	if result.Artifact != nil {
		response.Artifact = result.Artifact
		return &actionRunOutput{Status: http.StatusOK, Body: response}, nil
	}
	return &actionRunOutput{Status: http.StatusAccepted, Body: response}, nil
}

// getAction serves GET /pr/{owner}/{repo}/{n}/actions/{actionID}.
func (s *Server) getAction(ctx context.Context, in *actionInput) (*actionOutput, error) {
	action, tracked, err := s.resolveAction(in)
	if err != nil {
		return nil, err
	}

	key := actions.JobKey(tracked.Owner, tracked.Name, in.Number, action.ID)
	response := actionResponse{}
	if job, found := s.runner.Status(key); found {
		response.Job = &job
	}

	// The PR's current head is authoritative for staleness. Fall back to the
	// job SHA when GitHub metadata is unavailable.
	sha := ""
	if pr, err := s.prMetadata(ctx, in.Owner, in.Repo, in.Number, false); err == nil {
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
		if artifact, found := s.artifacts.Get(tracked.Owner, tracked.Name, in.Number, sha, action.ID); found {
			response.Artifact = artifact
		}
	}
	if response.Artifact == nil {
		if artifact, found := s.artifacts.Latest(tracked.Owner, tracked.Name, in.Number, action.ID); found {
			response.Artifact = artifact
			response.Stale = artifact.SHA != sha
		}
	}

	if response.Job == nil && response.Artifact == nil {
		return nil, errorf(http.StatusNotFound, codeNotFound, "action has not run")
	}
	return &actionOutput{Body: response}, nil
}

// cancelAction serves POST .../actions/{actionID}/cancel.
func (s *Server) cancelAction(_ context.Context, in *actionInput) (*actionOutput, error) {
	action, tracked, err := s.resolveAction(in)
	if err != nil {
		return nil, err
	}
	key := actions.JobKey(tracked.Owner, tracked.Name, in.Number, action.ID)
	s.runner.Cancel(key)
	job, found := s.runner.Status(key)
	if !found {
		return nil, errorf(http.StatusNotFound, codeNotFound, "action has not run")
	}
	return &actionOutput{Body: actionResponse{Job: &job}}, nil
}

// resolveAction validates the action id and returns the action plus the tracked
// repo.
func (s *Server) resolveAction(in *actionInput) (config.Action, config.Repo, error) {
	if !actions.ValidActionID(in.ActionID) {
		return config.Action{}, config.Repo{}, errorf(http.StatusBadRequest, codeBadRequest, "invalid action")
	}
	if s.runner == nil || !s.runner.Available() {
		return config.Action{}, config.Repo{}, errorf(http.StatusServiceUnavailable, actions.CodeClaudeUnavailable, "Claude Code CLI not found")
	}
	action, ok := s.findAction(in.ActionID)
	if !ok {
		return config.Action{}, config.Repo{}, errorf(http.StatusNotFound, codeNotFound, "unknown action")
	}
	tracked, ok := s.findRepo(in.Owner, in.Repo)
	if !ok {
		return config.Action{}, config.Repo{}, errorf(http.StatusBadRequest, actions.CodeRepoNotConfigured, "repository is not tracked")
	}
	return action, tracked, nil
}

func (s *Server) actionError(err error) error {
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
	return errorf(status, code, message)
}

// prMetadata reads PR detail through the same cache as the detail route.
func (s *Server) prMetadata(ctx context.Context, owner, repo string, number int, refresh bool) (github.PR, error) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}

	var pr github.PR
	err := s.loadCached(prDetailRoute, vars, s.cfg.Cache.GraphQL, refresh, &pr, func() error {
		fetched, err := s.github.GetPR(ctx, owner, repo, number)
		if err != nil {
			return err
		}
		pr = fetched
		return nil
	})
	return pr, err
}
