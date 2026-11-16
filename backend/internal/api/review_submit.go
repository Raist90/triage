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

	if err := s.github.SubmitReview(ctx, in.Owner, in.Repo, in.Number, event, body); err != nil {
		return nil, s.reviewError(err)
	}

	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &okOutput{Body: okResponse{OK: true}}, nil
}
