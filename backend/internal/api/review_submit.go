package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/github"
)

// maxReviewBody caps one review comment; GitHub's limit is 65536 characters.
const maxReviewBody = 64 << 10

type reviewInput struct {
	PRPath
	Body reviewRequest
}

// submitReview serves POST /pr/{owner}/{repo}/{number}/review.
func (s *Server) submitReview(ctx context.Context, in *reviewInput) (*okOutput, error) {
	event := strings.ToUpper(strings.TrimSpace(in.Body.Event))
	if !github.ValidateReviewEvent(event) {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "event must be APPROVE, REQUEST_CHANGES or COMMENT")
	}
	body := strings.TrimSpace(in.Body.Body)
	if len(body) > maxReviewBody {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "review comment is too long")
	}
	if body == "" && event != github.ReviewApprove {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "a comment is required to request changes or comment")
	}

	if err := s.submitReviewEvent(ctx, in, event, body); err != nil {
		return nil, s.reviewError(err)
	}

	s.invalidateComments(in.Owner, in.Repo, in.Number)
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &okOutput{Body: okResponse{OK: true}}, nil
}

// submitReviewEvent submits the viewer's pending review when one exists,
// because that draft already carries the inline comments; otherwise it creates
// a review with a body only. GitHub allows one pending review per pull request,
// so the highest id is the current draft.
func (s *Server) submitReviewEvent(ctx context.Context, in *reviewInput, event, body string) error {
	pending, err := s.github.ListPendingReviews(ctx, in.Owner, in.Repo, in.Number)
	if err != nil {
		return err
	}
	if len(pending) > 0 {
		newest := pending[0]
		for _, id := range pending[1:] {
			if id > newest {
				newest = id
			}
		}
		return s.github.SubmitPendingReview(ctx, in.Owner, in.Repo, in.Number, newest, event, body)
	}
	return s.github.SubmitReview(ctx, in.Owner, in.Repo, in.Number, event, body)
}
