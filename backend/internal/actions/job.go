package actions

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/review"
)

// Job is the public status shape.
type Job struct {
	Key       string    `json:"-"`
	ActionID  string    `json:"action"`
	Repo      string    `json:"repo,omitempty"`
	Number    int       `json:"number,omitempty"`
	SHA       string    `json:"sha"`
	Status    string    `json:"status" enum:"queued,preparing,running,validating,done,failed,canceled" doc:"Job lifecycle state"`
	StartedAt time.Time `json:"startedAt"`
	Error     string    `json:"error,omitempty"`
}

// Prepared is what a review needs before the model can run: a checked-out PR
// head plus the bounded prompt input and the parsed diff files.
type Prepared struct {
	WorkDir    string
	Input      review.Input
	Files      []diff.File
	Guidelines string
}

// Request starts one action for one PR.
type Request struct {
	Owner         string
	Name          string
	Number        int
	ActionID      string
	SHA           string
	BaseBranch    string
	PRTitle       string
	PRDescription string
	Branch        string
	Diff          []byte
	Kind          string
	// Prepare runs inside the job goroutine after the preparing status, never
	// in Start. Explain has none: its diff is already in Diff.
	Prepare func(ctx context.Context) (Prepared, error)
	// Cleanup runs when the job fails or is canceled, on a fresh context. It
	// removes the worktree so a failed review leaves nothing behind.
	Cleanup func(ctx context.Context)
}

// StartResult is the outcome of Start.
type StartResult struct {
	Job            Job
	Artifact       *Artifact
	AlreadyRunning bool
}

// Event is one SSE payload.
type Event struct {
	Type     string
	Status   string
	Text     string
	Artifact *Artifact
	Code     string
	Message  string
}

type job struct {
	mu       sync.Mutex
	info     Job
	text     strings.Builder
	subs     map[chan Event]struct{}
	cancel   context.CancelFunc
	done     chan struct{}
	artifact *Artifact
	code     string
}

func (j *job) Info() Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.info
}

func (j *job) Status() string {
	return j.Info().Status
}

func (j *job) setStatus(status string) {
	j.mu.Lock()
	j.info.Status = status
	j.mu.Unlock()
	j.emit(Event{Type: "status", Status: status})
}

func (j *job) setCancel(cancel context.CancelFunc) {
	j.mu.Lock()
	j.cancel = cancel
	j.mu.Unlock()
}

func (j *job) appendText(text string) {
	j.mu.Lock()
	j.text.WriteString(text)
	j.mu.Unlock()
}

func (j *job) currentText() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.text.String()
}

func (j *job) emit(event Event) {
	j.mu.Lock()
	subs := copySubs(j.subs)
	j.mu.Unlock()
	for _, sub := range subs {
		select {
		case sub <- event:
		default:
		}
	}
}

func (j *job) closeDone() {
	select {
	case <-j.done:
	default:
		close(j.done)
	}
}

func copySubs(subs map[chan Event]struct{}) []chan Event {
	out := make([]chan Event, 0, len(subs))
	for sub := range subs {
		out = append(out, sub)
	}
	return out
}
