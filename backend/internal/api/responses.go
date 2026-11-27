// Package api exposes the local HTTP contract consumed by the webview.
package api

import (
	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/github"
)

// okResponse is the acknowledgement every mutation returns.
type okResponse struct {
	OK bool `json:"ok"`
}

// clearedResponse reports how many entries a maintenance route removed.
type clearedResponse struct {
	Cleared int `json:"cleared"`
}

type prDetailResponse struct {
	PR github.PR `json:"pr"`
}

// reviewRequest is the POST body for a review. Event is APPROVE,
// REQUEST_CHANGES or COMMENT.
type reviewRequest struct {
	Event string `json:"event" doc:"APPROVE, REQUEST_CHANGES or COMMENT"`
	Body  string `json:"body" doc:"Review comment. Optional only for APPROVE."`
}

// draftRequest toggles a PR between draft and ready for review.
type draftRequest struct {
	Draft *bool `json:"draft" doc:"true to move back to draft, false to mark ready"`
}

// mergeRequest supports squash merge only. SHA pins the merge to the head the
// user reviewed; GitHub rejects the request when the branch moved.
type mergeRequest struct {
	Method string `json:"method" doc:"Only squash is supported"`
	SHA    string `json:"sha" doc:"Head commit the user reviewed"`
}

// commentRequest is the POST body for one inline diff comment.
type commentRequest struct {
	Body     string `json:"body"`
	Path     string `json:"path" doc:"File path in the pull request diff"`
	Line     int    `json:"line" doc:"Line in the file the comment anchors to"`
	Side     string `json:"side" enum:"RIGHT,LEFT" doc:"Diff side the line belongs to"`
	CommitID string `json:"commitId" doc:"Head commit the comment anchors to"`
}

type commentsResponse struct {
	Comments []github.InlineComment `json:"comments"`
}

// repoReviewView says whether an automatic review can run for one repo.
type repoReviewView struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty" doc:"Why review is unavailable, when it is"`
}

// repoView is the webview-safe repo entry.
type repoView struct {
	Owner   string         `json:"owner"`
	Name    string         `json:"name"`
	Actions bool           `json:"actions"`
	Review  repoReviewView `json:"review"`
}

type actionView struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind" enum:"explain,review"`
}

type configResponse struct {
	User          config.UserConfig   `json:"user"`
	Repos         []repoView          `json:"repos"`
	Tabs          []config.TabConfig  `json:"tabs"`
	Linear        config.LinearConfig `json:"linear"`
	Actions       []actionView        `json:"actions"`
	ActionsReason string              `json:"actionsReason,omitempty" doc:"Why the action list is empty, when it is"`
	ConfigPath    string              `json:"configPath" doc:"Absolute path of the config file the server read"`
	ConfigError   string              `json:"configError,omitempty" doc:"Set when the config file could not be read or parsed"`
}

type actionResponse struct {
	Job      *actions.Job      `json:"job,omitempty"`
	Artifact *actions.Artifact `json:"artifact,omitempty"`
	Stale    bool              `json:"stale,omitempty" doc:"The artifact was produced for an older commit"`
}
