# Models

`brokecli` now supports a `models.json` override layer inspired by `pi`.

Paths:

- global: `~/.brokecli/models.json`
- project: `./.brokecli/models.json`

Project overrides win over global overrides.

## What It Supports

- add custom providers
- merge custom models into built-in providers
- override built-in model metadata like name, context window, and costs
- override provider `baseUrl`

Built-in runtime/provider safety filters still apply after merge. For example, native Codex login keeps its supported model filter.

## Example

```json
{
  "providers": {
    "openai": {
      "modelOverrides": {
        "gpt-4o": {
          "name": "GPT-4o Custom"
        }
      },
      "models": [
        {
          "id": "acme-coder",
          "name": "Acme Coder",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 64000,
          "maxTokens": 8000
        }
      ]
    },
    "custom-openai": {
      "name": "Custom OpenAI",
      "baseUrl": "https://example.com/v1",
      "api": "openai-completions",
      "apiKey": "CUSTOM_PROVIDER_KEY",
      "models": [
        {
          "id": "acme-coder",
          "name": "Acme Coder",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 64000,
          "maxTokens": 8000
        }
      ]
    }
  }
}
```

## API Key Values

`apiKey` supports:

- literal values
- environment variable names like `"CUSTOM_PROVIDER_KEY"`
- shell commands prefixed with `!`

Examples:

```json
{
  "providers": {
    "custom-openai": {
      "apiKey": "CUSTOM_PROVIDER_KEY"
    },
    "custom-anthropic": {
      "apiKey": "!op read op://vault/anthropic/api_key"
    }
  }
}
```

## Supported Custom Provider APIs

- `openai-completions`
- `anthropic-messages`
- `google-generative-ai`
