package api

import (
	"context"
	"errors"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/review"
	"github.com/Raist90/triage/backend/internal/worktree"
)

// prepareReview builds the worktree and the bounded prompt input one review
// needs. It runs inside the job goroutine, never in the POST handler: a cold
// fetch can take half a minute and the request returns 202 first.
//
// unified is the pull request's REST diff, already loaded and cached by the
// handler. It is never refetched here, so the artifact SHA and the diff the
// model reviews are the same commit.
func (s *Server) prepareReview(ctx context.Context, source config.Repo, number int, pr github.PR, unified []byte) (actions.Prepared, error) {
	if s.worktrees == nil {
		return actions.Prepared{}, &actions.Error{Code: worktree.CodeWorktreeFailed, Message: "The worktree manager is not configured"}
	}
	info, err := s.worktrees.Ensure(ctx, source, number, pr.HeadSHA, pr.BaseBranch)
	if err != nil {
		return actions.Prepared{}, worktreeActionError(err)
	}

	// sem is an optimisation. A miss degrades to the raw diff, never to no
	// review.
	semantic, covered, _ := review.Semantic(ctx, info.Dir, info.BaseSHA, pr.HeadSHA)
	guidelines := review.Guidelines(ctx, info.Dir)

	files := diff.Parse(unified)
	for index := range files {
		files[index].Kinds = diff.Kinds(files[index].Path)
	}

	meta := review.Meta{
		Repo:        source.Owner + "/" + source.Name,
		Number:      number,
		Title:       pr.Title,
		Branch:      pr.Branch,
		BaseBranch:  pr.BaseBranch,
		BaseSHA:     info.BaseSHA,
		Description: pr.Description,
	}
	input := review.BuildInput(meta, semantic, covered, guidelines, files, unified)
	return actions.Prepared{WorkDir: info.Dir, Input: input, Files: files}, nil
}

// worktreeActionError maps a worktree failure onto the action envelope, keeping
// the code the webview already knows (repo_path_missing, worktree_failed, ...).
func worktreeActionError(err error) error {
	var worktreeErr *worktree.Error
	if errors.As(err, &worktreeErr) {
		return &actions.Error{Code: worktreeErr.Code, Message: worktreeErr.Message}
	}
	return &actions.Error{Code: worktree.CodeWorktreeFailed, Message: "Preparing the worktree failed"}
}
