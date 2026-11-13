package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("create dir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestRepoRootFromSubdirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, dotEnvExample), "GITHUB_TOKEN=\n")
	nested := filepath.Join(root, "backend", "internal", "config")

	found, ok := repoRoot(nested)
	if !ok {
		t.Fatal("repoRoot did not find the marker")
	}
	if found != root {
		t.Fatalf("root = %q, want %q", found, root)
	}
}

func TestRepoRootFromRoot(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, dotEnvExample), "GITHUB_TOKEN=\n")

	found, ok := repoRoot(root)
	if !ok || found != root {
		t.Fatalf("root = %q ok = %v, want %q", found, ok, root)
	}
}

func TestRepoRootNotFound(t *testing.T) {
	dir := t.TempDir()

	root, ok := repoRoot(dir)
	if ok {
		// A real ancestor of the temp directory holds a .env.example. Nothing to
		// assert about the temp tree itself.
		if root == dir {
			t.Fatalf("reported %q as a repo root but it has no marker", dir)
		}
		t.Skipf("ancestor %q has a .env.example", root)
	}
}

func TestRepoRootIgnoresDotEnvWithoutExample(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, dotEnvFile), "GITHUB_TOKEN=x\n")

	if found, ok := repoRoot(root); ok && found == root {
		t.Fatalf("found %q as a root without .env.example", root)
	}
}

func TestLoadTokensReadsRepoRootFromNestedCwd(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, dotEnvExample), "GITHUB_TOKEN=\nLINEAR_API_KEY=\n")
	writeFile(t, filepath.Join(root, dotEnvFile), "GITHUB_TOKEN=gh-token\nLINEAR_API_KEY=lin-key\n")
	nested := filepath.Join(root, "backend", "cmd")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatalf("create nested dir: %v", err)
	}
	t.Chdir(nested)

	tokens := loadTokens(func() string {
		t.Fatal("gh fallback was used even though .env has a token")
		return ""
	})

	if tokens.GitHub != "gh-token" || tokens.Linear != "lin-key" {
		t.Fatalf("tokens = %+v, want the values from .env", tokens)
	}
	if want := filepath.Join(root, dotEnvFile); tokens.Source != want {
		t.Fatalf("source = %q, want %q", tokens.Source, want)
	}
}

func TestLoadTokensFallsBackWhenEnvMissing(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, dotEnvExample), "GITHUB_TOKEN=\n")
	t.Chdir(root)

	tokens := loadTokens(func() string { return "from-gh" })

	if tokens.GitHub != "from-gh" {
		t.Fatalf("github = %q, want the gh fallback", tokens.GitHub)
	}
	if tokens.Linear != "" {
		t.Fatalf("linear = %q, want empty", tokens.Linear)
	}
	if tokens.Source != "" {
		t.Fatalf("source = %q, want empty when no file was read", tokens.Source)
	}
}

func TestLoadTokensPrefersEnvOverGh(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, dotEnvExample), "GITHUB_TOKEN=\n")
	writeFile(t, filepath.Join(root, dotEnvFile), "GITHUB_TOKEN=from-env\n")
	t.Chdir(root)

	tokens := loadTokens(func() string { return "from-gh" })

	if tokens.GitHub != "from-env" {
		t.Fatalf("github = %q, want the .env value", tokens.GitHub)
	}
}

func TestParseDotEnv(t *testing.T) {
	cases := []struct {
		name string
		body string
		want map[string]string
	}{
		{
			name: "plain pairs",
			body: "A=1\nB=two\n",
			want: map[string]string{"A": "1", "B": "two"},
		},
		{
			name: "spaces around key and value",
			body: "  A  =  1  \n",
			want: map[string]string{"A": "1"},
		},
		{
			name: "comments and blank lines",
			body: "# a comment\n\nA=1\n   # indented comment\n",
			want: map[string]string{"A": "1"},
		},
		{
			name: "double quotes",
			body: `TOKEN="a b c"` + "\n",
			want: map[string]string{"TOKEN": "a b c"},
		},
		{
			name: "single quotes",
			body: "TOKEN='a b'\n",
			want: map[string]string{"TOKEN": "a b"},
		},
		{
			name: "empty value",
			body: "A=\n",
			want: map[string]string{"A": ""},
		},
		{
			name: "line without equals is ignored",
			body: "A=1\nnot a pair\nB=2\n",
			want: map[string]string{"A": "1", "B": "2"},
		},
		{
			name: "last duplicate wins",
			body: "A=1\nA=2\n",
			want: map[string]string{"A": "2"},
		},
		{
			name: "value containing equals",
			body: "A=a=b\n",
			want: map[string]string{"A": "a=b"},
		},
		{
			name: "crlf line endings",
			body: "A=1\r\nB=2\r\n",
			want: map[string]string{"A": "1", "B": "2"},
		},
		{
			name: "unbalanced quote is kept",
			body: `A="1` + "\n",
			want: map[string]string{"A": `"1`},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := parseDotEnv([]byte(test.body))
			if len(got) != len(test.want) {
				t.Fatalf("got %v, want %v", got, test.want)
			}
			for key, want := range test.want {
				if got[key] != want {
					t.Fatalf("%s = %q, want %q", key, got[key], want)
				}
			}
		})
	}
}
