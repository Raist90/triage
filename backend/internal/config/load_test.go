package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), appDirName, fileName)
	if err := os.MkdirAll(filepath.Dir(path), configDirMode); err != nil {
		t.Fatalf("create config dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), configFileMode); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoadMissingFileCreatesTemplate(t *testing.T) {
	path := filepath.Join(t.TempDir(), appDirName, "nested", fileName)

	cfg := Load(path)

	if cfg.Problem != "" {
		t.Fatalf("problem = %q, want empty", cfg.Problem)
	}
	if cfg.Source != path {
		t.Fatalf("source = %q, want %q", cfg.Source, path)
	}
	if len(cfg.Repos) != 0 {
		t.Fatalf("repos = %v, want empty", cfg.Repos)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("template not created: %v", err)
	}
	if mode := info.Mode().Perm(); mode != configFileMode {
		t.Fatalf("mode = %o, want %o", mode, configFileMode)
	}

	// The template must load cleanly, otherwise first run always reports a problem.
	again := Load(path)
	if again.Problem != "" {
		t.Fatalf("template problem = %q, want empty", again.Problem)
	}
}

func TestLoadEmptyObjectKeepsDefaults(t *testing.T) {
	cfg := Load(writeConfig(t, `{}`))

	if cfg.Problem != "" {
		t.Fatalf("problem = %q, want empty", cfg.Problem)
	}
	if len(cfg.Tabs) != 3 {
		t.Fatalf("tabs = %v, want 3 defaults", cfg.Tabs)
	}
	if cfg.Cache.GraphQL == 0 || cfg.Cache.REST == 0 {
		t.Fatalf("cache TTLs were not defaulted: %+v", cfg.Cache)
	}
	if len(cfg.Actions.Items) != 1 {
		t.Fatalf("actions = %v, want the explain default", cfg.Actions.Items)
	}
}

func TestLoadRepos(t *testing.T) {
	cfg := Load(writeConfig(t, `{
		"repos": ["Acme/Web", "acme/api"]
	}`))

	if cfg.Problem != "" {
		t.Fatalf("problem = %q, want empty", cfg.Problem)
	}
	want := []Repo{{Owner: "Acme", Name: "Web"}, {Owner: "acme", Name: "api"}}
	if len(cfg.Repos) != len(want) {
		t.Fatalf("repos = %v, want %v", cfg.Repos, want)
	}
	for i := range want {
		if cfg.Repos[i] != want[i] {
			t.Fatalf("repos[%d] = %+v, want %+v", i, cfg.Repos[i], want[i])
		}
	}
	// Keys the file omits keep their defaults.
	if len(cfg.Tabs) != 3 {
		t.Fatalf("tabs = %v, want 3 defaults", cfg.Tabs)
	}
}

func TestLoadPartialFile(t *testing.T) {
	cfg := Load(writeConfig(t, `{
		"user": { "login": "octocat", "name": "The Octocat" },
		"linear": { "teamKeys": ["ENG", "OPS"] }
	}`))

	if cfg.Problem != "" {
		t.Fatalf("problem = %q, want empty", cfg.Problem)
	}
	if cfg.User.Login != "octocat" || cfg.User.Name != "The Octocat" {
		t.Fatalf("user = %+v", cfg.User)
	}
	if strings.Join(cfg.Linear.TeamKeys, ",") != "ENG,OPS" {
		t.Fatalf("teamKeys = %v", cfg.Linear.TeamKeys)
	}
	if cfg.Repos == nil || len(cfg.Repos) != 0 {
		t.Fatalf("repos = %v, want an empty non-nil slice", cfg.Repos)
	}
}

func TestLoadEmptyTeamKeysIsNotNil(t *testing.T) {
	cfg := Load(writeConfig(t, `{ "linear": { "teamKeys": [] } }`))

	if cfg.Linear.TeamKeys == nil {
		t.Fatal("teamKeys = nil, want an empty slice so the JSON stays an array")
	}
}

func TestLoadInvalidJSONKeepsDefaults(t *testing.T) {
	cfg := Load(writeConfig(t, `{ "repos": [ }`))

	if cfg.Problem == "" {
		t.Fatal("problem = empty, want a parse error")
	}
	if len(cfg.Tabs) != 3 {
		t.Fatalf("tabs = %v, want defaults to survive a bad file", cfg.Tabs)
	}
	if len(cfg.Repos) != 0 {
		t.Fatalf("repos = %v, want empty", cfg.Repos)
	}
}

func TestLoadTrailingDataIsRejected(t *testing.T) {
	cfg := Load(writeConfig(t, `{} {}`))

	if !strings.Contains(cfg.Problem, "trailing data") {
		t.Fatalf("problem = %q, want a trailing data error", cfg.Problem)
	}
}

func TestLoadUnknownFieldIsRejected(t *testing.T) {
	cfg := Load(writeConfig(t, `{ "repo": ["acme/web"] }`))

	if !strings.Contains(cfg.Problem, "unknown field") {
		t.Fatalf("problem = %q, want an unknown field error", cfg.Problem)
	}
}

func TestLoadMalformedRepos(t *testing.T) {
	cfg := Load(writeConfig(t, `{
		"repos": ["acme/web", "noslash", "/name", "owner/", "a/b/c", "  "]
	}`))

	if !strings.Contains(cfg.Problem, "repos[1]") {
		t.Fatalf("problem = %q, want the bad entries named", cfg.Problem)
	}
	if len(cfg.Repos) != 1 || cfg.Repos[0] != (Repo{Owner: "acme", Name: "web"}) {
		t.Fatalf("repos = %v, want only the valid entry", cfg.Repos)
	}
}

func TestLoadDuplicateReposAreDropped(t *testing.T) {
	cfg := Load(writeConfig(t, `{
		"repos": ["acme/web", "Acme/Web", "acme/api"]
	}`))

	if cfg.Problem != "" {
		t.Fatalf("problem = %q, want empty", cfg.Problem)
	}
	if len(cfg.Repos) != 2 {
		t.Fatalf("repos = %v, want 2 after dedupe", cfg.Repos)
	}
}

func TestLoadEmptyRepoList(t *testing.T) {
	cfg := Load(writeConfig(t, `{ "repos": [] }`))

	if cfg.Problem != "" {
		t.Fatalf("problem = %q, want empty", cfg.Problem)
	}
	if len(cfg.Repos) != 0 {
		t.Fatalf("repos = %v, want empty", cfg.Repos)
	}
}

func TestDefaultPathIsUnderHome(t *testing.T) {
	path, err := DefaultPath()
	if err != nil {
		t.Fatalf("DefaultPath: %v", err)
	}
	if !strings.HasSuffix(path, filepath.Join(appDirName, fileName)) {
		t.Fatalf("path = %q, want it to end with %s/%s", path, appDirName, fileName)
	}
}
