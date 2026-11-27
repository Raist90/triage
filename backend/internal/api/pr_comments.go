package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/review"
)

const maxCommentPath = 4096

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

// listComments serves GET /pr/{owner}/{repo}/{number}/comments.
func (s *Server) listComments(ctx context.Context, in *commentsInput) (*commentsOutput, error) {
	vars := prVars{Owner: in.Owner, Repo: in.Repo, Number: in.Number}

	var result commentsResponse
	err := s.loadCached("pr-comments", vars, s.cfg.Cache.REST, in.Refresh, &result, func() error {
		comments, err := s.github.ListReviewComments(ctx, in.Owner, in.Repo, in.Number)
		if err != nil {
			return err
		}
		// A pending review's comments are invisible to the pull-request-wide
		// list, so a published draft would otherwise stay unrendered until the
		// review is submitted.
		pending, err := s.github.ListPendingReviews(ctx, in.Owner, in.Repo, in.Number)
		if err != nil {
			return err
		}
		for _, reviewID := range pending {
			draft, err := s.github.ListReviewCommentsForReview(ctx, in.Owner, in.Repo, in.Number, reviewID)
			if err != nil {
				return err
			}
			for index := range draft {
				draft[index].Pending = true
			}
			comments = append(comments, draft...)
		}
		result.Comments = mergeComments(comments)
		resolveDraftAnchors(result.Comments)
		return nil
	})
	if err != nil {
		return nil, s.providerError(err)
	}
	if result.Comments == nil {
		result.Comments = []github.InlineComment{}
	}
	return &commentsOutput{Body: result}, nil
}

// mergeComments drops duplicate ids (a pending comment is only expected once)
// and splits the hidden finding marker off Triage-authored bodies, so the
// webview never renders it.
func mergeComments(comments []github.InlineComment) []github.InlineComment {
	seen := make(map[int64]struct{}, len(comments))
	merged := make([]github.InlineComment, 0, len(comments))
	for _, comment := range comments {
		if _, duplicate := seen[comment.ID]; duplicate {
			continue
		}
		seen[comment.ID] = struct{}{}
		comment.FindingID, comment.Body = review.ParseFindingMarker(comment.Body)
		merged = append(merged, comment)
	}
	return merged
}

// resolveDraftAnchors fills line and side for comments on an unsubmitted
// review: GitHub returns both as null there, which would hide the thread from
// the diff. The payload's diff_hunk still ends on the commented line, so the
// anchor is recovered from it.
func resolveDraftAnchors(comments []github.InlineComment) {
	for index := range comments {
		comment := &comments[index]
		if !comment.Pending || comment.Line != 0 || comment.DiffHunk == "" {
			continue
		}
		kind, oldNumber, newNumber, ok := diff.HunkTailLine(comment.DiffHunk)
		if !ok {
			continue
		}
		switch kind {
		case "add":
			comment.Line, comment.Side = newNumber, "RIGHT"
		case "del":
			comment.Line, comment.Side = oldNumber, "LEFT"
		default:
			if comment.Side == "LEFT" {
				comment.Line = oldNumber
			} else {
				comment.Line, comment.Side = newNumber, "RIGHT"
			}
		}
		if comment.Line > 0 {
			comment.Outdated = false
		}
	}
}

// createComment serves POST /pr/{owner}/{repo}/{number}/comments.
func (s *Server) createComment(ctx context.Context, in *commentInput) (*okOutput, error) {
	body := strings.TrimSpace(in.Body.Body)
	if body == "" {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "a comment is required")
	}
	if len(body) > maxReviewBody {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "comment is too long")
	}
	path := strings.TrimSpace(in.Body.Path)
	if path == "" || len(path) > maxCommentPath {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "path is required")
	}
	if in.Body.Line <= 0 {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "line must be a positive integer")
	}
	side := strings.ToUpper(strings.TrimSpace(in.Body.Side))
	if side != github.CommentSideRight && side != github.CommentSideLeft {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "side must be RIGHT or LEFT")
	}
	commitID := strings.TrimSpace(in.Body.CommitID)
	if commitID == "" {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "commitId is required")
	}

	err := s.github.CreateReviewComment(ctx, in.Owner, in.Repo, in.Number, github.NewInlineComment{
		Body:     body,
		Path:     path,
		Line:     in.Body.Line,
		Side:     side,
		CommitID: commitID,
	})
	if err != nil {
		return nil, s.reviewError(err)
	}

	s.invalidateComments(in.Owner, in.Repo, in.Number)
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &okOutput{Body: okResponse{OK: true}}, nil
}

// deleteComment serves DELETE /pr/{owner}/{repo}/{number}/comments/{commentID}.
func (s *Server) deleteComment(ctx context.Context, in *deleteCommentInput) (*okOutput, error) {
	if err := s.github.DeleteReviewComment(ctx, in.Owner, in.Repo, in.CommentID); err != nil {
		return nil, s.reviewError(err)
	}

	s.invalidateComments(in.Owner, in.Repo, in.Number)
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &okOutput{Body: okResponse{OK: true}}, nil
}
