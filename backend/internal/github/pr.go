package github

import (
	"context"
	"errors"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// GetPR fetches one PR's metadata and description.
func (c *Client) GetPR(ctx context.Context, owner, repo string, number int) (PR, error) {
	if !c.Configured() {
		return PR{}, &gql.APIError{Message: "GitHub is not configured"}
	}

	vars := struct {
		Owner  string `json:"owner"`
		Name   string `json:"name"`
		Number int    `json:"number"`
	}{Owner: owner, Name: repo, Number: number}

	var data struct {
		Viewer struct {
			Login string `json:"login"`
		} `json:"viewer"`
		Repository struct {
			PullRequest *prNode `json:"pullRequest"`
		} `json:"repository"`
	}
	if err := c.gql.Do(ctx, detailQuery, vars, &data); err != nil {
		var apiErr *gql.APIError
		if errors.As(err, &apiErr) {
			for _, fieldErr := range apiErr.Errors {
				if fieldErr.Type == "NOT_FOUND" {
					return PR{}, &gql.APIError{Status: 404, Message: "pull request not found"}
				}
			}
		}
		return PR{}, err
	}
	if data.Repository.PullRequest == nil {
		return PR{}, &gql.APIError{Status: 404, Message: "pull request not found"}
	}
	pr := data.Repository.PullRequest.toPR()
	pr.ViewerReview = normalizeReviewState(data.Repository.PullRequest.ViewerLatestReview.State)
	pr.ViewerLogin = data.Viewer.Login
	pr.ViewerCanApprove = !strings.EqualFold(pr.Author, data.Viewer.Login)
	return pr, nil
}

// prNode mirrors the GraphQL selection shared by list and detail queries.
type prNode struct {
	Typename           string `json:"__typename"`
	Number             int    `json:"number"`
	Title              string `json:"title"`
	URL                string `json:"url"`
	Body               string `json:"body"`
	State              string `json:"state"`
	IsDraft            bool   `json:"isDraft"`
	Mergeable          string `json:"mergeable"`
	MergeStateStatus   string `json:"mergeStateStatus"`
	HeadRefName        string `json:"headRefName"`
	HeadRefOid         string `json:"headRefOid"`
	BaseRefName        string `json:"baseRefName"`
	ReviewDecision     string `json:"reviewDecision"`
	ViewerLatestReview struct {
		State string `json:"state"`
	} `json:"viewerLatestReview"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	MergedAt     string `json:"mergedAt"`
	MergedBy     struct {
		Login string `json:"login"`
	} `json:"mergedBy"`
	MergeCommit struct {
		Oid string `json:"oid"`
	} `json:"mergeCommit"`
	Additions    int `json:"additions"`
	Deletions    int `json:"deletions"`
	ChangedFiles int `json:"changedFiles"`
	Author       struct {
		Login string `json:"login"`
	} `json:"author"`
	Repository struct {
		NameWithOwner      string `json:"nameWithOwner"`
		SquashMergeAllowed bool   `json:"squashMergeAllowed"`
	} `json:"repository"`
	Commits struct {
		Nodes []struct {
			Commit struct {
				StatusCheckRollup *struct {
					State string `json:"state"`
				} `json:"statusCheckRollup"`
			} `json:"commit"`
		} `json:"nodes"`
	} `json:"commits"`
	Comments struct {
		Nodes []commentNode `json:"nodes"`
	} `json:"comments"`
	Reviews struct {
		Nodes []reviewNode `json:"nodes"`
	} `json:"reviews"`
	ReviewThreads struct {
		Nodes []struct {
			Path     string `json:"path"`
			Line     int    `json:"line"`
			Comments struct {
				Nodes []commentNode `json:"nodes"`
			} `json:"comments"`
		} `json:"nodes"`
	} `json:"reviewThreads"`
}

type commentNode struct {
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	Author    struct {
		Login string `json:"login"`
	} `json:"author"`
}

type reviewNode struct {
	Body      string `json:"body"`
	State     string `json:"state"`
	CreatedAt string `json:"createdAt"`
	Author    struct {
		Login string `json:"login"`
	} `json:"author"`
}

func (n prNode) toPR() PR {
	check := statusNone
	if len(n.Commits.Nodes) > 0 {
		rollup := n.Commits.Nodes[0].Commit.StatusCheckRollup
		if rollup != nil && rollup.State != "" {
			check = strings.ToLower(rollup.State)
		}
	}

	review := reviewNone
	if n.ReviewDecision != "" {
		review = strings.ToLower(n.ReviewDecision)
	}

	comments := make([]Comment, 0, len(n.Comments.Nodes))
	for _, comment := range n.Comments.Nodes {
		comments = append(comments, comment.toComment("comment"))
	}
	for _, review := range n.Reviews.Nodes {
		state := strings.ToLower(review.State)
		// Pending reviews are private drafts; empty COMMENTED reviews are just
		// the batch that carries inline comments, which arrive on their own.
		if review.State == "PENDING" || (review.State == "COMMENTED" && review.Body == "") {
			continue
		}
		comments = append(comments, Comment{
			Author:    review.Author.Login,
			Body:      review.Body,
			CreatedAt: review.CreatedAt,
			Kind:      "verdict",
			State:     state,
		})
	}
	for _, thread := range n.ReviewThreads.Nodes {
		for _, comment := range thread.Comments.Nodes {
			item := comment.toComment("review")
			item.Path = thread.Path
			item.Line = thread.Line
			comments = append(comments, item)
		}
	}

	return PR{
		Number:             n.Number,
		Title:              n.Title,
		URL:                n.URL,
		Author:             n.Author.Login,
		Repo:               n.Repository.NameWithOwner,
		HeadSHA:            n.HeadRefOid,
		Branch:             n.HeadRefName,
		BaseBranch:         n.BaseRefName,
		CheckStatus:        check,
		ReviewState:        review,
		State:              strings.ToLower(n.State),
		Description:        n.Body,
		Additions:          n.Additions,
		Deletions:          n.Deletions,
		ChangedFiles:       n.ChangedFiles,
		CreatedAt:          n.CreatedAt,
		UpdatedAt:          n.UpdatedAt,
		MergedAt:           n.MergedAt,
		MergedBy:           n.MergedBy.Login,
		MergeCommitSHA:     n.MergeCommit.Oid,
		IsDraft:            n.IsDraft,
		Mergeable:          strings.ToLower(n.Mergeable),
		MergeStateStatus:   strings.ToLower(n.MergeStateStatus),
		SquashMergeAllowed: n.Repository.SquashMergeAllowed,
		Comments:           comments,
	}
}

// normalizeReviewState maps GitHub's uppercase review enum to the lowercase
// contract; no review becomes "none".
func normalizeReviewState(state string) string {
	if state == "" {
		return reviewNone
	}
	return strings.ToLower(state)
}

func (c commentNode) toComment(kind string) Comment {
	return Comment{
		Author:    c.Author.Login,
		Body:      c.Body,
		CreatedAt: c.CreatedAt,
		Kind:      kind,
	}
}
