package github

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// ClosePR closes a pull request without merging it. REST carries the state
// change; the GraphQL closePullRequest mutation would need a node ID lookup
// first for the same result.
func (c *Client) ClosePR(ctx context.Context, owner, repo string, number int) error {
	payload := struct {
		State string `json:"state"`
	}{State: "closed"}

	path := fmt.Sprintf("/repos/%s/%s/pulls/%d",
		url.PathEscape(owner), url.PathEscape(repo), number)

	var result struct {
		State string `json:"state"`
	}
	if err := c.doJSON(ctx, http.MethodPatch, path, payload, &result); err != nil {
		return err
	}
	// GitHub answers a successful PATCH with the updated pull request. A 2xx
	// that still reports another state means the close did not take effect.
	if !strings.EqualFold(result.State, "closed") {
		return &gql.APIError{
			Status:  http.StatusUnprocessableEntity,
			Message: "close did not complete",
		}
	}
	return nil
}
