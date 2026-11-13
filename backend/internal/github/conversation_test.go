package github

import "testing"

func TestToPRConversationEntries(t *testing.T) {
	var node prNode
	node.Number = 7
	node.CreatedAt = "2026-11-01T10:00:00Z"
	node.Comments.Nodes = []commentNode{{Body: "first", CreatedAt: "2026-11-01T10:00:00Z"}}
	node.Comments.Nodes[0].Author.Login = "ana"

	node.Reviews.Nodes = []reviewNode{
		{Body: "", State: "PENDING", CreatedAt: "2026-11-01T11:00:00Z"},
		{Body: "", State: "COMMENTED", CreatedAt: "2026-11-01T12:00:00Z"},
		{Body: "Looks good", State: "APPROVED", CreatedAt: "2026-11-02T09:00:00Z"},
		{Body: "", State: "CHANGES_REQUESTED", CreatedAt: "2026-11-02T10:00:00Z"},
	}
	for i := range node.Reviews.Nodes {
		node.Reviews.Nodes[i].Author.Login = "bo"
	}

	thread := struct {
		Path     string `json:"path"`
		Line     int    `json:"line"`
		Comments struct {
			Nodes []commentNode `json:"nodes"`
		} `json:"comments"`
	}{Path: "src/main.go", Line: 42}
	thread.Comments.Nodes = []commentNode{{Body: "nit", CreatedAt: "2026-11-02T11:00:00Z"}}
	thread.Comments.Nodes[0].Author.Login = "cy"
	node.ReviewThreads.Nodes = append(node.ReviewThreads.Nodes, thread)

	pr := node.toPR()

	if pr.CreatedAt != node.CreatedAt {
		t.Fatalf("createdAt = %q, want %q", pr.CreatedAt, node.CreatedAt)
	}
	if len(pr.Comments) != 4 {
		t.Fatalf("comments = %d, want 4: %+v", len(pr.Comments), pr.Comments)
	}

	verdicts := pr.Comments[1:]
	if verdicts[0].State != "approved" || verdicts[0].Kind != "verdict" {
		t.Errorf("first verdict = %+v, want approved", verdicts[0])
	}
	if verdicts[1].State != "changes_requested" {
		t.Errorf("second verdict = %+v, want changes_requested", verdicts[1])
	}
	if verdicts[1].Body != "" {
		t.Errorf("verdict body = %q, want empty", verdicts[1].Body)
	}

	inline := pr.Comments[len(pr.Comments)-1]
	if inline.Kind != "review" || inline.Path != "src/main.go" || inline.Line != 42 {
		t.Errorf("inline comment = %+v, want review on src/main.go:42", inline)
	}
}
