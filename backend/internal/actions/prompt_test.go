package actions

import (
	"fmt"
	"strings"
	"testing"
)

func TestPromptWithDiff(t *testing.T) {
	unified := []byte(`diff --git a/main.go b/main.go
index 1111111..2222222 100644
--- a/main.go
+++ b/main.go
@@ -1,2 +1,3 @@
 package main
+// new line
diff --git a/package-lock.json b/package-lock.json
index 3333333..4444444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-old
+new
`)
	data := PromptData{Repo: "owner/name", Number: 3, Description: "Body"}.WithDiff(unified)
	if data.FileCount != 2 {
		t.Fatalf("FileCount = %d, want 2", data.FileCount)
	}
	if data.Additions != 2 || data.Deletions != 1 {
		t.Fatalf("counts = +%d −%d, want +2 −1", data.Additions, data.Deletions)
	}
	if !strings.Contains(data.FileList, "main.go (modified") || !strings.Contains(data.FileList, "package-lock.json") {
		t.Fatalf("FileList = %q", data.FileList)
	}
	if !strings.Contains(data.Diff, "+// new line") {
		t.Fatalf("Diff missing source patch: %q", data.Diff)
	}
	if data.DiffNote != "complete" {
		t.Fatalf("DiffNote = %q", data.DiffNote)
	}
}

func TestPromptWithDiffCapsSize(t *testing.T) {
	var patch strings.Builder
	for index := 0; index < 40; index++ {
		fmt.Fprintf(&patch, "diff --git a/file%02d.go b/file%02d.go\n", index, index)
		patch.WriteString("--- a/file" + fmt.Sprint(index) + ".go\n")
		patch.WriteString("+++ b/file" + fmt.Sprint(index) + ".go\n")
		patch.WriteString("@@ -1,1 +1,4000 @@\n")
		for line := 0; line < 4000; line++ {
			patch.WriteString("+this is a reasonably long added line of pseudo source code\n")
		}
	}

	data := PromptData{}.WithDiff([]byte(patch.String()))
	if len(data.Diff) > maxDiffBytes+64 {
		t.Fatalf("Diff = %d bytes, budget %d", len(data.Diff), maxDiffBytes)
	}
	if !strings.Contains(data.DiffNote, "omitted") {
		t.Fatalf("DiffNote = %q, want an omission note", data.DiffNote)
	}
}

func TestPromptWithDiffEmpty(t *testing.T) {
	data := PromptData{}.WithDiff(nil)
	if data.FileCount != 0 || data.Diff != "" || data.DiffNote != "no changes" {
		t.Fatalf("empty diff = %+v", data)
	}
}
