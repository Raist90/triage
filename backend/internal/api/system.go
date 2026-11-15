package api

import (
	"context"
	"net/http"
)

// getHealth is the one unauthenticated route; the auth middleware exempts it.
func (s *Server) getHealth(context.Context, *struct{}) (*okOutput, error) {
	return &okOutput{Body: okResponse{OK: true}}, nil
}

// getConfig derives what the webview may know: no models, no prompts.
func (s *Server) getConfig(ctx context.Context, _ *struct{}) (*configOutput, error) {
	return &configOutput{Body: s.configView(ctx)}, nil
}

func (s *Server) invalidateCacheHandler(context.Context, *struct{}) (*clearedOutput, error) {
	cleared, err := s.cache.Clear()
	if err != nil {
		s.logger.Error("cache invalidation failed", "err", err)
		return nil, errorf(http.StatusInternalServerError, codeCache, "failed to clear cache")
	}
	return &clearedOutput{Body: clearedResponse{Cleared: cleared}}, nil
}

func (s *Server) clearArtifactsHandler(context.Context, *struct{}) (*clearedOutput, error) {
	if s.runner == nil {
		return nil, errorf(http.StatusServiceUnavailable, codeInternal, "actions are not configured")
	}
	cleared, err := s.runner.ClearArtifacts()
	if err != nil {
		s.logger.Error("artifact clear failed", "err", err)
		return nil, errorf(http.StatusInternalServerError, codeInternal, "failed to clear artifacts")
	}
	return &clearedOutput{Body: clearedResponse{Cleared: cleared}}, nil
}

func (s *Server) clearWorktreesHandler(ctx context.Context, _ *struct{}) (*clearedOutput, error) {
	if s.worktrees == nil {
		return nil, errorf(http.StatusServiceUnavailable, codeInternal, "worktrees are not configured")
	}
	cleared, err := s.worktrees.Clear(ctx, s.cfg.Repos)
	if err != nil {
		s.logger.Error("worktree clear failed", "err", err)
		return nil, errorf(http.StatusInternalServerError, codeInternal, "failed to clear worktrees")
	}
	return &clearedOutput{Body: clearedResponse{Cleared: cleared}}, nil
}
