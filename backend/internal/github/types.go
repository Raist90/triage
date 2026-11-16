package github

const (
	graphqlEndpoint = "https://api.github.com/graphql"

	// searchPageSize caps one repo/tab result set.
	searchPageSize = 50

	// statusNone and reviewNone are the neutral values when GitHub reports no
	// check suite or no review decision.
	statusNone = "none"
	reviewNone = "none"
)

// Tab IDs are part of the Go/TS contract; config carries the labels.
const (
	TabMine   = "mine"
	TabReview = "review"
	TabAll    = "all"
)

// Viewer is the authenticated GitHub identity.
type Viewer struct {
	Login string `json:"login"`
	Name  string `json:"name"`
}

// PR is the list/detail shape shared by every route. Enums are normalized to
// lowercase so the webview never has to know GitHub's spelling.
type PR struct {
	Number      int    `json:"number"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Author      string `json:"author"`
	Repo        string `json:"repo"`
	HeadSHA     string `json:"headSHA"`
	Branch      string `json:"branch"`
	BaseBranch  string `json:"baseBranch"`
	CheckStatus string `json:"checkStatus" enum:"success,failure,pending,expected,error,none" doc:"Rolled-up CI state"`
	ReviewState string `json:"reviewState" enum:"approved,changes_requested,review_required,none" doc:"Review decision on the pull request"`
	// ViewerReview is the viewer's latest review on the PR ("approved",
	// "changes_requested", ...). Detail responses only.
	ViewerReview string `json:"viewerReview,omitempty" doc:"The viewer's latest review, when they have one"`
	// ViewerLogin is the authenticated GitHub login. Detail responses only; the
	// diff UI uses it to show delete controls on the viewer's own comments.
	ViewerLogin string `json:"viewerLogin,omitempty"`
	// ViewerCanApprove is false for the author's own PR, where GitHub rejects
	// an approval. Detail responses only.
	ViewerCanApprove bool   `json:"viewerCanApprove,omitempty"`
	State            string `json:"state" doc:"GitHub pull request state, lowercased"`
	Description      string `json:"description" doc:"Pull request body, markdown"`
	Additions        int    `json:"additions"`
	Deletions        int    `json:"deletions"`
	ChangedFiles     int    `json:"changedFiles"`
	CreatedAt        string `json:"createdAt,omitempty"`
	UpdatedAt        string `json:"updatedAt"`
	IsDraft          bool   `json:"isDraft"`
	// Mergeable and MergeStateStatus are detail responses only. GitHub computes
	// mergeability asynchronously, so Mergeable can be "unknown" for a moment
	// after the head or draft state changes.
	Mergeable          string    `json:"mergeable,omitempty" enum:"mergeable,conflicting,unknown" doc:"Whether GitHub can merge the pull request"`
	MergeStateStatus   string    `json:"mergeStateStatus,omitempty" doc:"GitHub's detailed merge state, e.g. clean or blocked"`
	SquashMergeAllowed bool      `json:"squashMergeAllowed" doc:"False when the repo disables squash merges"`
	Comments           []Comment `json:"comments,omitempty" doc:"Conversation timeline, detail responses only"`
}

// Comment is one entry in a PR's conversation: an issue comment, a review
// verdict, or an inline review-thread comment. State is set on verdicts and
// Path/Line are set on inline comments.
type Comment struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	Kind      string `json:"kind" enum:"comment,review,verdict" doc:"What the timeline entry is"`
	State     string `json:"state,omitempty" doc:"Verdict state, e.g. approved or changes_requested"`
	Path      string `json:"path,omitempty"`
	Line      int    `json:"line,omitempty"`
}

// ListResult is one tab scoped to either all tracked repos or a single repo.
type ListResult struct {
	Viewer Viewer `json:"viewer"`
	PRs    []PR   `json:"prs"`
}
