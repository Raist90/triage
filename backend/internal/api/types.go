// Package api exposes the local HTTP contract consumed by the webview.
package api

import (
	"encoding/json"
	"net/http"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/github"
)

type healthResponse struct {
	OK bool `json:"ok"`
}

type cacheInvalidateResponse struct {
	Cleared int `json:"cleared"`
}

type artifactsClearResponse struct {
	Cleared int `json:"cleared"`
}

type prDetailResponse struct {
	PR github.PR `json:"pr"`
}

// reviewRequest is the POST body for a review. Event is APPROVE,
// REQUEST_CHANGES or COMMENT.
type reviewRequest struct {
	Event string `json:"event"`
	Body  string `json:"body"`
}

type reviewResponse struct {
	OK bool `json:"ok"`
}

// draftRequest toggles a PR between draft and ready for review.
type draftRequest struct {
	Draft *bool `json:"draft"`
}

// mergeRequest supports squash merge only. SHA pins the merge to the head the
// user reviewed; GitHub rejects the request when the branch moved.
type mergeRequest struct {
	Method string `json:"method"`
	SHA    string `json:"sha"`
}

type prStateResponse struct {
	OK bool `json:"ok"`
}

// commentRequest is the POST body for one inline diff comment.
type commentRequest struct {
	Body     string `json:"body"`
	Path     string `json:"path"`
	Line     int    `json:"line"`
	Side     string `json:"side"`
	CommitID string `json:"commitId"`
}

type commentResponse struct {
	OK bool `json:"ok"`
}

type commentsResponse struct {
	Comments []github.InlineComment `json:"comments"`
}

// repoView is the webview-safe repo entry.
type repoView struct {
	Owner   string `json:"owner"`
	Name    string `json:"name"`
	Actions bool   `json:"actions"`
}

type actionView struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type configResponse struct {
	User          config.UserConfig   `json:"user"`
	Repos         []repoView          `json:"repos"`
	Tabs          []config.TabConfig  `json:"tabs"`
	Linear        config.LinearConfig `json:"linear"`
	Actions       []actionView        `json:"actions"`
	ActionsReason string              `json:"actionsReason,omitempty"`
	ConfigPath    string              `json:"configPath"`
	ConfigError   string              `json:"configError,omitempty"`
}

type actionResponse struct {
	Job      *actions.Job      `json:"job,omitempty"`
	Artifact *actions.Artifact `json:"artifact,omitempty"`
	Stale    bool              `json:"stale,omitempty"`
}

// writeJSON writes v as the response body. Marshaling happens before any write
// so a failure can still produce a clean error envelope.
func writeJSON(w http.ResponseWriter, status int, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"internal_error","message":"failed to encode response"}}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}
