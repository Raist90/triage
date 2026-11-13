package github

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// Inline comment sides, as GitHub spells them on the diff endpoint.
const (
	CommentSideRight = "RIGHT"
	CommentSideLeft  = "LEFT"
)

// maxCommentPages caps review-comment pagination so one enormous PR cannot
// stall the diff view. 10 pages is 1000 comments.
const maxCommentPages = 10

// InlineComment is one review comment anchored to a diff line. Line and
// OriginalLine are pointers because GitHub returns null for comments whose
// anchor no longer exists in the current diff.
type InlineComment struct {
	ID           int64  `json:"id"`
	Author       string `json:"author"`
	Body         string `json:"body"`
	CreatedAt    string `json:"createdAt"`
	Path         string `json:"path"`
	Line         int    `json:"line,omitempty"`
	OriginalLine int    `json:"originalLine,omitempty"`
	StartLine    int    `json:"startLine,omitempty"`
	Side         string `json:"side,omitempty"`
	CommitID     string `json:"commitID"`
	InReplyToID  int64  `json:"inReplyToID,omitempty"`
	Outdated     bool   `json:"outdated,omitempty"`
}

// NewInlineComment is the POST body for one review comment. Side is RIGHT for
// added/context lines and LEFT for removed lines.
type NewInlineComment struct {
	Body     string `json:"body"`
	Path     string `json:"path"`
	Line     int    `json:"line"`
	Side     string `json:"side"`
	CommitID string `json:"commit_id"`
}

// ListReviewComments returns every inline review comment on a pull request.
// Comments from older commits are included with Outdated set; the diff view
// only anchors the ones matching the current head.
func (c *Client) ListReviewComments(ctx context.Context, owner, repo string, number int) ([]InlineComment, error) {
	if !c.Configured() {
		return nil, &gql.APIError{Message: "GitHub is not configured"}
	}

	comments := make([]InlineComment, 0)
	for page := 1; page <= maxCommentPages; page++ {
		path := fmt.Sprintf("/repos/%s/%s/pulls/%d/comments?per_page=100&page=%d",
			url.PathEscape(owner), url.PathEscape(repo), number, page)

		var raw []commentPayload
		if err := c.doJSON(ctx, http.MethodGet, path, nil, &raw); err != nil {
			return nil, err
		}
		for _, item := range raw {
			comments = append(comments, item.toInlineComment())
		}
		if len(raw) < 100 {
			break
		}
	}
	return comments, nil
}

// DeleteReviewComment removes one review comment by ID. GitHub enforces
// ownership/permissions; a comment the viewer did not write comes back 403.
func (c *Client) DeleteReviewComment(ctx context.Context, owner, repo string, commentID int64) error {
	path := fmt.Sprintf("/repos/%s/%s/pulls/comments/%d",
		url.PathEscape(owner), url.PathEscape(repo), commentID)
	return c.doJSON(ctx, http.MethodDelete, path, nil, nil)
}

// CreateReviewComment posts one standalone review comment. GitHub accepts this
// on the author's own pull request; only approvals and change requests are
// rejected there.
func (c *Client) CreateReviewComment(ctx context.Context, owner, repo string, number int, comment NewInlineComment) error {
	payload := struct {
		Body     string `json:"body"`
		Path     string `json:"path"`
		Line     int    `json:"line"`
		Side     string `json:"side"`
		CommitID string `json:"commit_id"`
	}{
		Body:     strings.TrimSpace(comment.Body),
		Path:     comment.Path,
		Line:     comment.Line,
		Side:     strings.ToUpper(strings.TrimSpace(comment.Side)),
		CommitID: comment.CommitID,
	}

	path := fmt.Sprintf("/repos/%s/%s/pulls/%d/comments",
		url.PathEscape(owner), url.PathEscape(repo), number)
	return c.doJSON(ctx, http.MethodPost, path, payload, nil)
}

// commentPayload mirrors GitHub's REST review-comment shape. It stays private
// so the route only ever sees InlineComment.
type commentPayload struct {
	ID           int64  `json:"id"`
	Body         string `json:"body"`
	Path         string `json:"path"`
	Line         *int   `json:"line"`
	OriginalLine *int   `json:"original_line"`
	StartLine    *int   `json:"start_line"`
	Side         string `json:"side"`
	CommitID     string `json:"commit_id"`
	InReplyToID  int64  `json:"in_reply_to_id"`
	CreatedAt    string `json:"created_at"`
	User         struct {
		Login string `json:"login"`
	} `json:"user"`
}

func (p commentPayload) toInlineComment() InlineComment {
	comment := InlineComment{
		ID:          p.ID,
		Author:      p.User.Login,
		Body:        p.Body,
		CreatedAt:   p.CreatedAt,
		Path:        p.Path,
		Side:        p.Side,
		CommitID:    p.CommitID,
		InReplyToID: p.InReplyToID,
		Outdated:    p.Line == nil,
	}
	if p.Line != nil {
		comment.Line = *p.Line
	}
	if p.OriginalLine != nil {
		comment.OriginalLine = *p.OriginalLine
	}
	if p.StartLine != nil {
		comment.StartLine = *p.StartLine
	}
	return comment
}
