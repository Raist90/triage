package api

import (
	"context"
	"encoding/json"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/diff"
)

// loadDiff returns the raw unified diff for one head commit, cached by ETag. A
// refresh revalidates with the cached ETag, so an unchanged diff is a cheap
// 304. The entry records the commit it was fetched for; a moved head can never
// be answered from an older commit's body. The key stays per pull request so
// the cache keeps one entry, not one per commit.
func (s *Server) loadDiff(ctx context.Context, owner, repo string, number int, sha string, refresh bool) ([]byte, error) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}

	key, err := cache.Key("github", "diff", vars)
	if err != nil {
		result, fetchErr := s.github.Diff(ctx, owner, repo, number, "")
		if fetchErr != nil {
			return nil, fetchErr
		}
		return result.Body, nil
	}

	entry, fresh := s.cache.Get(key, s.cfg.Cache.REST)
	if fresh && !refresh && entry.SHA == sha {
		if body, ok := decodeRawDiff(entry.Body); ok {
			return body, nil
		}
	}

	// A stale entry still supplies a validator, turning an expired diff into a
	// cheap 304 instead of a full download.
	etag := ""
	body := []byte(nil)
	if entry != nil {
		etag = entry.ETag
		body, _ = decodeRawDiff(entry.Body)
	}
	result, err := s.github.Diff(ctx, owner, repo, number, etag)
	if err != nil {
		return nil, err
	}
	if !result.NotModified {
		body = result.Body
	}
	if err := s.cache.Put(key, cache.Entry{Body: encodeRawDiff(body), ETag: result.ETag, SHA: sha}); err != nil {
		s.logger.Warn("cache write failed", "err", err)
	}
	return body, nil
}

// buildDiffResponse parses the unified diff, annotates it with sem where
// available and ranks the files for review.
func buildDiffResponse(ctx context.Context, body []byte, sha string) diff.Response {
	files := diff.Parse(body)
	report, available := diff.Semantic(ctx, body)
	for index := range files {
		files[index].Kinds = diff.Kinds(files[index].Path)
		files[index].Semantic = report.Changes[files[index].Path]
		if !files[index].Binary {
			files[index].Hunks = diff.BuildHunksFor(files[index].Path, files[index].Patch)
			diff.Highlight(files[index].Path, files[index].Hunks)
		}
	}
	diff.Prioritize(files)
	response := diff.Response{
		HeadSHA:           sha,
		Files:             files,
		SemanticAvailable: available,
		Complexity:        diff.ComplexityFor(files),
		Walkthrough:       diff.BuildWalkthrough(files),
	}
	if available {
		summary := report.Summary
		response.SemanticSummary = &summary
	}
	return response
}

// encodeRawDiff stores a non-JSON diff as a JSON string so the cache entry
// stays valid JSON. decodeRawDiff is the inverse.
func encodeRawDiff(body []byte) json.RawMessage {
	encoded, err := json.Marshal(string(body))
	if err != nil {
		return nil
	}
	return encoded
}

func decodeRawDiff(raw json.RawMessage) ([]byte, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var body string
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, false
	}
	return []byte(body), true
}
