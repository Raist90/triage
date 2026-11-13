package actions

import (
	"encoding/json"
	"errors"
)

// streamUpdate is the minimal interpretation of one NDJSON line from
// `claude -p --output-format stream-json`. Unknown event types are ignored.
type streamUpdate struct {
	text  string
	final *finalResult
}

type finalResult struct {
	markdown string
	usage    Usage
	isError  bool
}

type streamLine struct {
	Type    string `json:"type"`
	Message struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"message"`
	Result       string  `json:"result"`
	TotalCostUSD float64 `json:"total_cost_usd"`
	IsError      bool    `json:"is_error"`
	Usage        struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// parseStreamLine interprets one line. A malformed line is an error the caller
// can ignore; it never fails the job by itself.
func parseStreamLine(line []byte) (streamUpdate, error) {
	if len(line) == 0 {
		return streamUpdate{}, nil
	}
	var event streamLine
	if err := json.Unmarshal(line, &event); err != nil {
		return streamUpdate{}, errors.New("actions: malformed stream line")
	}

	switch event.Type {
	case "assistant":
		var text string
		for _, block := range event.Message.Content {
			if block.Type == "text" {
				text += block.Text
			}
		}
		return streamUpdate{text: text}, nil

	case "result":
		usage := Usage{
			InputTokens:  event.Usage.InputTokens,
			OutputTokens: event.Usage.OutputTokens,
			TotalCostUSD: event.TotalCostUSD,
		}
		return streamUpdate{final: &finalResult{
			markdown: event.Result,
			usage:    usage,
			isError:  event.IsError,
		}}, nil

	default:
		return streamUpdate{}, nil
	}
}
