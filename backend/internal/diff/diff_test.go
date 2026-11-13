package diff

import "testing"

func TestParseSplitsFiles(t *testing.T) {
	patch := []byte(`diff --git a/main.go b/main.go
index 1111111..2222222 100644
--- a/main.go
+++ b/main.go
@@ -1,2 +1,3 @@
 package main
+// new
 func main() {}
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/empty.txt b/empty.txt
new file mode 100644
--- /dev/null
+++ b/empty.txt
`)

	files := Parse(patch)
	if len(files) != 3 {
		t.Fatalf("got %d files, want 3", len(files))
	}

	if files[0].Path != "main.go" || files[0].Status != "modified" {
		t.Errorf("first file = %+v", files[0])
	}
	if files[0].Additions != 1 || files[0].Deletions != 0 {
		t.Errorf("first file counts = +%d -%d", files[0].Additions, files[0].Deletions)
	}

	if files[1].Path != "new.txt" || files[1].OldPath != "old.txt" || files[1].Status != "renamed" {
		t.Errorf("second file = %+v", files[1])
	}

	if files[2].Path != "empty.txt" || files[2].Status != "added" {
		t.Errorf("third file = %+v", files[2])
	}
}

func TestParseContentThatLooksLikeHeaders(t *testing.T) {
	patch := []byte(`diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,1 @@
--- removed content
+++ added content
`)

	files := Parse(patch)
	if len(files) != 1 {
		t.Fatalf("got %d files, want 1", len(files))
	}
	if files[0].Additions != 1 || files[0].Deletions != 1 {
		t.Errorf("counts = +%d -%d, want +1 -1", files[0].Additions, files[0].Deletions)
	}
}

func TestParseEmpty(t *testing.T) {
	if files := Parse(nil); len(files) != 0 {
		t.Fatalf("got %d files, want 0", len(files))
	}
}

func TestCleanPath(t *testing.T) {
	cases := map[string]string{
		"a/main.go":     "main.go",
		"b/main.go":     "main.go",
		"/dev/null":     "",
		`"a/sp ace.go"`: "sp ace.go",
		"a/main.go\t":   "main.go",
	}
	for input, want := range cases {
		if got := cleanPath(input); got != want {
			t.Errorf("cleanPath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestParseSemanticReport(t *testing.T) {
	output := []byte(`{
	  "summary": {"fileCount": 2, "added": 1, "modified": 2, "deleted": 0, "moved": 1,
	    "renamed": 0, "reordered": 0, "binary": 0, "orphan": 0, "total": 4},
	  "changes": [
	    {"filePath":"src/a.ts","entityType":"function","entityName":"add","changeType":"modified",
	     "startLine":3,"endLine":5,"oldStartLine":1,"oldEndLine":3,"structuralChange":true},
	    {"filePath":"src/a.ts","entityType":"function","entityName":"unused","changeType":"modified",
	     "startLine":9,"endLine":11,"oldStartLine":7,"oldEndLine":9,"structuralChange":false},
	    {"filePath":"src/b.ts","entityType":"type","entityName":"Thing","changeType":"added",
	     "startLine":1,"endLine":4,"oldStartLine":null,"oldEndLine":null,"structuralChange":null},
	    {"filePath":"src/b.ts","entityType":"function","entityName":"run","changeType":"moved",
	     "startLine":10,"endLine":14,"oldStartLine":20,"oldEndLine":24,
	     "oldFilePath":"src/a.ts","oldEntityName":"run","structuralChange":null}
	  ]
	}`)

	report, err := parseSemanticReport(output)
	if err != nil {
		t.Fatalf("parseSemanticReport: %v", err)
	}
	if report.Summary.Total != 4 || report.Summary.Moved != 1 {
		t.Errorf("summary = %+v", report.Summary)
	}

	changes := report.Changes["src/a.ts"]
	if len(changes) != 2 {
		t.Fatalf("src/a.ts changes = %d, want 2", len(changes))
	}
	if changes[0].StartLine != 3 || changes[0].OldEndLine != 3 {
		t.Errorf("line ranges = %+v", changes[0])
	}
	if changes[0].Cosmetic {
		t.Error("structural change marked cosmetic")
	}
	if !changes[1].Cosmetic {
		t.Error("non-structural change not marked cosmetic")
	}

	moved := report.Changes["src/b.ts"][1]
	if moved.OldFilePath != "src/a.ts" || moved.OldEntityName != "run" {
		t.Errorf("move metadata = %+v", moved)
	}
	if moved.Cosmetic {
		t.Error("added/moved entity without prior content marked cosmetic")
	}
}
