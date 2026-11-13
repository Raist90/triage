package github

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/Raist90/triage/backend/internal/gql"
)

const (
	// maxTreeBytes bounds one recursive tree listing. GitHub itself truncates
	// listings past 100k entries, so this is only a memory guard.
	maxTreeBytes = 16 << 20
	// maxBlobBytes bounds one file side. Larger files are skipped, named, and
	// never downloaded whole.
	maxBlobBytes = 2 << 20
)

// TreeEntry is one file in a git tree.
type TreeEntry struct {
	Path string
	SHA  string
	Size int
}

// TreeResult maps every listed path to its blob. Truncated means GitHub stopped
// at its entry limit, so the map is incomplete.
type TreeResult struct {
	Entries   map[string]TreeEntry
	Truncated bool
}

// Tree lists the blobs of a commit's tree. The caller uses it to find the blob
// SHA for each changed path without fetching file contents first.
func (c *Client) Tree(ctx context.Context, owner, repo, sha string) (TreeResult, error) {
	if !c.Configured() {
		return TreeResult{}, &gql.APIError{Message: "GitHub is not configured"}
	}

	path := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) +
		"/git/trees/" + url.PathEscape(sha) + "?recursive=1"
	body, err := c.doRaw(ctx, path, "application/vnd.github+json", maxTreeBytes)
	if err != nil {
		return TreeResult{}, err
	}

	var payload struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
			SHA  string `json:"sha"`
			Size int    `json:"size"`
		} `json:"tree"`
		Truncated bool `json:"truncated"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return TreeResult{}, &gql.APIError{Message: "provider returned an unexpected response"}
	}

	result := TreeResult{
		Entries:   make(map[string]TreeEntry, len(payload.Tree)),
		Truncated: payload.Truncated,
	}
	for _, entry := range payload.Tree {
		if entry.Type != "blob" {
			continue
		}
		result.Entries[entry.Path] = TreeEntry{Path: entry.Path, SHA: entry.SHA, Size: entry.Size}
	}
	return result, nil
}

// Blob fetches one blob's raw bytes. Git blobs are immutable by SHA, so callers
// may cache the result for as long as they like.
func (c *Client) Blob(ctx context.Context, owner, repo, sha string) ([]byte, error) {
	if !c.Configured() {
		return nil, &gql.APIError{Message: "GitHub is not configured"}
	}

	path := "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) +
		"/git/blobs/" + url.PathEscape(sha)
	return c.doRaw(ctx, path, "application/vnd.github.raw", maxBlobBytes)
}

// doRaw sends one GET and returns at most limit bytes. A body over the limit is
// an error rather than a truncated file, because a partial source file would
// produce a misleading diff.
func (c *Client) doRaw(ctx context.Context, path, accept string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, restBaseURL+path, nil)
	if err != nil {
		return nil, &gql.APIError{Message: "could not build request"}
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.web.http.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, &gql.APIError{Message: "request to provider failed"}
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, &gql.APIError{
			Status:  resp.StatusCode,
			Message: restErrorMessage(resp.Body, resp.StatusCode),
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, &gql.APIError{Message: "provider returned an unreadable response"}
	}
	if int64(len(body)) > limit {
		return nil, &gql.APIError{
			Status:  resp.StatusCode,
			Message: "file is too large to diff (" + strconv.Itoa(len(body)/1024) + " KiB)",
		}
	}
	return body, nil
}
