# Using Ollama as an Alternative Backend

This project defaults to **OpenRouter**, but you can run it against **Ollama** for local image generation workflows.

## Prerequisites

1. Install Ollama: <https://ollama.com/download/windows>
2. Verify server is running:

```bash
curl http://localhost:11434/api/tags
```

3. Ensure you have an image-generation capable model available in Ollama.

## Important API Difference

OpenRouter flow in this app currently expects image output from chat completions.

Ollama image generation is exposed via an OpenAI-compatible **experimental** endpoint:

- `POST http://localhost:11434/v1/images/generations`
- returns `data[0].b64_json`

Because of this, a backend adapter is needed to map Ollama responses into the app's gallery pipeline.

## Validate Ollama Image Generation

Run this first to confirm Ollama image output works on your machine:

```bash
curl -X POST http://localhost:11434/v1/images/generations -H "Content-Type: application/json" -d "{\"model\":\"x/z-image-turbo\",\"prompt\":\"A futuristic neon city skyline at dusk\",\"size\":\"1024x1024\",\"response_format\":\"b64_json\"}"
```

If successful, you'll receive JSON with a large `b64_json` value.

## Using Ollama in This App

1. Open **Settings**.
2. Set **Image Backend** to `Ollama`.
3. Set **Ollama Base URL** (usually `http://localhost:11434`).
4. Save settings.
5. The model list will refresh from Ollama (`/v1/models`, fallback `/api/tags`).

## Optional Environment Variables (for custom builds)

If you want to externalize config in your own fork, these names are recommended:

- `IMAGE_BACKEND=openrouter|ollama`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_API_KEY=ollama` (required by some OpenAI clients, ignored by Ollama)

## Caveats

- Ollama `/v1/images/generations` is marked experimental and may change.
- Model names and availability differ from OpenRouter.
- Some advanced options may not map 1:1 across providers.
