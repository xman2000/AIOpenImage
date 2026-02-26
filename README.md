# AI Open Image

Desktop image generator built with Electron + React + TypeScript, supporting OpenRouter and Ollama backends.

## Features

- Text-to-image with model, aspect ratio, negative prompt, image size, and seed controls
- Image-to-image using a reference image data URL
- Batch generation (2-4 variants)
- Prompt history and saved prompts persisted locally
- Gallery with metadata (dimensions, size, format, cost estimate, seed)
- Save individual images and export full gallery ZIP with metadata

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. In the app, paste your OpenRouter key (`sk-or-...`) and click **Save API Key**.

## Build

```bash
npm run build
```

Renderer output: `dist/`

Electron output: `dist-electron/`

## Alternative Backend: Ollama

You can use Ollama as an alternative image backend. See `docs/OLLAMA_ALTERNATIVE.md` for setup and integration details.

Quick note:
- Open **Settings** in the app and switch **Image Backend** to `Ollama`.
- Set **Ollama Base URL** (default: `http://localhost:11434`).
- OpenRouter remains the default backend.
- Ollama image generation uses an OpenAI-compatible **experimental** endpoint (`/v1/images/generations`).

## Storage

App data lives under Electron `userData`:

- `data/gallery_index.json`
- `data/settings.json`
- `output/` generated images
