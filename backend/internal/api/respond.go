package api

import (
	"encoding/json"
	"net/http"
)

// writeJSON writes v as the response body. Marshaling happens before any write
// so a failure can still produce a clean error envelope.
func writeJSON(w http.ResponseWriter, status int, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"internal_error","message":"failed to encode response"}}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

// writeError writes the envelope outside Huma, for CORS, auth and the
// hand-written SSE route.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorEnvelope{Error: ErrorBody{Code: code, Message: message}})
}
