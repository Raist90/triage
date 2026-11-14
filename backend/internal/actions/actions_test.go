package actions

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/review"
)

func TestRenderPrompt(t *testing.T) {
	source := "Repo: {{.Repo}}\nNumber: {{.Number}}\n\nExplain what this PR does.\n"
	out, err := RenderPrompt(source, PromptData{Repo: "owner/name", Number: 12})
	if err != nil {
		t.Fatalf("RenderPrompt: %v", err)
	}
	if !strings.Contains(out, "owner/name") || !strings.Contains(out, "12") {
		t.Fatalf("prompt = %q", out)
	}

	if _, err := RenderPrompt("{{.Missing}}", PromptData{}); err == nil {
		t.Fatal("missing key should fail")
	}
	if _, err := RenderPrompt("{{", PromptData{}); err == nil {
		t.Fatal("malformed template should fail")
	}
}

func TestArtifactStore(t *testing.T) {
	store := NewStore(t.TempDir())
	artifact := Artifact{
		ActionID:      "explain",
		Model:         "model-a",
		SHA:           "aaaaaaa",
		PromptVersion: PromptVersion,
		CreatedAt:     time.Now().UTC(),
		Markdown:      "hello",
		Usage:         Usage{InputTokens: 1, OutputTokens: 2, TotalCostUSD: 0.03},
	}
	if err := store.Put("owner", "name", 4, artifact); err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, ok := store.Get("owner", "name", 4, "aaaaaaa", "explain")
	if !ok || got.Markdown != "hello" || got.Usage.TotalCostUSD != 0.03 {
		t.Fatalf("Get = %+v, %v", got, ok)
	}
	if _, ok := store.Get("owner", "name", 4, "bbbbbbb", "explain"); ok {
		t.Fatal("different SHA must not resolve")
	}
	if _, ok := store.Get("owner", "name", 4, "aaaaaaa", "../explain"); ok {
		t.Fatal("path traversal action id must not resolve")
	}

	older := artifact
	older.SHA = "ccccccc"
	older.CreatedAt = time.Now().Add(-time.Hour).UTC()
	if err := store.Put("owner", "name", 4, older); err != nil {
		t.Fatalf("Put older: %v", err)
	}
	latest, ok := store.Latest("owner", "name", 4, "explain")
	if !ok || latest.SHA != "aaaaaaa" {
		t.Fatalf("Latest = %+v, %v", latest, ok)
	}

	cleared, err := store.Clear()
	if err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if cleared != 2 {
		t.Fatalf("cleared = %d, want 2", cleared)
	}
	if _, err := os.Stat(store.Dir()); !os.IsNotExist(err) {
		t.Fatalf("artifact dir still exists: %v", err)
	}
}

func TestParseStreamLine(t *testing.T) {
	update, err := parseStreamLine([]byte(`{"type":"assistant","message":{"content":[{"type":"text","text":"Hello "},{"type":"tool_use"}]}}`))
	if err != nil || update.text != "Hello " {
		t.Fatalf("assistant = %+v, %v", update, err)
	}

	update, err = parseStreamLine([]byte(`{"type":"result","subtype":"success","result":"Final","total_cost_usd":0.02,"usage":{"input_tokens":10,"output_tokens":4}}`))
	if err != nil || update.final == nil {
		t.Fatalf("result = %+v, %v", update, err)
	}
	if update.final.markdown != "Final" || update.final.usage.InputTokens != 10 || update.final.usage.TotalCostUSD != 0.02 {
		t.Fatalf("final = %+v", update.final)
	}

	if update, err := parseStreamLine([]byte(`{"type":"system","subtype":"init"}`)); err != nil || update.final != nil || update.text != "" {
		t.Fatalf("unknown = %+v, %v", update, err)
	}
	if _, err := parseStreamLine([]byte(`{not json`)); err == nil {
		t.Fatal("malformed line should error")
	}
}

func TestRunnerStartDedupeAndArtifact(t *testing.T) {
	root := t.TempDir()

	counter := filepath.Join(root, "runs")
	promptCopy := filepath.Join(root, "prompt")
	stub := filepath.Join(root, "claude")
	script := "#!/bin/sh\n" +
		"echo run >> " + counter + "\n" +
		"cat > " + promptCopy + "\n" +
		"sleep 0.2\n" +
		"echo '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Hello \"}]}}'\n" +
		"echo '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Hello world\",\"total_cost_usd\":0.01,\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}'\n"
	if err := os.WriteFile(stub, []byte(script), 0o700); err != nil {
		t.Fatalf("write stub: %v", err)
	}

	cfg := config.ActionsConfig{Items: []config.Action{{
		ID:           "explain",
		Label:        "Explain",
		Model:        "stub-model",
		MaxBudgetUSD: 0.5,
		Prompt:       "Repo {{.Repo}} PR {{.Number}}\n\n{{.FileList}}\n\n{{.Diff}}",
	}}}
	store := NewStore(filepath.Join(root, "artifacts"))
	runner := New(cfg, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	unified := []byte("diff --git a/main.go b/main.go\nindex 1111111..2222222 100644\n--- a/main.go\n+++ b/main.go\n@@ -1,2 +1,3 @@\n package main\n+// new line\n")
	req := Request{
		Owner:         "owner",
		Name:          "name",
		Number:        7,
		ActionID:      "explain",
		SHA:           "aaaaaaa",
		BaseBranch:    "main",
		PRTitle:       "Feature",
		PRDescription: "Body",
		Branch:        "feature",
		Diff:          unified,
	}
	result, err := runner.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if result.AlreadyRunning || result.Job.SHA != "aaaaaaa" {
		t.Fatalf("first start = %+v", result)
	}
	key := result.Job.Key

	second, err := runner.Start(req)
	if err != nil {
		t.Fatalf("second Start: %v", err)
	}
	if !second.AlreadyRunning {
		t.Fatal("second Start should dedupe a running job")
	}

	deadline := time.Now().Add(10 * time.Second)
	var final Job
	for time.Now().Before(deadline) {
		job, ok := runner.Status(key)
		if ok && (job.Status == StatusDone || job.Status == StatusFailed) {
			final = job
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if final.Status != StatusDone {
		t.Fatalf("job did not finish: %+v", final)
	}

	artifact, ok := store.Get("owner", "name", 7, final.SHA, "explain")
	if !ok {
		t.Fatal("artifact missing")
	}
	if artifact.Markdown != "Hello world" || artifact.Model != "stub-model" || artifact.Usage.OutputTokens != 5 {
		t.Fatalf("artifact = %+v", artifact)
	}

	sent, err := os.ReadFile(promptCopy)
	if err != nil {
		t.Fatalf("read prompt: %v", err)
	}
	if !strings.Contains(string(sent), "main.go") || !strings.Contains(string(sent), "+// new line") {
		t.Fatalf("prompt did not carry the diff:\n%s", sent)
	}

	runs, err := os.ReadFile(counter)
	if err != nil {
		t.Fatalf("read counter: %v", err)
	}
	if strings.Count(string(runs), "run") != 1 {
		t.Fatalf("claude spawned %d times, want 1", strings.Count(string(runs), "run"))
	}

	// A completed job is served from the artifact without spawning again.
	third, err := runner.Start(req)
	if err != nil {
		t.Fatalf("third Start: %v", err)
	}
	if third.Artifact == nil || third.Artifact.Markdown != "Hello world" {
		t.Fatalf("third start = %+v", third)
	}
	runs, _ = os.ReadFile(counter)
	if strings.Count(string(runs), "run") != 1 {
		t.Fatal("completed artifact should not spawn claude")
	}
}

const reviewPromptFixture = "{{.Repo}} {{.Number}} {{.Title}} {{.Branch}} {{.BaseBranch}} {{.BaseSHA}}\n" +
	"{{.Description}}\n{{.FileCount}}\n{{.FileList}}\n{{.Guidelines}}\n" +
	"<semantic>{{.Semantic}}</semantic>\n<diff>{{.RawDiff}}</diff>\n{{.DiffNote}}\n"

func reviewStub(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "claude")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o700); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	return path
}

func reviewAction() config.Action {
	return config.Action{
		ID:           "review",
		Label:        "Automatic review",
		Kind:         KindReview,
		Model:        "stub-model",
		MaxBudgetUSD: 0.5,
		Timeout:      5 * time.Second,
		Tools:        []string{"Read", "Grep", "Glob"},
		Prompt:       reviewPromptFixture,
	}
}

func reviewRequest(t *testing.T, prepare func(ctx context.Context) (Prepared, error)) Request {
	t.Helper()
	unified := []byte("diff --git a/main.go b/main.go\nindex 1111111..2222222 100644\n--- a/main.go\n+++ b/main.go\n@@ -1,2 +1,3 @@\n package main\n+// new line\n")
	return Request{
		Owner:      "owner",
		Name:       "name",
		Number:     9,
		ActionID:   "review",
		SHA:        "aaaaaaa",
		BaseBranch: "main",
		PRTitle:    "Feature",
		Branch:     "feature",
		Diff:       unified,
		Kind:       KindReview,
		Prepare:    prepare,
	}
}

func preparedFixture(t *testing.T) Prepared {
	t.Helper()
	workdir := t.TempDir()
	unified := []byte("diff --git a/main.go b/main.go\nindex 1111111..2222222 100644\n--- a/main.go\n+++ b/main.go\n@@ -1,2 +1,3 @@\n package main\n+// new line\n")
	files := diff.Parse(unified)
	return Prepared{
		WorkDir: workdir,
		Files:   files,
		Input:   review.Input{Meta: review.Meta{Repo: "owner/name", Number: 9, Title: "Feature", Branch: "feature", BaseBranch: "main", BaseSHA: "bbbbbbb"}, FileCount: len(files), DiffNote: "complete"},
	}
}

func collectEvents(t *testing.T, runner *Runner, key string) []Event {
	t.Helper()
	events, done, unsubscribe, ok := runner.Subscribe(key)
	if !ok {
		t.Fatal("job not found")
	}
	defer unsubscribe()

	out := make([]Event, 0, 8)
	deadline := time.After(15 * time.Second)
	for {
		select {
		case event := <-events:
			out = append(out, event)
			if event.Type == "done" || event.Type == "error" {
				return out
			}
		case <-done:
			for {
				select {
				case event := <-events:
					out = append(out, event)
				default:
					return out
				}
			}
		case <-deadline:
			t.Fatal("timed out waiting for events")
		}
	}
}

func waitJob(t *testing.T, runner *Runner, key string) Job {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		job, ok := runner.Status(key)
		if ok && !liveStatus(job.Status) {
			return job
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("job did not finish")
	return Job{}
}

func TestReviewRunnerStructuredOutput(t *testing.T) {
	stub := reviewStub(t, `cat <<'EOF'
{"type":"assistant","message":{"content":[{"type":"text","text":"I will review this"}]}}
EOF
sleep 0.1
cat <<'EOF'
{"type":"result","subtype":"success","result":"","structured_output":{"verdict":{"safeToMerge":true,"summary":"ok"},"findings":[]},"total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":5}}
EOF
`)
	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	runner := New(config.ActionsConfig{Items: []config.Action{reviewAction()}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	prepared := preparedFixture(t)
	req := reviewRequest(t, func(context.Context) (Prepared, error) { return prepared, nil })
	result, err := runner.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	events := collectEvents(t, runner, result.Job.Key)
	for _, event := range events {
		if event.Type == "delta" {
			t.Fatalf("review must not emit deltas: %+v", event)
		}
	}

	final := waitJob(t, runner, result.Job.Key)
	if final.Status != StatusDone {
		t.Fatalf("job = %+v", final)
	}
	artifact, ok := store.Get("owner", "name", 9, "aaaaaaa", "review")
	if !ok {
		t.Fatal("artifact missing")
	}
	if artifact.Review == nil || !artifact.Review.Verdict.SafeToMerge || artifact.Review.Verdict.Summary != "ok" {
		t.Fatalf("review = %+v", artifact.Review)
	}
	if artifact.Worktree != prepared.WorkDir {
		t.Fatalf("worktree = %q, want %q", artifact.Worktree, prepared.WorkDir)
	}
	if artifact.Markdown != "" {
		t.Fatalf("review artifact must not carry markdown: %q", artifact.Markdown)
	}
	if artifact.PromptVersion != review.PromptVersion {
		t.Fatalf("prompt version = %q", artifact.PromptVersion)
	}
}

func TestReviewRunnerResultTextFallback(t *testing.T) {
	// A CLI version without structured_output puts the same object in result,
	// usually inside a json fence.
	payload := "```json\n{\"verdict\":{\"safeToMerge\":false,\"summary\":\"needs work\"},\"findings\":[]}\n```"
	encoded, err := json.Marshal(map[string]any{
		"type":           "result",
		"subtype":        "success",
		"result":         payload,
		"total_cost_usd": 0.01,
		"usage":          map[string]int{"input_tokens": 10, "output_tokens": 5},
	})
	if err != nil {
		t.Fatalf("encode fake event: %v", err)
	}
	stub := reviewStub(t, "cat <<'EOF'\n"+string(encoded)+"\nEOF\n")

	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	runner := New(config.ActionsConfig{Items: []config.Action{reviewAction()}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	prepared := preparedFixture(t)
	result, err := runner.Start(reviewRequest(t, func(context.Context) (Prepared, error) { return prepared, nil }))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	final := waitJob(t, runner, result.Job.Key)
	if final.Status != StatusDone {
		t.Fatalf("job = %+v", final)
	}
	artifact, ok := store.Get("owner", "name", 9, "aaaaaaa", "review")
	if !ok || artifact.Review == nil {
		t.Fatal("artifact missing")
	}
	if artifact.Review.Verdict.Summary != "needs work" {
		t.Fatalf("review = %+v", artifact.Review.Verdict)
	}
}

func TestReviewRunnerInvalidJSON(t *testing.T) {
	stub := reviewStub(t, `cat <<'EOF'
{"type":"result","subtype":"success","result":"this is not json","total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":5}}
EOF
`)
	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	runner := New(config.ActionsConfig{Items: []config.Action{reviewAction()}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	cleaned := make(chan struct{}, 1)
	prepared := preparedFixture(t)
	req := reviewRequest(t, func(context.Context) (Prepared, error) { return prepared, nil })
	req.Cleanup = func(context.Context) { cleaned <- struct{}{} }

	result, err := runner.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	final := waitJob(t, runner, result.Job.Key)
	if final.Status != StatusFailed {
		t.Fatalf("job = %+v", final)
	}
	value, ok := runner.lookup(result.Job.Key)
	if !ok || value.code != CodeReviewInvalid {
		t.Fatalf("code = %q, want %q", value.code, CodeReviewInvalid)
	}
	if _, ok := store.Get("owner", "name", 9, "aaaaaaa", "review"); ok {
		t.Fatal("invalid output must not store an artifact")
	}
	select {
	case <-cleaned:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not run after failure")
	}
}

func TestReviewRunnerPrepareErrorKeepsCode(t *testing.T) {
	stub := reviewStub(t, `echo '{}'`)
	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	runner := New(config.ActionsConfig{Items: []config.Action{reviewAction()}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	cleaned := make(chan struct{}, 1)
	req := reviewRequest(t, func(context.Context) (Prepared, error) {
		return Prepared{}, &Error{Code: "repo_path_missing", Message: "No local path configured"}
	})
	req.Cleanup = func(context.Context) { cleaned <- struct{}{} }

	result, err := runner.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	final := waitJob(t, runner, result.Job.Key)
	if final.Status != StatusFailed || final.Error != "No local path configured" {
		t.Fatalf("job = %+v", final)
	}
	value, _ := runner.lookup(result.Job.Key)
	if value.code != "repo_path_missing" {
		t.Fatalf("code = %q", value.code)
	}
	select {
	case <-cleaned:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not run after a prepare failure")
	}
}

func TestExplainRunnerUsesActionTimeout(t *testing.T) {
	stub := reviewStub(t, "sleep 5\n")
	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	action := config.Action{
		ID: "explain", Kind: KindExplain, Model: "stub-model",
		Timeout: 200 * time.Millisecond,
		Prompt:  "Repo {{.Repo}} {{.Diff}}",
	}
	runner := New(config.ActionsConfig{Items: []config.Action{action}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	unified := []byte("diff --git a/main.go b/main.go\n--- a/main.go\n+++ b/main.go\n@@ -1 +1 @@\n-old\n+new\n")
	result, err := runner.Start(Request{
		Owner: "owner", Name: "name", Number: 3, ActionID: "explain",
		SHA: "aaaaaaa", Diff: unified,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	final := waitJob(t, runner, result.Job.Key)
	if final.Status != StatusFailed {
		t.Fatalf("job = %+v", final)
	}
	value, _ := runner.lookup(result.Job.Key)
	if value.code != CodeActionTimeout {
		t.Fatalf("code = %q, want %q", value.code, CodeActionTimeout)
	}
	if !strings.Contains(final.Error, "200ms") {
		t.Fatalf("timeout message = %q", final.Error)
	}
}

func TestReviewRunnerMissingTools(t *testing.T) {
	stub := reviewStub(t, `echo '{}'`)
	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	action := reviewAction()
	action.Tools = nil
	runner := New(config.ActionsConfig{Items: []config.Action{action}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	prepared := preparedFixture(t)
	result, err := runner.Start(reviewRequest(t, func(context.Context) (Prepared, error) { return prepared, nil }))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	final := waitJob(t, runner, result.Job.Key)
	value, _ := runner.lookup(result.Job.Key)
	if final.Status != StatusFailed || value.code != CodeReviewInvalid {
		t.Fatalf("job = %+v code = %q", final, value.code)
	}
}

func TestReviewRunnerCancelRemovesWorktree(t *testing.T) {
	stub := reviewStub(t, "sleep 5\n")
	store := NewStore(filepath.Join(t.TempDir(), "artifacts"))
	runner := New(config.ActionsConfig{Items: []config.Action{reviewAction()}}, store, stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer runner.Shutdown()

	cleaned := make(chan struct{}, 1)
	prepared := preparedFixture(t)
	req := reviewRequest(t, func(context.Context) (Prepared, error) { return prepared, nil })
	req.Cleanup = func(context.Context) { cleaned <- struct{}{} }

	result, err := runner.Start(req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := runner.Status(result.Job.Key); ok && job.Status == StatusRunning {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !runner.Cancel(result.Job.Key) {
		t.Fatal("Cancel reported no live job")
	}
	final := waitJob(t, runner, result.Job.Key)
	if final.Status != StatusCanceled {
		t.Fatalf("job = %+v", final)
	}
	select {
	case <-cleaned:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not run after cancel")
	}
}
