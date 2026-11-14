package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/review"
	"github.com/Raist90/triage/backend/internal/worktree"
)

var (
	// findingIDPattern keeps the path segment to the ids the server assigns.
	findingIDPattern = regexp.MustCompile(`^F[0-9]{1,3}$`)
	// applyMu serialises patch applies. Applies are rare, and a race between
	// two clicks on the same finding is worse than the contention.
	applyMu sync.Mutex
)

// handlePatchApply applies one finding's patch to the review worktree. The
// client sends a finding id only; the patch text never leaves the server.
func (s *Server) handlePatchApply(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, actionID, findingID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	number, action, tracked, ok := s.resolveAction(w, owner, repo, rawNumber, actionID)
	if !ok {
		return
	}
	if action.Kind != actions.KindReview {
		writeError(w, http.StatusBadRequest, codeBadRequest, "only review actions carry patches")
		return
	}
	if !findingIDPattern.MatchString(findingID) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid finding id")
		return
	}

	pr, err := s.prMetadata(r, owner, repo, number, false)
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	if pr.HeadSHA == "" {
		writeError(w, http.StatusBadGateway, codeGitHub, "GitHub did not report the head commit")
		return
	}

	// The allowlist is computed from the same cached diff the review was built
	// from, so a patch can only touch files this pull request changes.
	unified, err := s.loadDiff(r.Context(), owner, repo, number, false)
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	files := diff.Parse(unified)

	applyMu.Lock()
	defer applyMu.Unlock()

	artifact, found := s.artifacts.Get(tracked.Owner, tracked.Name, number, pr.HeadSHA, action.ID)
	if !found {
		if _, stale := s.artifacts.Latest(tracked.Owner, tracked.Name, number, action.ID); stale {
			writeError(w, http.StatusConflict, codeReviewStale, "This review is from an older commit. Re-run it.")
			return
		}
		writeError(w, http.StatusNotFound, codeNotFound, "review artifact not found")
		return
	}

	finding := findFinding(artifact, findingID)
	if finding == nil {
		writeError(w, http.StatusNotFound, codeNotFound, "finding not found")
		return
	}
	// Idempotent: the stored timestamp wins, nothing is applied twice.
	if finding.AppliedAt != nil {
		writeJSON(w, http.StatusOK, patchApplyResponse{OK: true, AppliedAt: *finding.AppliedAt, Worktree: artifact.Worktree})
		return
	}
	if finding.Patch == "" {
		writeError(w, http.StatusUnprocessableEntity, codePatchConflict, "This finding has no patch.")
		return
	}
	if info, statErr := os.Stat(artifact.Worktree); artifact.Worktree == "" || statErr != nil || !info.IsDir() {
		writeError(w, http.StatusConflict, codeWorktreeMissing, "The worktree is gone. Re-run the review.")
		return
	}

	if err := review.ApplyPatch(r.Context(), artifact.Worktree, finding.Patch, files); err != nil {
		switch {
		case errors.Is(err, review.ErrPatchConflict):
			writeError(w, http.StatusUnprocessableEntity, codePatchConflict, "The patch no longer applies. Re-run the review.")
		case errors.Is(err, review.ErrPatchRejected):
			writeError(w, http.StatusUnprocessableEntity, codePatchConflict, "This finding has no applicable patch.")
		default:
			s.logger.Error("patch apply failed", "err", err)
			writeError(w, http.StatusInternalServerError, codeInternal, "Applying the patch failed")
		}
		return
	}

	now := time.Now().UTC()
	updated, err := s.artifacts.Update(tracked.Owner, tracked.Name, number, artifact.SHA, action.ID, func(candidate *actions.Artifact) error {
		record := findFinding(candidate, findingID)
		if record == nil {
			return actions.ErrNotFound
		}
		if record.AppliedAt == nil {
			record.AppliedAt = &now
		}
		return nil
	})
	if err != nil {
		// The patch is on disk but the record is not. Say so instead of
		// pretending the retry will be a no-op.
		s.logger.Error("recording the applied patch failed", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "The patch applied but could not be recorded")
		return
	}

	appliedAt := now
	if stored := findFinding(updated, findingID); stored != nil && stored.AppliedAt != nil {
		appliedAt = *stored.AppliedAt
	}
	writeJSON(w, http.StatusOK, patchApplyResponse{OK: true, AppliedAt: appliedAt, Worktree: updated.Worktree})
}

func findFinding(artifact *actions.Artifact, id string) *review.Finding {
	if artifact == nil || artifact.Review == nil {
		return nil
	}
	for index := range artifact.Review.Findings {
		if artifact.Review.Findings[index].ID == id {
			return &artifact.Review.Findings[index]
		}
	}
	return nil
}

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
