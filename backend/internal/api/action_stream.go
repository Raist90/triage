package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Raist90/triage/backend/internal/actions"
)

// handleActionStream serves GET .../actions/{actionID}/stream as SSE. The
// response is JSON lines prefixed with `data: `, one event per blank line.
func (s *Server) handleActionStream(w http.ResponseWriter, r *http.Request) {
	owner, repo := r.PathValue("owner"), r.PathValue("repo")
	if !repoSegmentPattern.MatchString(owner) || !repoSegmentPattern.MatchString(repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}
	number, ok := parseNumber(r.PathValue("number"))
	if !ok {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return
	}
	in := &actionInput{
		PRPath: PRPath{
			RepoPath: RepoPath{Owner: owner, Repo: repo},
			Number:   number,
		},
		ActionID: r.PathValue("actionID"),
	}

	action, tracked, err := s.resolveAction(in)
	if err != nil {
		s.writeActionStreamError(w, err)
		return
	}

	key := actions.JobKey(tracked.Owner, tracked.Name, in.Number, action.ID)
	events, done, unsubscribe, found := s.runner.Subscribe(key)
	if !found {
		writeError(w, http.StatusNotFound, codeNotFound, "action is not running")
		return
	}
	defer unsubscribe()

	controller := http.NewResponseController(w)
	// A job may run for five minutes; the server-wide WriteTimeout must not
	// cut the stream short.
	_ = controller.SetWriteDeadline(time.Time{})

	header := w.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_ = controller.Flush()

	writeEvent := func(event actions.Event) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, eventPayload(event)); err != nil {
			return false
		}
		return controller.Flush() == nil
	}

	for {
		select {
		case event := <-events:
			if !writeEvent(event) {
				return
			}
			if terminalEvent(event) {
				return
			}
		case <-done:
			for {
				select {
				case event := <-events:
					if !writeEvent(event) {
						return
					}
				default:
					return
				}
			}
		case <-r.Context().Done():
			return
		}
	}
}

func terminalEvent(event actions.Event) bool {
	return event.Type == "done" || event.Type == "error"
}

func eventPayload(event actions.Event) string {
	var payload any
	switch event.Type {
	case "status":
		payload = struct {
			Status string `json:"status"`
		}{Status: event.Status}
	case "delta":
		payload = struct {
			Text string `json:"text"`
		}{Text: event.Text}
	case "done":
		payload = struct {
			Artifact *actions.Artifact `json:"artifact"`
		}{Artifact: event.Artifact}
	default:
		payload = struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}{Code: event.Code, Message: event.Message}
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// writeActionStreamError writes an envelope error for the hand-written SSE
// route, which has no Huma context to return an error to.
func (s *Server) writeActionStreamError(w http.ResponseWriter, err error) {
	if apiErr, ok := err.(*apiError); ok {
		writeError(w, apiErr.GetStatus(), apiErr.ErrorEnvelope.Error.Code, apiErr.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, codeInternal, "The stream request failed")
}

// parseNumber validates the number path segment for the hand-written SSE route.
func parseNumber(raw string) (int, bool) {
	number := 0
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0, false
		}
		number = number*10 + int(r-'0')
		if number > 1<<30 {
			return 0, false
		}
	}
	if number <= 0 {
		return 0, false
	}
	return number, true
}
