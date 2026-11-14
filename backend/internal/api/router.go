package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/actions"
	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/worktree"
)

// allowedOrigins are the only origins the webview can use: the Vite dev server
// and the two Tauri origins.
var allowedOrigins = map[string]struct{}{
	"http://localhost:1420":   {},
	"tauri://localhost":       {},
	"https://tauri.localhost": {},
}

// Server holds the dependencies handed to every handler.
type Server struct {
	cfg       config.Config
	cache     *cache.Cache
	github    *github.Client
	runner    *actions.Runner
	artifacts *actions.Store
	worktrees *worktree.Manager
	token     [sha256.Size]byte
	logger    *slog.Logger
}

// NewServer builds the API server. token is the per-process bearer token; only
// its hash is retained.
func NewServer(cfg config.Config, c *cache.Cache, gh *github.Client, runner *actions.Runner, artifacts *actions.Store, worktrees *worktree.Manager, token string, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{
		cfg:       cfg,
		cache:     c,
		github:    gh,
		runner:    runner,
		artifacts: artifacts,
		worktrees: worktrees,
		token:     sha256.Sum256([]byte(token)),
		logger:    logger,
	}
}

// Handler returns the fully wrapped HTTP handler: CORS, then bearer auth, then
// routing.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/config", s.handleConfig)
	mux.HandleFunc("/cache/invalidate", s.handleCacheInvalidate)
	mux.HandleFunc("/artifacts/clear", s.handleArtifactsClear)
	mux.HandleFunc("/prs", s.handlePRs)
	mux.HandleFunc("/pr/", s.handlePR)
	mux.HandleFunc("/", s.handleNotFound)
	return cors(s.requireToken(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
		return
	}
	writeJSON(w, http.StatusOK, healthResponse{OK: true})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.configView(r.Context()))
}

func (s *Server) handleArtifactsClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	if s.runner == nil {
		writeError(w, http.StatusServiceUnavailable, codeInternal, "actions are not configured")
		return
	}
	cleared, err := s.runner.ClearArtifacts()
	if err != nil {
		s.logger.Error("artifact clear failed", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "failed to clear artifacts")
		return
	}
	writeJSON(w, http.StatusOK, artifactsClearResponse{Cleared: cleared})
}

func (s *Server) handleCacheInvalidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	cleared, err := s.cache.Clear()
	if err != nil {
		s.logger.Error("cache invalidation failed", "err", err)
		writeError(w, http.StatusInternalServerError, codeCache, "failed to clear cache")
		return
	}
	writeJSON(w, http.StatusOK, cacheInvalidateResponse{Cleared: cleared})
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, codeNotFound, "route not found")
}

// requireToken enforces the bearer token on every route except GET /health. It
// compares fixed-size hashes so the comparison is constant time for any input
// length.
func (s *Server) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		provided := bearerToken(r.Header.Get("Authorization"))
		given := sha256.Sum256([]byte(provided))
		if subtle.ConstantTimeCompare(given[:], s.token[:]) != 1 {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "missing or invalid bearer token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

// cors answers preflights and adds headers only for the three known origins.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		_, allowed := allowedOrigins[origin]
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}

		if r.Method == http.MethodOptions {
			if allowed {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
