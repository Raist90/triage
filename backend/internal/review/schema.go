package review

// Schema is the JSON schema passed to the Claude CLI's --json-schema flag. It
// is a guard, not the source of truth: every limit is enforced again in Go
// after parsing.
const Schema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["verdict", "findings"],
  "properties": {
    "verdict": {
      "type": "object",
      "additionalProperties": false,
      "required": ["safeToMerge", "summary"],
      "properties": {
        "safeToMerge": { "type": "boolean" },
        "summary": { "type": "string", "maxLength": 240 }
      }
    },
    "findings": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "category", "title", "claim", "file", "line"],
        "properties": {
          "severity": { "enum": ["blocking", "warning", "nitpick", "praise"] },
          "category": {
            "enum": ["risk", "design", "architecture", "conventions", "tests"]
          },
          "title": { "type": "string", "maxLength": 80 },
          "claim": { "type": "string", "maxLength": 320 },
          "suggestion": { "type": "string", "maxLength": 480 },
          "file": { "type": "string" },
          "line": { "type": "integer", "minimum": 1 },
          "endLine": { "type": "integer", "minimum": 1 },
          "entity": { "type": "string", "maxLength": 120 },
          "patch": { "type": "string", "maxLength": 8192 }
        }
      }
    }
  }
}`

// JSONSchema returns the schema C3 passes to --json-schema.
func JSONSchema() string { return Schema }
