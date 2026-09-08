# AI Open Image User Guide

AI Open Image is a desktop app for generating and editing images with modern AI image models.

It supports:

- OpenRouter-hosted image models
- Ollama as a local alternative backend
- Multi-model runs for side-by-side output comparison
- Non-destructive edit workflows with lineage tracking

## 1) First Launch

1. Open **Settings > Open Settings...**.
2. Choose a backend:
   - `OpenRouter` (default)
   - `Ollama` (local)
3. If using OpenRouter, add your API key.
4. If using Ollama, set the base URL (default: `http://localhost:11434`).
5. Save settings and confirm models load.

## 2) Generate Images

1. Enter a prompt in the **Prompt** field.
2. (Optional) Add a **Negative Prompt**.
3. Select one or more models from **Models**.
4. Configure optional controls:
   - Aspect ratio
   - Image size (model dependent)
   - Batch generation (2-4 per model)
5. Click **Let's Go!**.

### Multi-model behavior

If multiple models are selected, the app submits one request per model and stores all results in the Gallery.

## 3) Use Image-to-Image

1. Open **Advanced Controls**.
2. Upload up to **3 reference images** in **Image-to-Image References**.
3. Refer to specific inputs in prompt as `image 1`, `image 2`, and `image 3`.
4. You can remove or replace each reference thumbnail before generating.
5. Generate as normal.

## 4) Edit Existing Images (Non-destructive)

1. Open any gallery image and click **Edit**.
2. The app enters edit mode and opens **Edit Studio**.
3. In edit mode, the source image is always `image 1`.
4. You can add up to 2 more reference images (3 total including source).
5. All outputs are saved as new images linked to the source image.
6. Original images remain unchanged.

## 5) Edit Studio

Edit Studio is optimized for focused image updates.

### Tools

- Brush (`B`)
- Eraser (`E`)
- Rectangle (`R`)
- Brush size slider (1-50 px)
- Red Tint toggle
- Clear Mask

### Compare mode

After generating an edit, click **Compare**.

- You will see a single split frame (before vs latest result).
- Drag left/right directly on the divider to compare.
- Click **Back to Edit** to return to masking.

## 6) Gallery

Gallery stores all generated images with metadata.

Each card includes:

- Model name
- Timestamp
- Dimensions and file size
- Cost tracking
- Prompt details
- Edit lineage tags (when applicable)

Actions:

- Open image preview
- Edit
- Reuse settings
- Save As
- Export ZIP (with metadata)
- Clear Gallery index

## 7) Themes and Appearance

Use **Settings > Theme** to switch between available palettes:

- System
- Day / Night
- Terminal variants
- Color themes (red, orange, yellow, green, blue, indigo, white)

## 8) Keyboard Shortcuts

General:

- `Ctrl+,` Open settings
- `Ctrl+Shift+E` Export gallery ZIP
- `Ctrl+Shift+Backspace` Clear gallery
- `F1` Open User Guide

Edit Studio:

- `B` Brush
- `E` Eraser
- `R` Rectangle
- `[` / `]` Decrease/increase brush size
- `Esc` Close fullscreen/close edit studio

## 9) Troubleshooting

### No models available

- Verify backend selection in Settings.
- For OpenRouter, ensure API key is valid.
- For Ollama, ensure server is reachable and models are installed.

### Generation fails

- Retry with a simpler prompt.
- Try a different model.
- Check network connectivity and provider status.
- Review status message and hints shown in the app.

### Compare or edit feels off

- Close and reopen Edit Studio from a gallery item.
- Ensure the source image is fully loaded before drawing.

## 10) Data Storage

App data is stored under Electron `userData`:

- `data/gallery_index.json`
- `data/settings.json`
- `output/` generated images
- `output/masks/` saved edit masks

## 11) Privacy and Safety Notes

- API keys are stored locally in app settings.
- Generated images and metadata are stored locally unless you export/share them.
- Do not commit secrets (API keys, tokens, `.env`) to source control.
