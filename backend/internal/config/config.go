// Package config is the single source of truth for Triage's settings.
//
// User-editable settings (repos, linear team keys) come from ~/.triage/config.json
// through Load. Default holds the fallbacks; the Claude action registry and cache
// TTLs stay server-side and never appear in that file.
package config

import "time"

// UserConfig is the authenticated GitHub identity.
type UserConfig struct {
	Login string `json:"login"`
	Name  string `json:"name"`
}

// Repo is a tracked repository, identified by owner/name.
type Repo struct {
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

// Action is one Claude action. Model, budget and prompt are server-side only.
type Action struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`
	Model        string  `json:"-"`
	MaxBudgetUSD float64 `json:"-"`
	Prompt       string  `json:"-"` // Go text/template; see actions.PromptData
}

// ActionsConfig is the Claude actions registry. Nothing here is serialized.
type ActionsConfig struct {
	Items []Action `json:"-"`
}

// TabConfig is one PR list tab in the UI.
type TabConfig struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// LinearConfig holds Linear-side filters.
type LinearConfig struct {
	TeamKeys []string `json:"teamKeys"`
}

// CacheTTL holds the freshness budget per provider kind. Blobs and rendered
// Omnidiff output are keyed by immutable SHAs, so their TTLs are long.
type CacheTTL struct {
	GraphQL  time.Duration
	REST     time.Duration
	Blob     time.Duration
	Omnidiff time.Duration
}

// Config is the whole app configuration. Cache and Actions are server-side only
// and never serialized to the webview directly. Source and Problem describe the
// config file that produced this value; both are empty when Load used Default
// alone.
type Config struct {
	User    UserConfig    `json:"user"`
	Repos   []Repo        `json:"repos"`
	Tabs    []TabConfig   `json:"tabs"`
	Linear  LinearConfig  `json:"linear"`
	Cache   CacheTTL      `json:"-"`
	Actions ActionsConfig `json:"-"`

	// Source is the config file path Load read.
	Source string `json:"-"`
	// Problem is non-empty when the config file could not be read or parsed
	// cleanly. Defaults stay in place so the app still starts.
	Problem string `json:"-"`
}

// actionExplainPrompt is the whole context Claude gets: metadata plus a unified
// diff fetched from GitHub. PR text is untrusted input, so the diff is fenced
// and the system prompt says not to trust instructions inside it.
const actionExplainPrompt = `Repository: {{.Repo}}
PR #{{.Number}}: {{.Title}}
Branch: {{.Branch}} → base {{.BaseBranch}}

Description:
{{.Description}}

Changed files ({{.FileCount}} files, +{{.Additions}} −{{.Deletions}}):
{{.FileList}}

Diff ({{.DiffNote}}):
<diff>
{{.Diff}}
</diff>

Explain what this PR does.
`

// Default returns the fallback configuration, used for everything the config
// file does not set. Repos start empty: they belong in the config file.
func Default() Config {
	return Config{
		User:  UserConfig{},
		Repos: []Repo{},
		Tabs: []TabConfig{
			{ID: "mine", Label: "My PRs"},
			{ID: "review", Label: "Review requested"},
			{ID: "all", Label: "All open"},
		},
		Linear: LinearConfig{TeamKeys: []string{}},
		Cache: CacheTTL{
			GraphQL:  15 * time.Minute,
			REST:     5 * time.Minute,
			Blob:     30 * 24 * time.Hour,
			Omnidiff: 7 * 24 * time.Hour,
		},
		Actions: ActionsConfig{
			Items: []Action{{
				ID:           "explain",
				Label:        "Explain",
				Model:        "claude-haiku-5-5",
				MaxBudgetUSD: 0.50,
				Prompt:       actionExplainPrompt,
			}},
		},
	}
}
