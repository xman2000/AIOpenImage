import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type {
  AppData,
  GalleryItem,
  GenerationOptions,
  ImageBackend,
  ModelInfo,
  ThemePreference
} from "../shared/types";

type StylePreset = {
  name: string;
  aspectRatio: string;
  negativePrompt: string;
  promptSuffix: string;
};

const presets: StylePreset[] = [
  {
    name: "Cinematic Portrait",
    aspectRatio: "2:3",
    negativePrompt: "blurry, low quality, distortion, deformed",
    promptSuffix: "cinematic lighting, dramatic shadows, professional photography, 8k"
  },
  {
    name: "Anime Art",
    aspectRatio: "16:9",
    negativePrompt: "photorealistic, 3d render",
    promptSuffix: "anime style, cel shading, vibrant colors, manga aesthetic"
  },
  {
    name: "Minimal Logo",
    aspectRatio: "1:1",
    negativePrompt: "complex, textured, noisy",
    promptSuffix: "minimalist logo, vector style, clean lines"
  },
  {
    name: "Digital Art",
    aspectRatio: "16:9",
    negativePrompt: "photo, realistic",
    promptSuffix: "digital painting, concept art, rich details"
  },
  {
    name: "Product Shot",
    aspectRatio: "4:3",
    negativePrompt: "people, text overlays, watermarks",
    promptSuffix: "studio lighting, clean backdrop, commercial quality"
  }
];

const themes: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Auto (System)" },
  { value: "light", label: "Day" },
  { value: "dark", label: "Night" },
  { value: "terminal", label: "Terminal" },
  { value: "amber-terminal", label: "Amber Terminal" },
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "indigo", label: "Indigo" },
  { value: "white", label: "White" }
];

const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:2", "21:9", "2:3", "3:4", "4:5", "5:4"];

const imageSrc = (absolutePath: string): string => {
  const normalized = absolutePath.replaceAll("\\", "/");
  return encodeURI(`file:///${normalized}`);
};

const resolveTheme = (preference: ThemePreference): ThemePreference => {
  if (preference !== "system") {
    return preference;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyTheme = (preference: ThemePreference): void => {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  const darkThemes = ["dark", "terminal", "amber-terminal", "red", "orange", "yellow", "green", "blue", "indigo", "white"];
  document.documentElement.style.colorScheme = darkThemes.includes(resolved) ? "dark" : "light";
};

const themeSelectColor = (preference: ThemePreference): string => {
  const resolved = resolveTheme(preference);
  const selectedTextColors: Record<ThemePreference, string> = {
    system: resolved === "light" ? "#1f2229" : "#e4e7ee",
    light: "#1f2229",
    dark: "#e4e7ee",
    terminal: "#00ff66",
    "amber-terminal": "#ffb000",
    red: "#ff7f7f",
    orange: "#ffb457",
    yellow: "#ffe074",
    green: "#3dff8f",
    blue: "#66b5ff",
    indigo: "#b7aaff",
    white: "#ffffff"
  };
  return selectedTextColors[preference] ?? selectedTextColors.system;
};

const parseAverageCost = (costEstimate: string): number => {
  const cleaned = costEstimate.replaceAll("$", "").replace("per image", "").trim();
  if (cleaned.includes("-")) {
    const [low, high] = cleaned.split("-").map((part) => Number.parseFloat(part.trim()));
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return (low + high) / 2;
    }
  }
  const single = Number.parseFloat(cleaned);
  return Number.isFinite(single) ? single : 0;
};

const App = (): JSX.Element => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"idle" | "info" | "success" | "error">("idle");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<GalleryItem | null>(null);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [appData, setAppData] = useState<AppData>({
    gallery: [],
    totalCost: 0,
    settings: {
      apiKey: "",
      themePreference: "system",
      imageBackend: "openrouter",
      ollamaBaseUrl: "http://localhost:11434"
    }
  });

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [backendInput, setBackendInput] = useState<ImageBackend>("openrouter");
  const [ollamaBaseUrlInput, setOllamaBaseUrlInput] = useState("http://localhost:11434");
  const [themeInput, setThemeInput] = useState<ThemePreference>("system");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [useSeed, setUseSeed] = useState(false);
  const [seedValue, setSeedValue] = useState(42);
  const [batchMode, setBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(2);
  const [presetName, setPresetName] = useState("None");
  const [referenceImage, setReferenceImage] = useState<string | undefined>(undefined);
  const [referencePreview, setReferencePreview] = useState<string | undefined>(undefined);

  const selectedModels = useMemo(
    () => models.filter((m) => selectedModelIds.includes(m.model_id)),
    [models, selectedModelIds]
  );
  const supportsImageInput = useMemo(
    () => selectedModels.every((m) => m.input_modalities?.includes("image")),
    [selectedModels]
  );
  const totalExpectedCost = useMemo(() => {
    const perImageTotal = selectedModels.reduce((sum, model) => sum + parseAverageCost(model.cost_estimate), 0);
    const count = batchMode ? Math.max(2, Math.min(4, batchCount)) : 1;
    return perImageTotal * count;
  }, [selectedModels, batchMode, batchCount]);

  const costBreakdown = useMemo(() => {
    const count = batchMode ? Math.max(2, Math.min(4, batchCount)) : 1;
    return selectedModels.map((model) => {
      const unit = parseAverageCost(model.cost_estimate);
      return {
        modelId: model.model_id,
        label: model.name,
        unit,
        count,
        subtotal: unit * count
      };
    });
  }, [selectedModels, batchMode, batchCount]);

  const requiresApiKey = backendInput === "openrouter";

  useEffect(() => {
    const boot = async (): Promise<void> => {
      const [loadedData, loadedModels] = await Promise.all([window.appApi.loadAppData(), window.appApi.listModels()]);
      setAppData(loadedData);
      setApiKeyInput(loadedData.settings.apiKey ?? "");
      setBackendInput(loadedData.settings.imageBackend ?? "openrouter");
      setOllamaBaseUrlInput(loadedData.settings.ollamaBaseUrl ?? "http://localhost:11434");
      setThemeInput(loadedData.settings.themePreference ?? "system");
      applyTheme(loadedData.settings.themePreference ?? "system");
      setModels(loadedModels);
      if (loadedModels.length > 0) {
        setSelectedModelIds([loadedModels[0].model_id]);
      }
      setLoading(false);
    };
    void boot();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      if (appData.settings.themePreference === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [appData.settings.themePreference]);

  const refreshData = async (): Promise<void> => {
    const latest = await window.appApi.loadAppData();
    setAppData(latest);
  };

  const onExportZip = async (): Promise<void> => {
    const result = await window.appApi.exportGalleryZip();
    setStatusTone(result.ok ? "success" : "error");
    setStatus(result.ok ? `ZIP exported: ${result.path}` : `ZIP export failed: ${result.error}`);
  };

  const onClearGallery = async (): Promise<void> => {
    const next = await window.appApi.clearGallery();
    setAppData(next);
    setStatusTone("success");
    setStatus("Gallery cleared.");
  };

  useEffect(() => {
    const unsubOpenSettings = window.appApi.onOpenSettings(() => setIsSettingsOpen(true));
    const unsubTheme = window.appApi.onThemeMenuChange((theme) => {
      setThemeInput(theme);
      setAppData((prev) => ({ ...prev, settings: { ...prev.settings, themePreference: theme } }));
      applyTheme(theme);
      setStatusTone("info");
      const selected = themes.find((t) => t.value === theme);
      setStatus(`Theme switched to ${selected?.label ?? theme}.`);
    });
    const unsubExport = window.appApi.onMenuExportZip(() => {
      void onExportZip();
    });
    const unsubClear = window.appApi.onMenuClearGallery(() => {
      void onClearGallery();
    });

    return () => {
      unsubOpenSettings();
      unsubTheme();
      unsubExport();
      unsubClear();
    };
  }, []);

  const onSaveSettings = async (): Promise<void> => {
    const next = await window.appApi.saveSettings({
      apiKey: apiKeyInput.trim(),
      imageBackend: backendInput,
      ollamaBaseUrl: ollamaBaseUrlInput.trim() || "http://localhost:11434"
    });
    setAppData(next);
    setBackendInput(next.settings.imageBackend);
    setOllamaBaseUrlInput(next.settings.ollamaBaseUrl);
    const nextModels = await window.appApi.listModels();
    setModels(nextModels);
    setSelectedModelIds(nextModels.length > 0 ? [nextModels[0].model_id] : []);
    setStatusTone("success");
    setStatus(`Settings saved. Backend: ${next.settings.imageBackend}.`);
    setIsSettingsOpen(false);
  };

  const onThemeChange = async (nextTheme: ThemePreference): Promise<void> => {
    setThemeInput(nextTheme);
    applyTheme(nextTheme);
    const next = await window.appApi.setThemePreference(nextTheme);
    setAppData(next);
    setStatusTone("info");
    setStatus(`Theme switched to ${themes.find((t) => t.value === nextTheme)?.label ?? nextTheme}.`);
  };

  const applyPreset = (name: string): void => {
    const selected = presets.find((p) => p.name === name);
    if (!selected) {
      return;
    }
    setAspectRatio(selected.aspectRatio);
    setNegativePrompt(selected.negativePrompt);
    setPrompt((prev) => (prev ? `${prev}, ${selected.promptSuffix}` : selected.promptSuffix));
    setStatusTone("info");
    setStatus(`Applied preset: ${selected.name}`);
  };

  const onReferenceImage = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) {
      setReferenceImage(undefined);
      setReferencePreview(undefined);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? "");
      setReferenceImage(data);
      setReferencePreview(data);
    };
    reader.readAsDataURL(file);
  };

  const clearReferenceImage = (): void => {
    setReferenceImage(undefined);
    setReferencePreview(undefined);
  };

  const onGenerate = async (): Promise<void> => {
    if (!prompt.trim() || selectedModelIds.length === 0) {
      return;
    }

    setBusy(true);
    setStatusTone("info");
    setStatus("Initializing generation...");

    try {
      const safeCount = batchMode ? Math.max(2, Math.min(4, batchCount)) : 1;
      let successCount = 0;
      let failedCount = 0;

      for (const modelId of selectedModelIds) {
        const modelName = models.find((m) => m.model_id === modelId)?.name ?? modelId;
        setStatus(`Generating with ${modelName}${batchMode ? ` (${safeCount} images)` : ""}...`);

        const options: GenerationOptions = {
          model: modelId,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          stylePreset: presetName !== "None" ? presetName : undefined,
          aspectRatio,
          imageSize: modelId.toLowerCase().includes("gemini") ? imageSize : undefined,
          seed: useSeed ? seedValue : undefined,
          referenceImage
        };

        if (batchMode) {
          const results = await window.appApi.generateBatch(options, safeCount);
          successCount += results.filter((r) => r.ok).length;
          failedCount += results.filter((r) => !r.ok).length;
        } else {
          const result = await window.appApi.generateImage(options);
          if (result.ok) {
            successCount += 1;
          } else {
            failedCount += 1;
          }
        }
      }

      if (failedCount > 0) {
        setStatusTone("error");
        setStatus(`Completed: ${successCount} succeeded, ${failedCount} failed.`);
      } else {
        setStatusTone("success");
        setStatus(`Completed: ${successCount} image(s) generated.`);
      }

      await refreshData();
    } catch (error) {
      setStatusTone("error");
      setStatus(`Error: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const onSaveImageAs = async (item: GalleryItem): Promise<void> => {
    const result = await window.appApi.saveImageAs(item.path);
    setStatusTone(result.ok ? "success" : "error");
    setStatus(result.ok ? `Saved to ${result.path}` : `Save failed: ${result.error}`);
  };

  const onReuseImageSettings = (item: GalleryItem): void => {
    setPrompt(item.prompt ?? "");
    setNegativePrompt(item.negativePrompt ?? "");
    setPresetName(item.stylePreset ?? "None");
    setAspectRatio(item.aspectRatio ?? "1:1");

    if (item.imageSize) {
      setImageSize(item.imageSize);
    }

    if (typeof item.seed === "number") {
      setUseSeed(true);
      setSeedValue(item.seed);
    } else {
      setUseSeed(false);
    }

    setReferenceImage(undefined);
    setReferencePreview(undefined);

    setStatusTone("info");
    setStatus("Loaded prompt, style, and advanced controls from selected gallery image.");
  };

  if (loading) {
    return <main className="app-shell loading">Loading application...</main>;
  }

  return (
    <main className="app-shell desktop">
      <header className="desktop-header">
        <div>
          <h1>AI Open Image</h1>
          <p className="muted">Desktop studio for generation, iteration, and gallery export.</p>
        </div>
        <div className="desktop-header-actions">
          <select
            className="theme-select header-theme-select"
            value={themeInput}
            style={{ color: themeSelectColor(themeInput) }}
            onChange={(e) => {
              void onThemeChange(e.target.value as ThemePreference);
            }}
            aria-label="Theme"
            title="Theme"
          >
            {themes.map((theme) => (
              <option key={theme.value} value={theme.value}>{theme.label}</option>
            ))}
          </select>
          <button type="button" className="ghost" onClick={() => setIsSettingsOpen(true)}>Settings</button>
          <button type="button" onClick={onExportZip} disabled={appData.gallery.length === 0}>Export ZIP</button>
        </div>
      </header>

      {requiresApiKey && !appData.settings.apiKey ? (
        <div className="callout">
          API Key is required. Open <strong>Settings</strong> from the header or menu bar to configure OpenRouter.
        </div>
      ) : null}

      <section className="workspace">
        <aside className="tool-panel">
          <section>
            <label>Prompt</label>
            <textarea
              className="prompt-glow"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder="Positive Prompt - This tells the model what you want to see. Be concrete and intentional."
            />
          </section>

          <section>
            <label>Negative Prompt</label>
            <textarea
              className="negative-glow"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={4}
              placeholder="Negative Prompt - This tells the model what to avoid. Think of it as guardrails for your image."
            />
          </section>

          <section>
            <label>Models</label>
            <select
              multiple
              className="model-multiselect"
              value={selectedModelIds}
              onChange={(e) => {
                const next = Array.from(e.target.selectedOptions).map((option) => option.value);
                setSelectedModelIds(next);
              }}
            >
              {models.map((model) => (
                <option
                  key={model.model_id}
                  value={model.model_id}
                  title={`${model.description}\nBest for: ${model.best_for.join(", ")}\nCost: ${model.cost_estimate}`}
                >
                  {model.name} ({model.cost_estimate})
                </option>
              ))}
            </select>
            <small className="muted">Hold Ctrl/Cmd to select multiple models. Hover models for details.</small>
            <div className="model-card">
              <small>Selected models: {selectedModelIds.length}</small>
              <small>Estimated total operation cost: ~${totalExpectedCost.toFixed(4)}</small>
              {costBreakdown.length > 0 ? (
                <div className="cost-breakdown">
                  {costBreakdown.map((item) => (
                    <small key={item.modelId}>
                      {item.label}: ${item.unit.toFixed(4)} x {item.count} = ~${item.subtotal.toFixed(4)}
                    </small>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <div className="row">
              <label>Batch Generation</label>
              <label className="toggle-inline">
                <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
                <span>Enabled</span>
              </label>
            </div>
            {batchMode ? (
              <input
                type="number"
                min={2}
                max={4}
                value={batchCount}
                onChange={(e) => setBatchCount(Number.parseInt(e.target.value, 10) || 2)}
              />
            ) : null}
          </section>

          <section>
            <label>Style Preset</label>
            <select
              value={presetName}
              onChange={(e) => {
                const nextPreset = e.target.value;
                setPresetName(nextPreset);
                if (nextPreset !== "None") {
                  applyPreset(nextPreset);
                }
              }}
            >
              <option value="None">None</option>
              {presets.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name}
                </option>
              ))}
            </select>
          </section>

          <details className="advanced" open>
            <summary>Advanced Controls</summary>
            <div className="advanced-body">
              <div className="grid-two">
                <label>
                  Aspect Ratio
                  <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                    {aspectRatios.map((ratio) => (
                      <option key={ratio} value={ratio}>{ratio}</option>
                    ))}
                  </select>
                </label>

                {selectedModelIds.some((id) => id.toLowerCase().includes("gemini")) ? (
                  <label>
                    Image Size
                    <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                  </label>
                ) : (
                  <div />
                )}
              </div>

              <label className="toggle-inline">
                <input type="checkbox" checked={useSeed} onChange={(e) => setUseSeed(e.target.checked)} />
                <span>Set Seed</span>
              </label>
              {useSeed ? (
                <input type="number" value={seedValue} onChange={(e) => setSeedValue(Number.parseInt(e.target.value, 10) || 0)} />
              ) : null}

              <label>Image-to-Image</label>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onReferenceImage} />
              {!supportsImageInput ? <small className="warn">One or more selected models may not support image input.</small> : null}
              {referencePreview ? (
                <>
                  <img className="preview" src={referencePreview} alt="Reference" />
                  <button type="button" className="ghost" onClick={clearReferenceImage}>Remove Reference</button>
                </>
              ) : null}
            </div>
          </details>

          <button
            type="button"
            className="generate"
            disabled={busy || !prompt || (requiresApiKey && !appData.settings.apiKey) || selectedModelIds.length === 0}
            onClick={onGenerate}
          >
            {busy
              ? "Generating..."
              : `Generate ${batchMode ? `${Math.max(2, Math.min(4, batchCount))} per model` : "1 per model"}`}
          </button>
          <p className={`status ${statusTone}`}>{status}</p>
        </aside>

        <section className="content-panel">
          <div className="toolbar">
            <div>
              <h2>Gallery</h2>
              <p className="muted">Total cost tracked: ${appData.totalCost.toFixed(6)}</p>
            </div>
            <div className="toolbar-actions">
              <button type="button" className="ghost" onClick={onClearGallery} disabled={appData.gallery.length === 0}>Clear Gallery</button>
            </div>
          </div>

          <div className="gallery-grid">
            {appData.gallery.length === 0 ? <div className="empty">No images yet. Generate one from the tool panel.</div> : null}
            {appData.gallery
              .slice()
              .reverse()
              .map((item) => (
                <article key={item.id} className="card">
                  <img
                    src={imageSrc(item.path)}
                    alt={item.prompt.slice(0, 40)}
                    loading="lazy"
                    className="gallery-image"
                    onClick={() => setActiveImage(item)}
                  />
                  <div className="card-body">
                    <strong>{item.modelName}</strong>
                    <small>{new Date(item.timestamp).toLocaleString()}</small>
                    <small>{item.metadata?.dimensions ?? "Unknown Dimensions"}</small>
                    <small>{item.metadata?.sizeFormatted ?? "Unknown Size"}</small>
                    <small>Cost: ${(item.cost ?? 0).toFixed(6)}</small>
                    <small>Seed: {typeof item.seed === "number" ? item.seed : "None"}</small>
                    {item.batchMode ? <small>Variation {item.batchIndex}</small> : null}
                    {item.img2imgMode ? <small>Image-to-Image</small> : null}
                    <details>
                      <summary>Prompt</summary>
                      <p>{item.prompt}</p>
                    </details>
                    <button type="button" className="ghost" onClick={() => onReuseImageSettings(item)}>Use Settings</button>
                    <button type="button" onClick={() => onSaveImageAs(item)}>Save As...</button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      </section>

      {isSettingsOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="modal settings-modal">
            <header className="modal-header">
              <h3>Settings</h3>
            </header>

            <div className="modal-body">
              <label>Image Backend</label>
              <select value={backendInput} onChange={(e) => setBackendInput(e.target.value as ImageBackend)}>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama</option>
              </select>

              {backendInput === "openrouter" ? (
                <>
                  <label>OpenRouter API Key</label>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="sk-or-..."
                  />
                  <small className={appData.settings.apiKey ? "good" : "warn"}>
                    {appData.settings.apiKey ? "API Key is currently configured." : "No API Key configured."}
                  </small>
                </>
              ) : null}

              {backendInput === "ollama" ? (
                <>
                  <label>Ollama Base URL</label>
                  <input
                    type="text"
                    value={ollamaBaseUrlInput}
                    onChange={(e) => setOllamaBaseUrlInput(e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                  <small className="muted">When backend is Ollama, models are loaded from this URL.</small>
                </>
              ) : null}
            </div>

            <footer className="modal-footer">
              <button type="button" className="ghost" onClick={() => setIsSettingsOpen(false)}>Cancel</button>
              <button type="button" onClick={onSaveSettings}>Save Settings</button>
            </footer>
          </div>
        </div>
      ) : null}

      {activeImage ? (
        <div
          className="image-popover-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Image Preview"
          onClick={() => setActiveImage(null)}
        >
          <div className="image-popover" onClick={(e) => e.stopPropagation()}>
            <header className="image-popover-header">
              <div>
                <strong>{activeImage.modelName}</strong>
                <small className="muted">{new Date(activeImage.timestamp).toLocaleString()}</small>
              </div>
              <div className="toolbar-actions">
                <button type="button" className="ghost" onClick={() => onReuseImageSettings(activeImage)}>Use Settings</button>
                <button type="button" onClick={() => onSaveImageAs(activeImage)}>Save As...</button>
                <button type="button" className="ghost" onClick={() => setActiveImage(null)}>Close</button>
              </div>
            </header>

            <div className="image-popover-body">
              <div className="image-popover-preview-wrap">
                <img src={imageSrc(activeImage.path)} alt={activeImage.prompt.slice(0, 80)} className="image-popover-preview" />
              </div>
              <aside className="image-popover-meta">
                <h3>Generation Details</h3>
                <div className="meta-grid">
                  <small>Model</small>
                  <small>{activeImage.modelName}</small>
                  <small>Model ID</small>
                  <small>{activeImage.model}</small>
                  <small>Generated</small>
                  <small>{new Date(activeImage.timestamp).toLocaleString()}</small>
                  <small>Cost</small>
                  <small>${(activeImage.cost ?? 0).toFixed(6)}</small>
                  <small>Dimensions</small>
                  <small>{activeImage.metadata?.dimensions ?? "Unknown"}</small>
                  <small>File Size</small>
                  <small>{activeImage.metadata?.sizeFormatted ?? "Unknown"}</small>
                  <small>Format</small>
                  <small>{activeImage.metadata?.format ?? "Unknown"}</small>
                  <small>Aspect Ratio</small>
                  <small>{activeImage.aspectRatio ?? "Default"}</small>
                  <small>Image Size</small>
                  <small>{activeImage.imageSize ?? "Default"}</small>
                  <small>Seed</small>
                  <small>{typeof activeImage.seed === "number" ? activeImage.seed : "None"}</small>
                  <small>Style Preset</small>
                  <small>{activeImage.stylePreset ?? "None"}</small>
                  <small>Image-to-Image</small>
                  <small>{activeImage.img2imgMode ? "Yes" : "No"}</small>
                  <small>Batch</small>
                  <small>{activeImage.batchMode ? `Yes (variation ${activeImage.batchIndex ?? "?"})` : "No"}</small>
                </div>
                <details open>
                  <summary>Prompt</summary>
                  <p>{activeImage.prompt}</p>
                </details>
                <details open>
                  <summary>Negative Prompt</summary>
                  <p>{activeImage.negativePrompt ?? "None"}</p>
                </details>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};

export default App;
