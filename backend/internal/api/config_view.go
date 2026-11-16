package api

import (
	"context"
	"strings"

	"github.com/Raist90/triage/backend/internal/config"
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
		if strings.EqualFold(repo.Owner, owner) && strings.EqualFold(repo.Name, name) {
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
