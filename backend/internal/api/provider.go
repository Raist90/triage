package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/Raist90/triage/backend/internal/gql"
)

// providerError maps provider failures to safe API envelopes. Provider bodies
// and tokens never reach the webview.
func (s *Server) providerError(err error) error {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Status == http.StatusNotFound {
			return errorf(http.StatusNotFound, codeNotFound, apiErr.Message)
		}
		s.logger.Warn("github request failed", "message", apiErr.Message, "status", apiErr.Status)
		return errorf(http.StatusBadGateway, codeGitHub, apiErr.Message)
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		// The webview went away; the response is never read.
		return errorf(http.StatusGatewayTimeout, codeGitHub, "GitHub request canceled")
	}
	s.logger.Error("github request failed", "err", err)
	return errorf(http.StatusBadGateway, codeGitHub, "GitHub request failed")
}

// reviewError maps GitHub's validation failures (e.g. approving your own PR) to
// 400 instead of a misleading 502.
func (s *Server) reviewError(err error) error {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusUnprocessableEntity {
		return errorf(http.StatusBadRequest, codeBadRequest, apiErr.Message)
	}
	return s.providerError(err)
}
