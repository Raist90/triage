package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
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
  "repoPaths": {},
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
	User      *UserConfig        `json:"user"`
	Repos     *[]string          `json:"repos"`
	RepoPaths *map[string]string `json:"repoPaths"`
	Linear    *LinearConfig      `json:"linear"`
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
	if file.RepoPaths != nil {
		paths, problem := parseRepoPaths(*file.RepoPaths)
		cfg.Problem = combineProblems(cfg.Problem, problem)
		for i := range cfg.Repos {
			key := strings.ToLower(cfg.Repos[i].Owner + "/" + cfg.Repos[i].Name)
			if path, ok := paths[key]; ok {
				cfg.Repos[i].Path = path
			}
		}
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

// parseRepoPaths turns owner/name keys into expanded absolute paths, keyed by
// lowercase owner/name. Entries that do not parse are dropped and named in the
// returned problem. Keys that match no tracked repo are harmless and kept, so a
// repo can be added and given a path in either order.
func parseRepoPaths(raw map[string]string) (map[string]string, string) {
	paths := make(map[string]string, len(raw))
	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	// Map order is random. Sorting keeps the problem text and the winner of a
	// case-only duplicate stable across runs.
	sort.Strings(keys)

	problems := make([]string, 0)
	for _, entry := range keys {
		owner, name, ok := strings.Cut(strings.TrimSpace(entry), "/")
		owner, name = strings.TrimSpace(owner), strings.TrimSpace(name)
		if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
			problems = append(problems, fmt.Sprintf("repoPaths[%q] is not owner/name", entry))
			continue
		}
		path, problem := expandPath(strings.TrimSpace(raw[entry]))
		if problem != "" {
			problems = append(problems, fmt.Sprintf("repoPaths[%q] %s", entry, problem))
			continue
		}
		paths[strings.ToLower(owner+"/"+name)] = path
	}

	if len(problems) == 0 {
		return paths, ""
	}
	return paths, "ignored " + strings.Join(problems, ", ")
}

// expandPath trims and validates one repo path value. A leading ~ expands to the
// user home directory; the result must be absolute.
func expandPath(value string) (string, string) {
	if value == "" {
		return "", "is empty"
	}
	if value == "~" || strings.HasPrefix(value, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", "cannot expand ~"
		}
		value = filepath.Join(home, strings.TrimPrefix(value, "~"))
	}
	if !filepath.IsAbs(value) {
		return "", "is not an absolute path"
	}
	return filepath.Clean(value), ""
}

// combineProblems joins non-empty problem fragments so a bad repo list does not
// hide a bad path entry.
func combineProblems(problems ...string) string {
	kept := make([]string, 0, len(problems))
	for _, problem := range problems {
		if problem != "" {
			kept = append(kept, problem)
		}
	}
	return strings.Join(kept, "; ")
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
