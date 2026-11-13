package cache

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestKeyStableAndDistinct(t *testing.T) {
	type vars struct {
		Repo string
		Tab  string
	}

	a, err := Key("github", "prs", vars{Repo: "o/r", Tab: "mine"})
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	b, err := Key("github", "prs", vars{Repo: "o/r", Tab: "mine"})
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	if a != b {
		t.Fatalf("same input produced keys %q and %q", a, b)
	}

	c, err := Key("github", "prs", vars{Repo: "o/r", Tab: "review"})
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	if a == c {
		t.Fatal("different variables produced the same key")
	}

	d, err := Key("linear", "prs", vars{Repo: "o/r", Tab: "mine"})
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	if a == d {
		t.Fatal("different providers produced the same key")
	}
}

func TestKeyCanonicalizesMapOrder(t *testing.T) {
	first, err := Key("github", "prs", map[string]string{"a": "1", "b": "2"})
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	second, err := Key("github", "prs", map[string]string{"b": "2", "a": "1"})
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	if first != second {
		t.Fatal("map insertion order changed the key")
	}
}

func TestPutGetRoundTrip(t *testing.T) {
	c := New(t.TempDir())
	key, err := Key("github", "viewer", nil)
	if err != nil {
		t.Fatalf("Key: %v", err)
	}

	body := json.RawMessage(`{"login":"octocat"}`)
	if err := c.Put(key, Entry{Body: body, ETag: `"abc"`}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, ok := c.Get(key, time.Hour)
	if !ok {
		t.Fatal("Get missed a fresh entry")
	}
	if string(got.Body) != string(body) {
		t.Fatalf("body = %s, want %s", got.Body, body)
	}
	if got.ETag != `"abc"` {
		t.Fatalf("etag = %q, want %q", got.ETag, `"abc"`)
	}
	if got.FetchedAt.IsZero() {
		t.Fatal("FetchedAt was not set")
	}

	info, err := os.Stat(filepath.Join(c.Dir(), key+fileSuffix))
	if err != nil {
		t.Fatalf("stat entry: %v", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("entry mode = %v, want owner-only", info.Mode().Perm())
	}
}

func TestGetHonorsTTL(t *testing.T) {
	c := New(t.TempDir())
	key, err := Key("github", "viewer", nil)
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	if err := c.Put(key, Entry{
		Body:      json.RawMessage(`{"login":"octocat"}`),
		FetchedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	if _, ok := c.Get(key, time.Minute); ok {
		t.Fatal("Get returned an expired entry")
	}
	if _, ok := c.Get(key, 2*time.Hour); !ok {
		t.Fatal("Get missed an entry inside its TTL")
	}
}

func TestInvalidateRemovesOneEntry(t *testing.T) {
	c := New(t.TempDir())
	key, err := Key("github", "viewer", nil)
	if err != nil {
		t.Fatalf("Key: %v", err)
	}
	if err := c.Put(key, Entry{Body: json.RawMessage(`{}`)}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := c.Invalidate(key); err != nil {
		t.Fatalf("Invalidate: %v", err)
	}
	if _, ok := c.Get(key, time.Hour); ok {
		t.Fatal("entry survived invalidation")
	}
	if err := c.Invalidate(key); err != nil {
		t.Fatalf("Invalidate on missing entry: %v", err)
	}
}

func TestClearCountsEntries(t *testing.T) {
	c := New(t.TempDir())
	for i := 0; i < 3; i++ {
		key, err := Key("github", "route", i)
		if err != nil {
			t.Fatalf("Key: %v", err)
		}
		if err := c.Put(key, Entry{Body: json.RawMessage(`{}`)}); err != nil {
			t.Fatalf("Put: %v", err)
		}
	}

	cleared, err := c.Clear()
	if err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if cleared != 3 {
		t.Fatalf("cleared = %d, want 3", cleared)
	}

	cleared, err = c.Clear()
	if err != nil {
		t.Fatalf("second Clear: %v", err)
	}
	if cleared != 0 {
		t.Fatalf("cleared = %d on empty cache, want 0", cleared)
	}
}

func TestClearMissingDirectory(t *testing.T) {
	c := New(filepath.Join(t.TempDir(), "does-not-exist"))
	cleared, err := c.Clear()
	if err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if cleared != 0 {
		t.Fatalf("cleared = %d, want 0", cleared)
	}
}
