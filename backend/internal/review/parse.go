package review

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Parse turns the model's answer into a Review. structured is the result
// event's structured_output, which the CLI returns when --json-schema is in
// effect. text is the plain result field, which carries the same object as
// prose or a fenced block on CLI versions that do not emit structured_output.
// The structured field wins; text is the fallback.
func Parse(structured json.RawMessage, text string) (Review, error) {
	if len(structured) > 0 && !isJSONNull(structured) {
		var parsed Review
		if err := json.Unmarshal(structured, &parsed); err == nil {
			return parsed, nil
		}
	}

	candidate := extractJSONObject(text)
	if candidate == "" {
		return Review{}, errors.New("review: model output has no JSON object")
	}
	var parsed Review
	if err := json.Unmarshal([]byte(candidate), &parsed); err != nil {
		return Review{}, fmt.Errorf("review: decode model output: %w", err)
	}
	return parsed, nil
}

func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}

// extractJSONObject strips an optional markdown fence and returns the substring
// from the first { to the last }. Prose around the object is discarded.
func extractJSONObject(text string) string {
	value := strings.TrimSpace(text)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "```") {
		if index := strings.IndexByte(value, '\n'); index >= 0 {
			value = value[index+1:]
		} else {
			return ""
		}
	}
	value = strings.TrimSpace(value)
	if strings.HasSuffix(value, "```") {
		value = strings.TrimSpace(strings.TrimSuffix(value, "```"))
	}
	start := strings.IndexByte(value, '{')
	end := strings.LastIndexByte(value, '}')
	if start < 0 || end <= start {
		return ""
	}
	return value[start : end+1]
}
