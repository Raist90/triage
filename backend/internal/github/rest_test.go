package github

import (
	"net/http"
	"strings"
	"testing"
)

func TestRestErrorMessageKeepsProviderReason(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{
			name:   "merge forbidden keeps GitHub's reason",
			status: http.StatusForbidden,
			body:   `{"message":"Must have admin rights to Repository."}`,
			want:   "Must have admin rights to Repository.",
		},
		{
			name:   "forbidden without a message stays generic",
			status: http.StatusForbidden,
			body:   `{}`,
			want:   "provider rejected credentials",
		},
		{
			name:   "unauthorized stays generic",
			status: http.StatusUnauthorized,
			body:   `{"message":"Bad credentials"}`,
			want:   "provider rejected credentials",
		},
		{
			name:   "merge conflict keeps the reason",
			status: http.StatusConflict,
			body:   `{"message":"Head branch was modified. Review and try the merge again."}`,
			want:   "Head branch was modified. Review and try the merge again.",
		},
		{
			name:   "method not allowed falls back to the nested error",
			status: http.StatusMethodNotAllowed,
			body:   `{"errors":[{"message":"Pull Request is not mergeable"}]}`,
			want:   "Pull Request is not mergeable",
		},
		{
			name:   "unknown status without a message is bounded",
			status: http.StatusTeapot,
			body:   `{}`,
			want:   "provider request failed (status 418)",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := restErrorMessage(strings.NewReader(tc.body), tc.status)
			if got != tc.want {
				t.Fatalf("message = %q, want %q", got, tc.want)
			}
		})
	}
}
