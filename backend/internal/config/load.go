package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	appDirName     = ".triage"
	fileName       = "config.json"
	configDirMode  = 0o700
	configFileMode = 0o600
)

// template is written on first run so the file exists and its shape is visible.
// It is valid config: an empty repo list keeps the app empty, not broken.
const template = `{
  "user": { "login": "", "name": "" },
  "repos": [],
  "linear": { "teamKeys": [] }
}
`

// DefaultPath is ~/.triage/config.json, beside the cache and artifacts.
func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("config: resolve home directory: %w", err)
	}
	return filepath.Join(home, appDirName, fileName), nil
}

// fileConfig is the on-disk shape. Pointer fields separate "absent" from
// "present but empty". Repos are owner/name strings because a person edits this
// file by hand.
type fileConfig struct {
	User   *UserConfig   `json:"user"`
	Repos  *[]string     `json:"repos"`
	Linear *LinearConfig `json:"linear"`
}

// Load reads the config file at path over Default. A missing file is created
// from template. A file that does not parse leaves Default in place and reports
// the problem on Config.Problem, so one typo does not stop the app from starting.
func Load(path string) Config {
	cfg := Default()
	cfg.Source = path

	if err := ensureFile(path); err != nil {
		cfg.Problem = err.Error()
		return cfg
	}
	data, err := os.ReadFile(path)
	if err != nil {
		cfg.Problem = fmt.Sprintf("read %s: %v", path, err)
		return cfg
	}

	var file fileConfig
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&file); err != nil {
		cfg.Problem = fmt.Sprintf("parse %s: %v", path, err)
		return cfg
	}
	if err := expectEOF(decoder); err != nil {
		cfg.Problem = fmt.Sprintf("parse %s: %v", path, err)
		return cfg
	}

	if file.User != nil {
		cfg.User = *file.User
	}
	if file.Linear != nil {
		cfg.Linear = *file.Linear
		if cfg.Linear.TeamKeys == nil {
			cfg.Linear.TeamKeys = []string{}
		}
	}
	if file.Repos != nil {
		cfg.Repos, cfg.Problem = parseRepos(*file.Repos)
	}
	return cfg
}

// ensureFile creates the parent directory and a template file when path is
// missing. An existing file is left untouched.
func ensureFile(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), configDirMode); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, configFileMode)
	if err != nil {
		// Another process won the race; its file is as good as ours.
		if errors.Is(err, os.ErrExist) {
			return nil
		}
		return fmt.Errorf("create %s: %w", path, err)
	}
	if _, err := f.WriteString(template); err != nil {
		f.Close()
		os.Remove(path)
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

// parseRepos turns owner/name strings into Repo values. Malformed entries are
// dropped and named in the returned problem; valid ones still load.
func parseRepos(raw []string) ([]Repo, string) {
	repos := make([]Repo, 0, len(raw))
	seen := make(map[string]struct{}, len(raw))
	problems := make([]string, 0)

	for i, entry := range raw {
		owner, name, ok := strings.Cut(strings.TrimSpace(entry), "/")
		owner, name = strings.TrimSpace(owner), strings.TrimSpace(name)
		if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
			problems = append(problems, fmt.Sprintf("repos[%d] %q is not owner/name", i, entry))
			continue
		}
		key := strings.ToLower(owner + "/" + name)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		repos = append(repos, Repo{Owner: owner, Name: name})
	}

	if len(problems) == 0 {
		return repos, ""
	}
	return repos, "ignored " + strings.Join(problems, ", ")
}

// expectEOF rejects trailing JSON after the config object, which json.Decoder
// would otherwise ignore.
func expectEOF(decoder *json.Decoder) error {
	if _, err := decoder.Token(); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return err
	}
	return errors.New("unexpected trailing data")
}
