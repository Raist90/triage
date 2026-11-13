package config

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Tokens are resolved once at startup. They never leave the Go process: no
// logging, no HTTP responses, no webview.
type Tokens struct {
	GitHub string
	Linear string
	// Source is the .env file that was read, empty when none was found. The path
	// is safe to log; the values are not.
	Source string
}

const (
	envGitHubToken = "GITHUB_TOKEN"
	envLinearKey   = "LINEAR_API_KEY"

	dotEnvFile     = ".env"
	dotEnvExample  = ".env.example"
	ghAuthTimeout  = 2 * time.Second
	ghAuthExecName = "gh"
)

// LoadTokens reads provider credentials from the repo-root .env, then falls back
// to `gh auth token` for GitHub when GITHUB_TOKEN is empty. Linear has no
// fallback. Failures are silent by design.
func LoadTokens() Tokens {
	return loadTokens(ghAuthToken)
}

// loadTokens takes the GitHub fallback as an argument so tests never shell out.
func loadTokens(ghAuth func() string) Tokens {
	tokens := Tokens{}
	if root, ok := repoRoot(""); ok {
		path := filepath.Join(root, dotEnvFile)
		if env, err := readDotEnv(path); err == nil {
			tokens.GitHub = env[envGitHubToken]
			tokens.Linear = env[envLinearKey]
			tokens.Source = path
		}
	}
	if tokens.GitHub == "" {
		tokens.GitHub = ghAuth()
	}
	return tokens
}

// repoRoot walks up from start looking for the committed .env.example. An empty
// start means the current working directory. It returns false when no parent
// holds the marker, which is the case outside the repo.
func repoRoot(start string) (string, bool) {
	dir := start
	if dir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", false
		}
		dir = cwd
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, dotEnvExample)); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// readDotEnv parses KEY=VALUE lines from path.
func readDotEnv(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseDotEnv(data), nil
}

// parseDotEnv keeps the file readable for humans: blank lines and # comments are
// skipped, whitespace around the key and value is trimmed, and a fully quoted
// value loses its quotes. Lines without = are ignored.
func parseDotEnv(data []byte) map[string]string {
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if key != "" {
			values[key] = value
		}
	}
	return values
}

// ghAuthToken shells out to the GitHub CLI. Any failure, including the 2s
// timeout, returns an empty token.
func ghAuthToken() string {
	ctx, cancel := context.WithTimeout(context.Background(), ghAuthTimeout)
	defer cancel()

	out, err := exec.CommandContext(ctx, ghAuthExecName, "auth", "token").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
