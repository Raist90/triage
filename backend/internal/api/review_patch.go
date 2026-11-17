package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/review"
)

// findingIDPattern keeps the path segment to the ids the server assigns.
var findingIDPattern = regexp.MustCompile(`^F[0-9]{1,3}$`)

type patchInput struct {
	PRPath
	ActionID  string `path:"actionID" doc:"Action id from GET /config"`
	FindingID string `path:"findingID" doc:"Finding id from the review artifact"`
}

// applyFindingPatch applies one finding's patch to the review worktree. The
// client sends a finding id only; the patch text never leaves the server.
func (s *Server) applyFindingPatch(ctx context.Context, in *patchInput) (*patchOutput, error) {
	action, tracked, err := s.resolveAction(&actionInput{PRPath: in.PRPath, ActionID: in.ActionID})
	if err != nil {
		return nil, err
	}
	if action.Kind != actions.KindReview {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "only review actions carry patches")
	}
	if !findingIDPattern.MatchString(in.FindingID) {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "invalid finding id")
	}

	pr, err := s.prMetadata(ctx, in.Owner, in.Repo, in.Number, false)
	if err != nil {
		return nil, s.providerError(err)
	}
	if pr.HeadSHA == "" {
		return nil, errorf(http.StatusBadGateway, codeGitHub, "GitHub did not report the head commit")
	}

	// The allowlist is computed from the same cached diff the review was built
	// from, so a patch can only touch files this pull request changes.
	unified, err := s.loadDiff(ctx, in.Owner, in.Repo, in.Number, pr.HeadSHA, false)
	if err != nil {
		return nil, s.providerError(err)
	}
	files := diff.Parse(unified)

	s.patchMu.Lock()
	defer s.patchMu.Unlock()

	artifact, found := s.artifacts.Get(tracked.Owner, tracked.Name, in.Number, pr.HeadSHA, action.ID)
	if !found {
		if _, stale := s.artifacts.Latest(tracked.Owner, tracked.Name, in.Number, action.ID); stale {
			return nil, errorf(http.StatusConflict, codeReviewStale, "This review is from an older commit. Re-run it.")
		}
		return nil, errorf(http.StatusNotFound, codeNotFound, "review artifact not found")
	}

	finding := findFinding(artifact, in.FindingID)
	if finding == nil {
		return nil, errorf(http.StatusNotFound, codeNotFound, "finding not found")
	}
	// Idempotent: the stored timestamp wins, nothing is applied twice.
	if finding.AppliedAt != nil {
		return &patchOutput{Body: patchApplyResponse{OK: true, AppliedAt: *finding.AppliedAt, Worktree: artifact.Worktree}}, nil
	}
	if finding.Patch == "" {
		return nil, errorf(http.StatusUnprocessableEntity, codePatchConflict, "This finding has no patch.")
	}
	if info, statErr := os.Stat(artifact.Worktree); artifact.Worktree == "" || statErr != nil || !info.IsDir() {
		return nil, errorf(http.StatusConflict, codeWorktreeMissing, "The worktree is gone. Re-run the review.")
	}

	if err := review.ApplyPatch(ctx, artifact.Worktree, finding.Patch, files); err != nil {
		switch {
		case errors.Is(err, review.ErrPatchConflict):
			return nil, errorf(http.StatusUnprocessableEntity, codePatchConflict, "The patch no longer applies. Re-run the review.")
		case errors.Is(err, review.ErrPatchRejected):
			return nil, errorf(http.StatusUnprocessableEntity, codePatchConflict, "This finding has no applicable patch.")
		default:
			s.logger.Error("patch apply failed", "err", err)
			return nil, errorf(http.StatusInternalServerError, codeInternal, "Applying the patch failed")
		}
	}

	now := time.Now().UTC()
	updated, err := s.artifacts.Update(tracked.Owner, tracked.Name, in.Number, artifact.SHA, action.ID, func(candidate *actions.Artifact) error {
		record := findFinding(candidate, in.FindingID)
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
		return nil, errorf(http.StatusInternalServerError, codeInternal, "The patch applied but could not be recorded")
	}

	appliedAt := now
	if stored := findFinding(updated, in.FindingID); stored != nil && stored.AppliedAt != nil {
		appliedAt = *stored.AppliedAt
	}
	return &patchOutput{Body: patchApplyResponse{OK: true, AppliedAt: appliedAt, Worktree: updated.Worktree}}, nil
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
