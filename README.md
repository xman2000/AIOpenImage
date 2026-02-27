# AI Open Image

AI Open Image is a desktop image generation and editing studio built with Electron, React, and TypeScript.

It is designed for fast iteration across multiple models, non-destructive edit workflows, and local-first gallery management.

Homepage: <https://github.com/aporb/openrouter-image-gen>

## What It Does

- Generate images from prompts using OpenRouter or Ollama backends
- Run multiple models in one request for direct output comparison
- Use image-to-image and iterative prompt edits
- Edit existing images non-destructively in Edit Studio
- Apply mask-guided edits with brush/eraser/rectangle tools
- Compare before/after in a single draggable split-view frame
- Track cost, metadata, and edit lineage in the gallery
- Export all gallery images to ZIP with metadata summary

## Key Features

- **Multi-model generation**: select multiple models and generate in one run
- **Batch mode**: create 2-4 variants per model
- **Advanced controls**: aspect ratio, image size, style preset, negative prompt, seed
- **Image-to-image**: reference-image based generation
- **Edit Studio**:
  - non-destructive image edits
  - mask focus with brush, eraser, rectangle tools
  - compare mode with draggable old/new divider
- **Gallery management**:
  - searchable visual history
  - save individual images
  - export ZIP archive with metadata
- **Theming**: system/light/dark + multiple color themes

## Architecture

- **Electron main**: app window, native menu, IPC, file system integration
- **Renderer (React)**: generation UI, gallery, settings, edit studio
- **Providers**:
  - OpenRouter provider for hosted model generation/edit flows
  - Ollama provider for local model workflows
- **Knowledge layer**: YAML model catalog and capability metadata

## Requirements

- Node.js 20+
- npm 10+
- Windows (primary target in current release tooling)

Optional (backend dependent):

- OpenRouter API key (for OpenRouter backend)
- Ollama installation + running server (for Ollama backend)

## Quick Start

```bash
npm install
npm run dev
```

Then in app:

1. Open **Settings** (`Ctrl+,`)
2. Choose backend (`OpenRouter` or `Ollama`)
3. Configure credentials/URL
4. Save settings and generate

## Build

```bash
npm run build
```

Outputs:

- Renderer: `dist/`
- Electron: `dist-electron/`

Windows installer build:

```bash
npm run release:win
```

## User Documentation

- Full user guide: `docs/USER_GUIDE.md`
- Ollama setup notes: `docs/OLLAMA_ALTERNATIVE.md`

In the app, open **Help > User Guide** (or press `F1`) to access onboarding and usage help.

## Data Storage

App data is stored in Electron `userData`:

- `data/gallery_index.json`
- `data/settings.json`
- `output/` generated images
- `output/masks/` saved edit masks

## Notes

- OpenRouter remains the default backend.
- Ollama compatibility varies by local model and endpoint support.
- Keep API keys local and out of source control.
