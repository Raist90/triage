package github

import (
	"context"
	"errors"
	"net/http"

	"github.com/Raist90/triage/backend/internal/gql"
)

// SetDraft converts a pull request to a draft or marks it ready for review.
// GitHub exposes draft state only through GraphQL mutations, and both need the
// pull request's node ID, so resolve it first. GitHub only allows the author to
// change draft state.
func (c *Client) SetDraft(ctx context.Context, owner, repo string, number int, draft bool) error {
	if !c.Configured() {
		return &gql.APIError{Message: "GitHub is not configured"}
	}

	id, err := c.pullRequestNodeID(ctx, owner, repo, number)
	if err != nil {
		return err
	}

	query := markReadyMutation
	if draft {
		query = convertToDraftMutation
	}
	vars := struct {
		ID string `json:"id"`
	}{ID: id}
	if err := c.gql.Do(ctx, query, vars, nil); err != nil {
		return draftActionError(err)
	}
	return nil
}

// pullRequestNodeID returns the ID the draft mutations take as input.
func (c *Client) pullRequestNodeID(ctx context.Context, owner, repo string, number int) (string, error) {
	vars := struct {
		Owner  string `json:"owner"`
		Name   string `json:"name"`
		Number int    `json:"number"`
	}{Owner: owner, Name: repo, Number: number}

	var data struct {
		Repository struct {
			PullRequest *struct {
				ID string `json:"id"`
			} `json:"pullRequest"`
		} `json:"repository"`
	}
	if err := c.gql.Do(ctx, prNodeIDQuery, vars, &data); err != nil {
		return "", draftActionError(err)
	}
	if data.Repository.PullRequest == nil || data.Repository.PullRequest.ID == "" {
		return "", &gql.APIError{Status: http.StatusNotFound, Message: "pull request not found"}
	}
	return data.Repository.PullRequest.ID, nil
}

// draftActionError turns GraphQL field errors into the API error shape the HTTP
// layer already understands: 404 for a missing PR, 422 for a state change GitHub
// refuses, and 429 for a rate limit. The provider's own reason is kept so the
// user sees why the toggle failed.
func draftActionError(err error) error {
	var apiErr *gql.APIError
	if !errors.As(err, &apiErr) || len(apiErr.Errors) == 0 {
		return err
	}

	field := apiErr.Errors[0]
	status := http.StatusUnprocessableEntity
	switch field.Type {
	case "NOT_FOUND":
		status = http.StatusNotFound
	case "RATE_LIMITED":
		status = http.StatusTooManyRequests
	}

	message := field.Message
	if message == "" {
		message = "draft state change failed"
	}
	return &gql.APIError{Status: status, Message: message}
}
