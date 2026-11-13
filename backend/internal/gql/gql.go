// Package gql is a tiny GraphQL-over-HTTP client: POST a query plus variables,
// decode the data field. No GraphQL dependency.
package gql

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	defaultTimeout = 30 * time.Second
	maxBodyBytes   = 16 << 20
)

// Client talks to one GraphQL endpoint with one bearer token.
type Client struct {
	endpoint string
	token    string
	http     *http.Client
}

// NewClient builds a client. An empty token means unauthenticated requests; an
// empty endpoint makes every call fail.
func NewClient(endpoint, token string) *Client {
	return &Client{
		endpoint: endpoint,
		token:    token,
		http:     &http.Client{Timeout: defaultTimeout},
	}
}

// FieldError is one entry of a GraphQL errors array.
type FieldError struct {
	Message string `json:"message"`
	Type    string `json:"type,omitempty"`
}

// APIError is a safe, transport-agnostic failure. Message never contains the
// bearer token or a raw provider body.
type APIError struct {
	Status  int
	Message string
	Errors  []FieldError
}

func (e *APIError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("gql: %s (status %d)", e.Message, e.Status)
	}
	return "gql: " + e.Message
}

type response struct {
	Data   json.RawMessage `json:"data"`
	Errors []FieldError    `json:"errors"`
}

type request struct {
	Query     string `json:"query"`
	Variables any    `json:"variables,omitempty"`
}

// Do runs the query with the given variables and decodes the data field into
// out. out may be nil when the caller only cares about success.
func (c *Client) Do(ctx context.Context, query string, vars any, out any) error {
	if c.endpoint == "" {
		return &APIError{Message: "endpoint is not configured"}
	}

	payload, err := json.Marshal(request{Query: query, Variables: vars})
	if err != nil {
		return &APIError{Message: "could not encode request"}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return &APIError{Message: "could not build request"}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		// Honor cancellation; otherwise keep the transport detail for server logs.
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return &APIError{Message: "request to provider failed"}
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		// Drain a bounded amount so the connection can be reused, but never
		// surface the provider body.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return &APIError{Status: resp.StatusCode, Message: statusMessage(resp.StatusCode)}
	}

	var body response
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&body); err != nil {
		return &APIError{Status: resp.StatusCode, Message: "provider returned an unreadable response"}
	}
	if len(body.Errors) > 0 {
		return &APIError{Status: resp.StatusCode, Message: "provider returned errors", Errors: body.Errors}
	}
	if out == nil {
		return nil
	}
	if len(body.Data) == 0 || bytes.Equal(body.Data, []byte("null")) {
		return &APIError{Status: resp.StatusCode, Message: "provider returned no data"}
	}
	if err := json.Unmarshal(body.Data, out); err != nil {
		return &APIError{Status: resp.StatusCode, Message: "provider returned unexpected data"}
	}
	return nil
}

func statusMessage(status int) string {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "provider rejected credentials"
	case status == http.StatusTooManyRequests:
		return "provider rate limit exceeded"
	case status >= 500:
		return "provider unavailable"
	default:
		return "provider request failed"
	}
}
