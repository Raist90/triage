package api

import (
	"net/http"

	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/danielgtaylor/huma/v2"
)

// RepoPath is the owner/repo pair shared by every per-repository route. The
// pattern matches what GitHub allows in a repo name.
type RepoPath struct {
	Owner string `path:"owner" pattern:"^[A-Za-z0-9_.-]+$" doc:"Repository owner"`
	Repo  string `path:"repo" pattern:"^[A-Za-z0-9_.-]+$" doc:"Repository name"`
}

// PRPath adds the pull request number.
type PRPath struct {
	RepoPath
	Number int `path:"number" minimum:"1" doc:"Pull request number"`
}

type prListInput struct {
	Tab     string `query:"tab" doc:"mine, review, or all"`
	Repo    string `query:"repo" pattern:"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" doc:"Limit the list to one owner/name repo"`
	Refresh bool   `query:"refresh" doc:"Bypass the cached response"`
}

type prDetailInput struct {
	PRPath
	Refresh bool `query:"refresh" doc:"Bypass the cached response"`
}

type diffInput struct {
	PRPath
	Refresh bool `query:"refresh" doc:"Bypass the cached diff"`
}

type reviewInput struct {
	PRPath
	Body reviewRequest
}

type draftInput struct {
	PRPath
	Body draftRequest
}

type mergeInput struct {
	PRPath
	Body mergeRequest
}

type prTargetInput struct {
	PRPath
}

type commentsInput struct {
	PRPath
	Refresh bool `query:"refresh" doc:"Bypass the cached response"`
}

type commentInput struct {
	PRPath
	Body commentRequest
}

type deleteCommentInput struct {
	PRPath
	CommentID int64 `path:"commentID" minimum:"1" doc:"Inline comment id"`
}

type actionInput struct {
	PRPath
	ActionID string `path:"actionID" doc:"Action id from GET /config"`
}

type patchInput struct {
	PRPath
	ActionID  string `path:"actionID" doc:"Action id from GET /config"`
	FindingID string `path:"findingID" doc:"Finding id from the review artifact"`
}

// Output wrappers. Huma documents the Body field as the success response.
type (
	okOutput        struct{ Body okResponse }
	clearedOutput   struct{ Body clearedResponse }
	configOutput    struct{ Body configResponse }
	prListOutput    struct{ Body github.ListResult }
	prDetailOutput  struct{ Body prDetailResponse }
	diffOutput      struct{ Body diff.Response }
	commentsOutput  struct{ Body commentsResponse }
	actionOutput    struct{ Body actionResponse }
	actionRunOutput struct {
		Status int
		Body   actionResponse
	}
	patchOutput struct{ Body patchApplyResponse }
)

// registerRoutes declares every operation. Inputs, query and body tags are the
// contract; the committed openapi.json is generated from this list.
func (s *Server) registerRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Liveness probe",
		Description: "The only route that does not require the bearer token.",
		Tags:        []string{"system"},
	}, s.getHealth)

	huma.Register(api, huma.Operation{
		OperationID: "get-config",
		Method:      http.MethodGet,
		Path:        "/config",
		Summary:     "Webview-safe configuration",
		Tags:        []string{"system"},
	}, s.getConfig)

	huma.Register(api, huma.Operation{
		OperationID: "invalidate-cache",
		Method:      http.MethodPost,
		Path:        "/cache/invalidate",
		Summary:     "Clear every cached provider response",
		Tags:        []string{"system"},
	}, s.invalidateCacheHandler)

	huma.Register(api, huma.Operation{
		OperationID: "clear-artifacts",
		Method:      http.MethodPost,
		Path:        "/artifacts/clear",
		Summary:     "Delete stored Explain and Review artifacts",
		Tags:        []string{"system"},
	}, s.clearArtifactsHandler)

	huma.Register(api, huma.Operation{
		OperationID: "clear-worktrees",
		Method:      http.MethodPost,
		Path:        "/worktrees/clear",
		Summary:     "Delete review worktrees and prune registrations",
		Tags:        []string{"system"},
	}, s.clearWorktreesHandler)

	huma.Register(api, huma.Operation{
		OperationID: "list-prs",
		Method:      http.MethodGet,
		Path:        "/prs",
		Summary:     "List pull requests for one tab",
		Tags:        []string{"prs"},
	}, s.getPRs)

	huma.Register(api, huma.Operation{
		OperationID: "get-pr",
		Method:      http.MethodGet,
		Path:        "/pr/{owner}/{repo}/{number}",
		Summary:     "One pull request with metadata and conversation",
		Tags:        []string{"prs"},
	}, s.getPR)

	huma.Register(api, huma.Operation{
		OperationID: "get-pr-diff",
		Method:      http.MethodGet,
		Path:        "/pr/{owner}/{repo}/{number}/diff",
		Summary:     "Per-file unified diff with semantic annotations",
		Tags:        []string{"prs"},
	}, s.getPRDiff)

	huma.Register(api, huma.Operation{
		OperationID:  "submit-review",
		Method:       http.MethodPost,
		Path:         "/pr/{owner}/{repo}/{number}/review",
		Summary:      "Approve, request changes or comment on a pull request",
		MaxBodyBytes: maxReviewBody,
		Tags:         []string{"prs"},
	}, s.submitReview)

	huma.Register(api, huma.Operation{
		OperationID:  "set-pr-draft",
		Method:       http.MethodPost,
		Path:         "/pr/{owner}/{repo}/{number}/draft",
		Summary:      "Toggle draft state on your own pull request",
		MaxBodyBytes: maxPRStateBody,
		Tags:         []string{"prs"},
	}, s.setPRDraft)

	huma.Register(api, huma.Operation{
		OperationID:  "merge-pr",
		Method:       http.MethodPost,
		Path:         "/pr/{owner}/{repo}/{number}/merge",
		Summary:      "Squash merge your own pull request",
		MaxBodyBytes: maxPRStateBody,
		Tags:         []string{"prs"},
	}, s.mergePR)

	huma.Register(api, huma.Operation{
		OperationID: "close-pr",
		Method:      http.MethodPost,
		Path:        "/pr/{owner}/{repo}/{number}/close",
		Summary:     "Close your own pull request without merging",
		Tags:        []string{"prs"},
	}, s.closePR)

	huma.Register(api, huma.Operation{
		OperationID: "list-comments",
		Method:      http.MethodGet,
		Path:        "/pr/{owner}/{repo}/{number}/comments",
		Summary:     "Inline review comments anchored in the diff",
		Tags:        []string{"comments"},
	}, s.listComments)

	huma.Register(api, huma.Operation{
		OperationID:  "create-comment",
		Method:       http.MethodPost,
		Path:         "/pr/{owner}/{repo}/{number}/comments",
		Summary:      "Post one inline review comment",
		MaxBodyBytes: maxReviewBody,
		Tags:         []string{"comments"},
	}, s.createComment)

	huma.Register(api, huma.Operation{
		OperationID: "delete-comment",
		Method:      http.MethodDelete,
		Path:        "/pr/{owner}/{repo}/{number}/comments/{commentID}",
		Summary:     "Delete your own inline review comment",
		Tags:        []string{"comments"},
	}, s.deleteComment)

	huma.Register(api, huma.Operation{
		OperationID:   "run-action",
		Method:        http.MethodPost,
		Path:          "/pr/{owner}/{repo}/{number}/actions/{actionID}",
		Summary:       "Start Explain or Review, or return the current artifact",
		Description:   "Returns 200 with an existing artifact, or 202 with the started job.",
		DefaultStatus: http.StatusOK,
		Errors:        []int{http.StatusNotFound, http.StatusBadRequest, http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout},
		Tags:          []string{"actions"},
	}, s.runAction)

	huma.Register(api, huma.Operation{
		OperationID: "get-action",
		Method:      http.MethodGet,
		Path:        "/pr/{owner}/{repo}/{number}/actions/{actionID}",
		Summary:     "Current job and artifact for one action",
		Errors:      []int{http.StatusNotFound, http.StatusBadRequest, http.StatusServiceUnavailable},
		Tags:        []string{"actions"},
	}, s.getAction)

	huma.Register(api, huma.Operation{
		OperationID: "cancel-action",
		Method:      http.MethodPost,
		Path:        "/pr/{owner}/{repo}/{number}/actions/{actionID}/cancel",
		Summary:     "Cancel the running job",
		Errors:      []int{http.StatusNotFound, http.StatusBadRequest, http.StatusServiceUnavailable},
		Tags:        []string{"actions"},
	}, s.cancelAction)

	huma.Register(api, huma.Operation{
		OperationID: "apply-finding-patch",
		Method:      http.MethodPost,
		Path:        "/pr/{owner}/{repo}/{number}/actions/{actionID}/patches/{findingID}",
		Summary:     "Apply one review finding's patch to the worktree",
		Errors: []int{
			http.StatusNotFound,
			http.StatusBadRequest,
			http.StatusConflict,
			http.StatusUnprocessableEntity,
		},
		Tags: []string{"actions"},
	}, s.applyFindingPatch)
}
