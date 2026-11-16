// Package github fetches pull request metadata through GraphQL and diffs
// through REST. It never returns raw provider bodies or the bearer token.
package github

import (
	"github.com/Raist90/triage/backend/internal/gql"
)

// Client talks to GitHub with one token. An empty token is allowed; calls then
// fail with a clean APIError instead of panicking.
type Client struct {
	gql   *gql.Client
	token string
	web   *webClient
}

// NewClient returns a client. token may be empty.
func NewClient(token string) *Client {
	return &Client{
		gql:   gql.NewClient(graphqlEndpoint, token),
		token: token,
		web:   newWebClient(token),
	}
}

// Configured reports whether a token was resolved.
func (c *Client) Configured() bool { return c.token != "" }

// ValidateTab reports whether tab is one of the three supported IDs.
func ValidateTab(tab string) bool {
	switch tab {
	case TabMine, TabReview, TabAll:
		return true
	default:
		return false
	}
}
