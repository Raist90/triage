package github

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// Review events accepted by the REST reviews endpoint. Event names are the
// Go/TS contract; the webview never sends an enum GitHub rejects.
const (
	ReviewApprove        = "APPROVE"
	ReviewRequestChanges = "REQUEST_CHANGES"
	ReviewComment        = "COMMENT"
)

// ValidateReviewEvent reports whether event is one of the three supported
// review actions.
func ValidateReviewEvent(event string) bool {
	switch event {
	case ReviewApprove, ReviewRequestChanges, ReviewComment:
		return true
	default:
		return false
	}
}

// SubmitReview posts one review to a pull request. GitHub requires a body for
// COMMENT and REQUEST_CHANGES; APPROVE may stand alone.
func (c *Client) SubmitReview(ctx context.Context, owner, repo string, number int, event, body string) error {
	event = strings.ToUpper(strings.TrimSpace(event))
	if !ValidateReviewEvent(event) {
		return fmt.Errorf("unsupported review event %q", event)
	}
	body = strings.TrimSpace(body)
	if body == "" && event != ReviewApprove {
		return fmt.Errorf("a comment is required for %s", strings.ToLower(event))
	}

	payload := struct {
		Event string `json:"event"`
		Body  string `json:"body,omitempty"`
	}{Event: event, Body: body}

	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews",
		url.PathEscape(owner), url.PathEscape(repo), number)
	return c.doJSON(ctx, http.MethodPost, path, payload, nil)
}

// DraftComment is one inline comment inside a pending review. StartLine and StartSide
// are zero for a single-line comment.
type DraftComment struct {
	Body      string
	Path      string
	Line      int
	Side      string
	StartLine int
	StartSide string
}

// maxReviewListPages caps review pagination; 5 pages is 500 reviews.
const maxReviewListPages = 5

// pendingReview is the REST shape of one review. Only the fields the draft flow
// needs are decoded.
type pendingReview struct {
	ID    int64  `json:"id"`
	State string `json:"state"`
}

// ListPendingReviews returns the viewer's unsubmitted reviews on a pull
// request. GitHub hides a pending review from everyone but its author, so every
// PENDING review in the list belongs to the viewer.
func (c *Client) ListPendingReviews(ctx context.Context, owner, repo string, number int) ([]int64, error) {
	pending := make([]int64, 0, 1)
	for page := 1; page <= maxReviewListPages; page++ {
		path := fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews?per_page=100&page=%d",
			url.PathEscape(owner), url.PathEscape(repo), number, page)

		var raw []pendingReview
		if err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
			return nil, err
		}
		for _, item := range raw {
			if item.State == "PENDING" {
				pending = append(pending, item.ID)
			}
		}
		if len(raw) < 100 {
			break
		}
	}
	return pending, nil
}

// reviewCommentPayload is the REST body of one inline comment inside a review.
type reviewCommentPayload struct {
	Body      string `json:"body"`
	Path      string `json:"path"`
	Line      int    `json:"line"`
	Side      string `json:"side"`
	StartLine int    `json:"start_line,omitempty"`
	StartSide string `json:"start_side,omitempty"`
}

// CreatePendingReview creates one unsubmitted review carrying inline comments.
// No event is sent: GitHub keeps the review as a draft the author submits
// later, and nothing is visible to anyone else meanwhile.
func (c *Client) CreatePendingReview(ctx context.Context, owner, repo string, number int, commitID string, comments []DraftComment) (int64, error) {
	payload := struct {
		CommitID string                 `json:"commit_id"`
		Comments []reviewCommentPayload `json:"comments"`
	}{CommitID: commitID, Comments: make([]reviewCommentPayload, 0, len(comments))}
	for _, comment := range comments {
		payload.Comments = append(payload.Comments, reviewCommentPayload{
			Body:      comment.Body,
			Path:      comment.Path,
			Line:      comment.Line,
			Side:      comment.Side,
			StartLine: comment.StartLine,
			StartSide: comment.StartSide,
		})
	}

	var created struct {
		ID int64 `json:"id"`
	}
	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews",
		url.PathEscape(owner), url.PathEscape(repo), number)
	if err := c.doJSON(ctx, http.MethodPost, path, payload, &created); err != nil {
		return 0, err
	}
	if created.ID == 0 {
		return 0, &gql.APIError{Message: "GitHub did not return the draft review"}
	}
	return created.ID, nil
}

// SubmitPendingReview publishes a review GitHub is holding as a draft. GitHub
// requires a body for COMMENT and REQUEST_CHANGES; APPROVE may stand alone.
func (c *Client) SubmitPendingReview(ctx context.Context, owner, repo string, number int, reviewID int64, event, body string) error {
	event = strings.ToUpper(strings.TrimSpace(event))
	if !ValidateReviewEvent(event) {
		return fmt.Errorf("unsupported review event %q", event)
	}
	body = strings.TrimSpace(body)
	if body == "" && event != ReviewApprove {
		return fmt.Errorf("a comment is required for %s", strings.ToLower(event))
	}

	payload := struct {
		Event string `json:"event"`
		Body  string `json:"body,omitempty"`
	}{Event: event, Body: body}

	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews/%d/events",
		url.PathEscape(owner), url.PathEscape(repo), number, reviewID)
	return c.doJSON(ctx, http.MethodPost, path, payload, nil)
}

// DeletePendingReview discards the viewer's draft. GitHub rejects deleting a
// review that was already submitted.
func (c *Client) DeletePendingReview(ctx context.Context, owner, repo string, number int, reviewID int64) error {
	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/reviews/%d",
		url.PathEscape(owner), url.PathEscape(repo), number, reviewID)
	return c.doJSON(ctx, http.MethodDelete, path, nil, nil)
}
