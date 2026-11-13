// Package cache stores provider responses as JSON files under ~/.triage/cache,
// one file per stable key. TTLs come from config.
package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const fileSuffix = ".json"

// Entry is one cached response.
type Entry struct {
	Body      json.RawMessage `json:"body"`
	ETag      string          `json:"etag,omitempty"`
	FetchedAt time.Time       `json:"fetchedAt"`
}

// Cache is a directory of cache entries.
type Cache struct {
	dir string
}

// DefaultDir is ~/.triage/cache.
func DefaultDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cache: resolve home directory: %w", err)
	}
	return filepath.Join(home, ".triage", "cache"), nil
}

// New returns a cache rooted at dir. The directory is created on first write.
func New(dir string) *Cache {
	return &Cache{dir: dir}
}

// Dir is the cache root.
func (c *Cache) Dir() string {
	return c.dir
}

// Key is the sha256 of provider + route + canonical vars JSON. Stable across
// runs: maps marshal with sorted keys.
func Key(provider, route string, vars any) (string, error) {
	varsJSON, err := json.Marshal(vars)
	if err != nil {
		return "", fmt.Errorf("cache: encode variables: %w", err)
	}
	h := sha256.New()
	h.Write([]byte(provider))
	h.Write([]byte{0})
	h.Write([]byte(route))
	h.Write([]byte{0})
	h.Write(varsJSON)
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Get returns a fresh entry. A missing, unreadable or expired entry is a miss.
func (c *Cache) Get(key string, ttl time.Duration) (*Entry, bool) {
	data, err := os.ReadFile(c.path(key))
	if err != nil {
		return nil, false
	}
	var entry Entry
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, false
	}
	if ttl > 0 && time.Since(entry.FetchedAt) > ttl {
		return nil, false
	}
	return &entry, true
}

// Put writes an entry atomically. FetchedAt is set when zero.
func (c *Cache) Put(key string, entry Entry) error {
	if entry.FetchedAt.IsZero() {
		entry.FetchedAt = time.Now().UTC()
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("cache: encode entry: %w", err)
	}
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return fmt.Errorf("cache: create directory: %w", err)
	}

	tmp, err := os.CreateTemp(c.dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("cache: create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("cache: write entry: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("cache: write entry: %w", err)
	}
	if err := os.Rename(tmpName, c.path(key)); err != nil {
		return fmt.Errorf("cache: commit entry: %w", err)
	}
	return nil
}

// Invalidate deletes one entry. A missing entry is not an error.
func (c *Cache) Invalidate(key string) error {
	if err := os.Remove(c.path(key)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("cache: invalidate entry: %w", err)
	}
	return nil
}

// Clear removes every entry and reports how many were removed. A missing cache
// directory yields zero.
func (c *Cache) Clear() (int, error) {
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, fmt.Errorf("cache: read directory: %w", err)
	}

	cleared := 0
	var firstErr error
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), fileSuffix) {
			continue
		}
		if err := os.Remove(filepath.Join(c.dir, entry.Name())); err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("cache: clear entry: %w", err)
			}
			continue
		}
		cleared++
	}
	return cleared, firstErr
}

func (c *Cache) path(key string) string {
	return filepath.Join(c.dir, key+fileSuffix)
}
