package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/omnidiff"
)

const (
	// omnidiffWorkers bounds concurrent CLI invocations. Each one is a Rust
	// process; four keeps a large PR responsive without starving the sidecar.
	omnidiffWorkers = 4
	// omnidiffMaxFiles caps one request. Files past the cap are named, not
	// dropped silently.
	omnidiffMaxFiles = 60
	// omnidiffRequestTimeout bounds the whole request, including blob fetches.
	omnidiffRequestTimeout = 90 * time.Second
)

// omnidiffResponse is the route payload. Available is false when the CLI is
// missing or the PR has no commit pair to diff.
type omnidiffResponse struct {
	Available bool           `json:"available"`
	Reason    string         `json:"reason,omitempty"`
	Files     []omnidiffFile `json:"files"`
	Truncated bool           `json:"truncated,omitempty"`
}

// omnidiffFile is one changed file, rendered by the CLI.
type omnidiffFile struct {
	Path      string             `json:"path"`
	Status    string             `json:"status"`
	Additions int                `json:"additions"`
	Deletions int                `json:"deletions"`
	Summary   []omnidiff.Line    `json:"summary,omitempty"`
	Sections  []omnidiff.Section `json:"sections,omitempty"`
	// Skipped names why a file was not rendered. Error is a render failure.
	Skipped string `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

// handlePROmnidiff serves GET /pr/{owner}/{repo}/{n}/omnidiff.
func (s *Server) handlePROmnidiff(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
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

	if !omnidiff.Available() {
		writeJSON(w, http.StatusOK, omnidiffResponse{
			Available: false,
			Reason:    "omnidiff CLI not found",
			Files:     []omnidiffFile{},
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), omnidiffRequestTimeout)
	defer cancel()

	var pr github.PR
	if err := s.loadPRDetail(ctx, owner, repo, number, false, &pr); err != nil {
		s.writeProviderError(w, err)
		return
	}
	if pr.BaseSHA == "" || pr.HeadSHA == "" {
		writeJSON(w, http.StatusOK, omnidiffResponse{
			Available: false,
			Reason:    "this pull request has no commit pair to diff",
			Files:     []omnidiffFile{},
		})
		return
	}

	unified, err := s.loadDiff(ctx, owner, repo, number, false)
	if err != nil {
		s.writeProviderError(w, err)
		return
	}

	files := diff.Parse(unified)
	for index := range files {
		files[index].Kinds = diff.Kinds(files[index].Path)
	}
	// Prioritize falls back to churn without sem, so the most interesting files
	// are rendered first and win the budget.
	diff.Prioritize(files)
	sort.SliceStable(files, func(i, j int) bool {
		left, right := 0, 0
		if files[i].Review != nil {
			left = files[i].Review.Score
		}
		if files[j].Review != nil {
			right = files[j].Review.Score
		}
		if left != right {
			return left > right
		}
		return files[i].Path < files[j].Path
	})

	baseTree, baseErr := s.loadTree(ctx, owner, repo, pr.BaseSHA)
	headTree, headErr := s.loadTree(ctx, owner, repo, pr.HeadSHA)

	response := omnidiffResponse{
		Available: true,
		Files:     make([]omnidiffFile, len(files)),
	}
	if baseErr != nil || headErr != nil {
		response.Reason = "GitHub file listing is unavailable"
	}

	dir, err := os.MkdirTemp("", "triage-omnidiff-*")
	if err != nil {
		s.logger.Error("omnidiff temp dir failed", "err", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not prepare the diff")
		return
	}
	defer os.RemoveAll(dir)

	jobs := make([]omnidiffJob, 0, len(files))
	for index := range files {
		file := files[index]
		if index >= omnidiffMaxFiles {
			response.Truncated = true
			response.Files[index] = omnidiffFile{
				Path:      file.Path,
				Status:    file.Status,
				Additions: file.Additions,
				Deletions: file.Deletions,
				Skipped:   fmt.Sprintf("file budget reached (%d files)", omnidiffMaxFiles),
			}
			continue
		}
		jobs = append(jobs, omnidiffJob{
			index:    index,
			file:     file,
			baseTree: baseTree,
			headTree: headTree,
			treeErr:  baseErr != nil || headErr != nil,
		})
	}

	sem := make(chan struct{}, omnidiffWorkers)
	var wait sync.WaitGroup
	for _, job := range jobs {
		wait.Add(1)
		go func(job omnidiffJob) {
			defer wait.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				response.Files[job.index] = omnidiffFile{
					Path:      job.file.Path,
					Status:    job.file.Status,
					Additions: job.file.Additions,
					Deletions: job.file.Deletions,
					Error:     "timed out",
				}
				return
			}
			response.Files[job.index] = s.renderOmnidiffFile(ctx, owner, repo, dir, job)
		}(job)
	}
	wait.Wait()

	writeJSON(w, http.StatusOK, response)
}

type omnidiffJob struct {
	index    int
	file     diff.File
	baseTree github.TreeResult
	headTree github.TreeResult
	treeErr  bool
}

// renderOmnidiffFile materializes both sides and runs the CLI. Every failure is
// local to one file: the rest of the PR still renders.
func (s *Server) renderOmnidiffFile(ctx context.Context, owner, repo, dir string, job omnidiffJob) omnidiffFile {
	result := omnidiffFile{
		Path:      job.file.Path,
		Status:    job.file.Status,
		Additions: job.file.Additions,
		Deletions: job.file.Deletions,
	}
	if job.file.Binary {
		result.Skipped = "binary file"
		return result
	}
	if job.treeErr {
		result.Skipped = "GitHub file listing is unavailable"
		return result
	}
	if ctx.Err() != nil {
		result.Error = "timed out"
		return result
	}

	beforePath := job.file.Path
	if job.file.OldPath != "" {
		beforePath = job.file.OldPath
	}
	afterPath := job.file.Path

	beforeEntry, beforeFound := job.baseTree.Entries[beforePath]
	afterEntry, afterFound := job.headTree.Entries[afterPath]
	if !beforeFound && job.file.Status != "added" {
		result.Skipped = "not in the base commit"
		return result
	}
	if !afterFound && job.file.Status != "removed" {
		result.Skipped = "not in the head commit"
		return result
	}
	if tooLarge(beforeEntry) || tooLarge(afterEntry) {
		result.Skipped = "file too large to diff"
		return result
	}

	before, err := s.sideBytes(ctx, owner, repo, beforeEntry, beforeFound)
	if err != nil {
		result.Error = "could not load the base file"
		s.logger.Warn("omnidiff base blob failed", "path", beforePath, "err", err)
		return result
	}
	after, err := s.sideBytes(ctx, owner, repo, afterEntry, afterFound)
	if err != nil {
		result.Error = "could not load the head file"
		s.logger.Warn("omnidiff head blob failed", "path", afterPath, "err", err)
		return result
	}

	version := omnidiff.Version()
	key, keyErr := cache.Key("omnidiff", "file", struct {
		Before  string `json:"before"`
		After   string `json:"after"`
		BeforeE string `json:"beforeExt"`
		AfterE  string `json:"afterExt"`
		Version string `json:"version"`
	}{
		Before:  sideSHA(beforeEntry, beforeFound),
		After:   sideSHA(afterEntry, afterFound),
		BeforeE: filepath.Ext(beforePath),
		AfterE:  filepath.Ext(afterPath),
		Version: version,
	})
	if keyErr == nil {
		if entry, ok := s.cache.Get(key, s.cfg.Cache.Omnidiff); ok {
			var rendered omnidiff.Result
			if err := json.Unmarshal(entry.Body, &rendered); err == nil {
				result.Summary = rendered.Summary
				result.Sections = rendered.Sections
				return result
			}
		}
	}

	beforeFile, err := writeSide(dir, "before", job.index, beforePath, before)
	if err != nil {
		result.Error = "could not prepare the base file"
		return result
	}
	afterFile, err := writeSide(dir, "after", job.index, afterPath, after)
	if err != nil {
		result.Error = "could not prepare the head file"
		return result
	}

	rendered, err := omnidiff.Run(ctx, beforeFile, afterFile)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Summary = rendered.Summary
	result.Sections = rendered.Sections

	if keyErr == nil {
		if body, err := json.Marshal(rendered); err == nil {
			if err := s.cache.Put(key, cache.Entry{Body: body}); err != nil {
				s.logger.Warn("omnidiff cache write failed", "err", err)
			}
		}
	}
	return result
}

func (s *Server) sideBytes(ctx context.Context, owner, repo string, entry github.TreeEntry, found bool) ([]byte, error) {
	if !found || entry.SHA == "" {
		return []byte{}, nil
	}
	key, err := cache.Key("github", "blob", struct {
		Owner string `json:"owner"`
		Repo  string `json:"repo"`
		SHA   string `json:"sha"`
	}{Owner: owner, Repo: repo, SHA: entry.SHA})
	if err != nil {
		return s.github.Blob(ctx, owner, repo, entry.SHA)
	}

	if cached, ok := s.cache.Get(key, s.cfg.Cache.Blob); ok {
		if body, ok := decodeBytes(cached.Body); ok {
			return body, nil
		}
	}
	body, err := s.github.Blob(ctx, owner, repo, entry.SHA)
	if err != nil {
		return nil, err
	}
	if encoded, err := encodeBytes(body); err == nil {
		if err := s.cache.Put(key, cache.Entry{Body: encoded}); err != nil {
			s.logger.Warn("blob cache write failed", "err", err)
		}
	}
	return body, nil
}

// loadTree caches the recursive listing. GitHub caps it at 100k entries; a
// truncated listing still names the files it listed, so a missing path is
// reported per file rather than failing the request.
func (s *Server) loadTree(ctx context.Context, owner, repo, sha string) (github.TreeResult, error) {
	key, err := cache.Key("github", "tree", struct {
		Owner string `json:"owner"`
		Repo  string `json:"repo"`
		SHA   string `json:"sha"`
	}{Owner: owner, Repo: repo, SHA: sha})
	if err != nil {
		return s.github.Tree(ctx, owner, repo, sha)
	}
	if entry, ok := s.cache.Get(key, s.cfg.Cache.Blob); ok {
		var cached github.TreeResult
		if err := json.Unmarshal(entry.Body, &cached); err == nil {
			return cached, nil
		}
	}
	tree, err := s.github.Tree(ctx, owner, repo, sha)
	if err != nil {
		return github.TreeResult{}, err
	}
	if body, err := json.Marshal(tree); err == nil {
		if err := s.cache.Put(key, cache.Entry{Body: body}); err != nil {
			s.logger.Warn("tree cache write failed", "err", err)
		}
	}
	return tree, nil
}

func writeSide(dir, side string, index int, path string, content []byte) (string, error) {
	target := filepath.Join(dir, side)
	if err := os.MkdirAll(target, 0o700); err != nil {
		return "", err
	}
	name := filepath.Base(path)
	if name == "." || name == "/" || name == "" {
		name = "file"
	}
	file := filepath.Join(target, fmt.Sprintf("%04d-%s", index, name))
	if err := os.WriteFile(file, content, 0o600); err != nil {
		return "", err
	}
	return file, nil
}

func tooLarge(entry github.TreeEntry) bool {
	return entry.Size > 2<<20
}

func sideSHA(entry github.TreeEntry, found bool) string {
	if !found {
		return "empty"
	}
	return entry.SHA
}

func encodeBytes(content []byte) (json.RawMessage, error) {
	encoded, err := json.Marshal(base64.StdEncoding.EncodeToString(content))
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func decodeBytes(raw json.RawMessage) ([]byte, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err != nil {
		return nil, false
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, false
	}
	return content, true
}
