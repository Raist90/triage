package api

import (
	"context"
	"net/http"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/review"
)

type publishDraftInput struct {
	PRPath
	Body publishDraftRequest
}

type publishDraftRequest struct {
	ActionID string `json:"actionID" doc:"Review action whose findings to publish"`
}

type publishDraftOutput struct {
	Body publishDraftResponse
}

type publishDraftResponse struct {
	OK       bool  `json:"ok"`
	ReviewID int64 `json:"reviewID" doc:"GitHub's id for the pending review"`
	Comments int   `json:"comments" doc:"Inline comments the draft carries"`
}

// publishReviewDraft serves POST /pr/{owner}/{repo}/{number}/review/draft. It
// turns the artifact's findings into one pending review on GitHub. Nothing is
// visible to anyone else until the review is submitted.
func (s *Server) publishReviewDraft(ctx context.Context, in *publishDraftInput) (*publishDraftOutput, error) {
	action, tracked, err := s.resolveAction(&actionInput{PRPath: in.PRPath, ActionID: in.Body.ActionID})
	if err != nil {
		return nil, err
	}
	if action.Kind != actions.KindReview {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "only review actions carry findings")
	}

	pr, err := s.prMetadata(ctx, in.Owner, in.Repo, in.Number, false)
	if err != nil {
		return nil, s.providerError(err)
	}
	if pr.HeadSHA == "" {
		return nil, errorf(http.StatusBadGateway, codeGitHub, "GitHub did not report the head commit")
	}

	artifact, found := s.artifacts.Get(tracked.Owner, tracked.Name, in.Number, pr.HeadSHA, action.ID)
	if !found {
		if _, stale := s.artifacts.Latest(tracked.Owner, tracked.Name, in.Number, action.ID); stale {
			return nil, errorf(http.StatusConflict, codeReviewStale, "This review is from an older commit. Re-run it.")
		}
		return nil, errorf(http.StatusNotFound, codeNotFound, "review artifact not found")
	}
	if artifact.Review == nil {
		return nil, errorf(http.StatusUnprocessableEntity, codeBadRequest, "This artifact has no findings to publish.")
	}

	// The side comes from the same cached diff the review was validated
	// against, so a comment can only anchor to a line a hunk renders.
	unified, err := s.loadDiff(ctx, in.Owner, in.Repo, in.Number, pr.HeadSHA, false)
	if err != nil {
		return nil, s.providerError(err)
	}
	files := diff.Parse(unified)

	comments := make([]github.DraftComment, 0, len(artifact.Review.Findings))
	for _, finding := range artifact.Review.Findings {
		// Praise has no action for the author, so it stays in Triage.
		if finding.Severity == review.SeverityPraise {
			continue
		}
		body := review.CommentBody(finding)
		if body == "" {
			continue
		}
		side, ok := review.CommentTarget(files, finding)
		if !ok {
			continue
		}
		comments = append(comments, github.DraftComment{
			Body: body,
			Path: finding.File,
			Line: finding.Line,
			Side: side,
		})
	}
	if len(comments) == 0 {
		return nil, errorf(http.StatusUnprocessableEntity, codeBadRequest, "This review has no findings that can be published.")
	}

	// GitHub allows one pending review per pull request. Refuse instead of
	// deleting a draft the user may have written by hand on GitHub.
	pending, err := s.github.ListPendingReviews(ctx, in.Owner, in.Repo, in.Number)
	if err != nil {
		return nil, s.providerError(err)
	}
	if len(pending) > 0 {
		return nil, errorf(http.StatusConflict, codeConflict, "You already have a pending review on this pull request. Submit or discard it first.")
	}

	reviewID, err := s.github.CreatePendingReview(ctx, in.Owner, in.Repo, in.Number, pr.HeadSHA, comments)
	if err != nil {
		return nil, s.reviewError(err)
	}

	s.invalidateComments(in.Owner, in.Repo, in.Number)
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &publishDraftOutput{Body: publishDraftResponse{OK: true, ReviewID: reviewID, Comments: len(comments)}}, nil
}

// discardReviewDraft serves DELETE /pr/{owner}/{repo}/{number}/review/draft.
// Only unsubmitted reviews can be deleted, which is exactly what a pending
// review is.
func (s *Server) discardReviewDraft(ctx context.Context, in *prTargetInput) (*clearedOutput, error) {
	pending, err := s.github.ListPendingReviews(ctx, in.Owner, in.Repo, in.Number)
	if err != nil {
		return nil, s.providerError(err)
	}

	cleared := 0
	for _, reviewID := range pending {
		if err := s.github.DeletePendingReview(ctx, in.Owner, in.Repo, in.Number, reviewID); err != nil {
			s.invalidateComments(in.Owner, in.Repo, in.Number)
			s.invalidatePR(in.Owner, in.Repo, in.Number)
			return nil, s.reviewError(err)
		}
		cleared++
	}

	s.invalidateComments(in.Owner, in.Repo, in.Number)
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &clearedOutput{Body: clearedResponse{Cleared: cleared}}, nil
}
