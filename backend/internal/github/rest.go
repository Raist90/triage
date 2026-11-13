package github

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Raist90/triage/backend/internal/gql"
)

const (
	restBaseURL   = "https://api.github.com"
	diffTimeout   = 30 * time.Second
	maxDiffBytes  = 16 << 20
	maxJSONBytes  = 1 << 20
	diffMediaType = "application/vnd.github.v3.diff"
)

// DiffResult is one REST diff fetch. NotModified means the caller's ETag still
// matches and Body is empty; serve the cached copy.
type DiffResult struct {
	Body        []byte
	ETag        string
	NotModified bool
}

type webClient struct {
	token string
	http  *http.Client
}

func newWebClient(token string) *webClient {
	return &webClient{token: token, http: &http.Client{Timeout: diffTimeout}}
}

// doJSON sends one REST request with an optional JSON payload and decodes the
// response into out when out is non-nil. Non-2xx responses become APIErrors
// carrying GitHub's own message (e.g. "Can not approve your own pull request"),
// trimmed to a bounded single line.
func (c *Client) doJSON(ctx context.Context, method, path string, payload, out any) error {
	if !c.Configured() {
		return &gql.APIError{Message: "GitHub is not configured"}
	}

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return &gql.APIError{Message: "could not encode request"}
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, restBaseURL+path, body)
	if err != nil {
		return &gql.APIError{Message: "could not build request"}
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.web.http.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return &gql.APIError{Message: "request to provider failed"}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode <= 299 {
		if out == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxJSONBytes))
			return nil
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, maxJSONBytes)).Decode(out); err != nil {
			return &gql.APIError{Status: resp.StatusCode, Message: "provider returned an unexpected response"}
		}
		return nil
	}

	return &gql.APIError{Status: resp.StatusCode, Message: restErrorMessage(resp.Body, resp.StatusCode)}
}

// restErrorMessage extracts GitHub's error message without echoing the body.
func restErrorMessage(body io.Reader, status int) string {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "provider rejected credentials"
	case status == http.StatusTooManyRequests:
		return "provider rate limit exceeded"
	case status >= 500:
		return "provider unavailable"
	}

	var payload struct {
		Message string `json:"message"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.NewDecoder(io.LimitReader(body, 8<<10)).Decode(&payload)

	message := strings.TrimSpace(payload.Message)
	if message == "" && len(payload.Errors) > 0 {
		message = strings.TrimSpace(payload.Errors[0].Message)
	}
	if message == "" {
		return "provider request failed (status " + strconv.Itoa(status) + ")"
	}
	message = strings.Join(strings.Fields(message), " ")
	if runes := []rune(message); len(runes) > 200 {
		message = string(runes[:200]) + "…"
	}
	return message
}

// Diff fetches a PR diff. When etag is non-empty it is sent as If-None-Match.
func (c *Client) Diff(ctx context.Context, owner, repo string, number int, etag string) (DiffResult, error) {
	if !c.Configured() {
		return DiffResult{}, &gql.APIError{Message: "GitHub is not configured"}
	}

	endpoint := fmt.Sprintf("%s/repos/%s/%s/pulls/%d",
		restBaseURL, url.PathEscape(owner), url.PathEscape(repo), number)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return DiffResult{}, &gql.APIError{Message: "could not build request"}
	}
	req.Header.Set("Accept", diffMediaType)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := c.web.http.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return DiffResult{}, err
		}
		return DiffResult{}, &gql.APIError{Message: "request to provider failed"}
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotModified:
		return DiffResult{NotModified: true, ETag: etag}, nil
	case resp.StatusCode == http.StatusOK:
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiffBytes))
		if err != nil {
			return DiffResult{}, &gql.APIError{Message: "provider returned an unreadable response"}
		}
		return DiffResult{Body: body, ETag: resp.Header.Get("ETag")}, nil
	case resp.StatusCode == http.StatusNotFound:
		return DiffResult{}, &gql.APIError{Status: resp.StatusCode, Message: "pull request not found"}
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return DiffResult{}, &gql.APIError{Status: resp.StatusCode, Message: "provider rejected credentials"}
	case resp.StatusCode == http.StatusTooManyRequests:
		return DiffResult{}, &gql.APIError{Status: resp.StatusCode, Message: "provider rate limit exceeded"}
	case resp.StatusCode >= 500:
		return DiffResult{}, &gql.APIError{Status: resp.StatusCode, Message: "provider unavailable"}
	default:
		return DiffResult{}, &gql.APIError{Status: resp.StatusCode, Message: "provider request failed (status " + strconv.Itoa(resp.StatusCode) + ")"}
	}
}
