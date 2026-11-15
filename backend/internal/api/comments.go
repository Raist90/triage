package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/github"
)

const maxCommentPath = 4096

// listComments serves GET /pr/{owner}/{repo}/{number}/comments.
func (s *Server) listComments(ctx context.Context, in *commentsInput) (*commentsOutput, error) {
	vars := prVars{Owner: in.Owner, Repo: in.Repo, Number: in.Number}

	var result commentsResponse
	err := s.loadCached("pr-comments", vars, s.cfg.Cache.REST, in.Refresh, &result, func() error {
		comments, err := s.github.ListReviewComments(ctx, in.Owner, in.Repo, in.Number)
		if err != nil {
			return err
		}
		result.Comments = comments
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

// invalidateComments drops the cached inline-comment list for one PR.
func (s *Server) invalidateComments(owner, repo string, number int) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}
	if key, err := cache.Key("github", "pr-comments", vars); err == nil {
		s.invalidateKey(key)
	}
}
