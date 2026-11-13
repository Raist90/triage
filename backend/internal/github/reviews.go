package github

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
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
