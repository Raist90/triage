package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/github"
)

const maxCommentPath = 4096

// handleComments serves GET and POST /pr/{owner}/{repo}/{number}/comments.
func (s *Server) handleComments(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.handleCommentsList(w, r, owner, repo, number)
	case http.MethodPost:
		s.handleCommentCreate(w, r, owner, repo, number)
	default:
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET and POST are allowed")
	}
}

func (s *Server) handleCommentsList(w http.ResponseWriter, r *http.Request, owner, repo string, number int) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}

	var result commentsResponse
	err := s.loadCached("pr-comments", vars, s.cfg.Cache.REST, isRefresh(r), &result, func() error {
		comments, err := s.github.ListReviewComments(r.Context(), owner, repo, number)
		if err != nil {
			return err
		}
		result.Comments = comments
		return nil
	})
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	if result.Comments == nil {
		result.Comments = []github.InlineComment{}
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCommentCreate(w http.ResponseWriter, r *http.Request, owner, repo string, number int) {
	var request commentRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxReviewBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid comment body")
		return
	}

	body := strings.TrimSpace(request.Body)
	if body == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "a comment is required")
		return
	}
	if len(body) > maxReviewBody {
		writeError(w, http.StatusBadRequest, codeBadRequest, "comment is too long")
		return
	}
	path := strings.TrimSpace(request.Path)
	if path == "" || len(path) > maxCommentPath {
		writeError(w, http.StatusBadRequest, codeBadRequest, "path is required")
		return
	}
	if request.Line <= 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "line must be a positive integer")
		return
	}
	side := strings.ToUpper(strings.TrimSpace(request.Side))
	if side != github.CommentSideRight && side != github.CommentSideLeft {
		writeError(w, http.StatusBadRequest, codeBadRequest, "side must be RIGHT or LEFT")
		return
	}
	commitID := strings.TrimSpace(request.CommitID)
	if commitID == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "commitId is required")
		return
	}

	err := s.github.CreateReviewComment(r.Context(), owner, repo, number, github.NewInlineComment{
		Body:     body,
		Path:     path,
		Line:     request.Line,
		Side:     side,
		CommitID: commitID,
	})
	if err != nil {
		s.writeReviewError(w, err)
		return
	}

	s.invalidateComments(owner, repo, number)
	s.invalidatePR(owner, repo, number)
	writeJSON(w, http.StatusOK, commentResponse{OK: true})
}

// handleCommentDelete serves DELETE /pr/{owner}/{repo}/{number}/comments/{id}.
func (s *Server) handleCommentDelete(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber, rawID string) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only DELETE is allowed")
		return
	}
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return
	}
	commentID, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || commentID <= 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "comment id must be a positive integer")
		return
	}

	if err := s.github.DeleteReviewComment(r.Context(), owner, repo, commentID); err != nil {
		s.writeReviewError(w, err)
		return
	}

	s.invalidateComments(owner, repo, number)
	s.invalidatePR(owner, repo, number)
	writeJSON(w, http.StatusOK, commentResponse{OK: true})
}

// invalidateComments drops the cached inline-comment list for one PR.
func (s *Server) invalidateComments(owner, repo string, number int) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}
	if key, err := cache.Key("github", "pr-comments", vars); err == nil {
		s.invalidateKey(key)
	}
}
