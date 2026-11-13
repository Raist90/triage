package actions

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
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
