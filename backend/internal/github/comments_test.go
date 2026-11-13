package github

import "testing"

func TestCommentPayloadMapsReviewComment(t *testing.T) {
	line, original, start := 12, 10, 11
	payload := commentPayload{
		ID:           42,
		Body:         "Looks good",
		Path:         "src/main.go",
		Line:         &line,
		OriginalLine: &original,
		StartLine:    &start,
		Side:         CommentSideRight,
		CommitID:     "abc123",
		InReplyToID:  7,
		CreatedAt:    "2026-01-01T00:00:00Z",
	}
	payload.User.Login = "octocat"

	comment := payload.toInlineComment()
	if comment.ID != 42 || comment.Author != "octocat" {
		t.Fatalf("identity = %d/%q", comment.ID, comment.Author)
	}
	if comment.Line != 12 || comment.OriginalLine != 10 || comment.StartLine != 11 {
		t.Fatalf("line mapping = %d/%d/%d", comment.Line, comment.OriginalLine, comment.StartLine)
	}
	if comment.Side != CommentSideRight || comment.CommitID != "abc123" {
		t.Fatalf("anchor = %q/%q", comment.Side, comment.CommitID)
	}
	if comment.InReplyToID != 7 || comment.Outdated {
		t.Fatalf("reply = %d outdated = %v", comment.InReplyToID, comment.Outdated)
	}
}

func TestCommentPayloadMarksOutdatedWithoutLine(t *testing.T) {
	original := 3
	payload := commentPayload{
		ID:           9,
		Body:         "Old",
		Path:         "a.go",
		OriginalLine: &original,
		Side:         CommentSideLeft,
	}
	payload.User.Login = "octocat"

	comment := payload.toInlineComment()
	if !comment.Outdated {
		t.Fatal("expected a null line to mark the comment outdated")
	}
	if comment.Line != 0 || comment.OriginalLine != 3 {
		t.Fatalf("line = %d original = %d", comment.Line, comment.OriginalLine)
	}
}
