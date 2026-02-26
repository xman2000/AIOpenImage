import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
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

type AppInfo = {
  name: string;
  version: string;
  releaseDate: string;
  platform: string;
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

const createEditRunId = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  return `run_${Date.now().toString(36)}_${random}`;
};

const App = (): JSX.Element => {
  const [loading, setLoading] = useState(true);
  const [loadingStatusText, setLoadingStatusText] = useState("Starting up...");
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [loadingScreenShown, setLoadingScreenShown] = useState(false);
  const [loadingScreenHidden, setLoadingScreenHidden] = useState(false);
  const [appVisible, setAppVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"idle" | "info" | "success" | "error">("idle");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<GalleryItem | null>(null);
  const [fullscreenImageSrc, setFullscreenImageSrc] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "AI Open Image",
    version: "0.2.0",
    releaseDate: "Local Build",
    platform: "win32"
  });

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [isEditStudioOpen, setIsEditStudioOpen] = useState(false);
  const [editSourceImage, setEditSourceImage] = useState<GalleryItem | null>(null);
  const [editRunId, setEditRunId] = useState<string | undefined>(undefined);
  const [latestEditResultSrc, setLatestEditResultSrc] = useState<string | null>(null);
  const [compareValue, setCompareValue] = useState(50);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [editSourceAspectRatio, setEditSourceAspectRatio] = useState(1);
  const [maskTool, setMaskTool] = useState<"brush" | "erase" | "rect">("brush");
  const [maskBrushSize, setMaskBrushSize] = useState(24);
  const [showMaskTint, setShowMaskTint] = useState(true);
  const [maskDataUrl, setMaskDataUrl] = useState<string | undefined>(undefined);
  const [maskPath, setMaskPath] = useState<string | undefined>(undefined);
  const [maskDirty, setMaskDirty] = useState(false);
  const [modelWarnings, setModelWarnings] = useState<string[]>([]);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskDrawingRef = useRef(false);
  const maskLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const rectStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const rectBaseImageRef = useRef<ImageData | null>(null);
  const compareDraggingRef = useRef(false);
  const bootStartedAtRef = useRef<number>(Date.now());

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
      try {
        setLoadingStatusText("Loading workspace...");
        const loadedData = await window.appApi.loadAppData();

        setLoadingStatusText("Loading model catalog...");
        const loadedModels = await window.appApi.listModels();

        setLoadingStatusText("Loading app info...");
        const loadedInfo = await window.appApi.getAppInfo();

        setAppData(loadedData);
        setAppInfo(loadedInfo);
        setApiKeyInput(loadedData.settings.apiKey ?? "");
        setBackendInput(loadedData.settings.imageBackend ?? "openrouter");
        setOllamaBaseUrlInput(loadedData.settings.ollamaBaseUrl ?? "http://localhost:11434");
        setThemeInput(loadedData.settings.themePreference ?? "system");
        applyTheme(loadedData.settings.themePreference ?? "system");
        setModels(loadedModels);
        if (loadedModels.length > 0) {
          setSelectedModelIds([loadedModels[0].model_id]);
        }
      } catch (error) {
        setStatusTone("error");
        setStatus(`Startup warning: ${String(error)}`);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    const enterTimer = window.setTimeout(() => setLoadingScreenShown(true), 20);
    return () => window.clearTimeout(enterTimer);
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }
    setLoadingStatusText("Ready.");
    const elapsed = Date.now() - bootStartedAtRef.current;
    const minVisibleMs = 900;
    const transitionMs = 1500;
    const startDelay = Math.max(0, minVisibleMs - elapsed);

    const fadeTimer = window.setTimeout(() => {
      setLoadingScreenHidden(true);
      setAppVisible(true);
    }, startDelay);

    const removeTimer = window.setTimeout(() => {
      setShowLoadingScreen(false);
    }, startDelay + transitionMs);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [loading]);

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

  useEffect(() => {
    if (!isEditMode || !editSourceImage) {
      return;
    }
    const canvas = maskCanvasRef.current;
    if (!canvas) {
      return;
    }
    const width = Math.max(1, editSourceImage.metadata?.width ?? 1024);
    const height = Math.max(1, editSourceImage.metadata?.height ?? 1024);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
    }
  }, [isEditMode, editSourceImage]);

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
    const unsubOpenAbout = window.appApi.onOpenAbout(() => setIsAboutOpen(true));
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
      unsubOpenAbout();
      unsubTheme();
      unsubExport();
      unsubClear();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (activeMenu && menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";

      if (event.key === "Escape") {
        if (fullscreenImageSrc) {
          setFullscreenImageSrc(null);
          return;
        }
        if (isEditStudioOpen) {
          setIsEditStudioOpen(false);
          return;
        }
      }

      if (isEditStudioOpen && !isTyping) {
        if (event.key === "b" || event.key === "B") {
          setMaskTool("brush");
        } else if (event.key === "e" || event.key === "E") {
          setMaskTool("erase");
        } else if (event.key === "r" || event.key === "R") {
          setMaskTool("rect");
        } else if (event.key === "[") {
          setMaskBrushSize((prev) => Math.max(1, prev - 2));
        } else if (event.key === "]") {
          setMaskBrushSize((prev) => Math.min(50, prev + 2));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreenImageSrc, isEditStudioOpen]);

  const onSaveSettings = async (): Promise<void> => {
    const next = await window.appApi.saveSettings({
      apiKey: backendInput === "openrouter" ? apiKeyInput.trim() : undefined,
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

  const clearMask = (): void => {
    const canvas = maskCanvasRef.current;
    if (!canvas) {
      setMaskDataUrl(undefined);
      setMaskDirty(false);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setMaskDataUrl(undefined);
    setMaskPath(undefined);
    setMaskDirty(false);
  };

  const updateMaskData = (): void => {
    const canvas = maskCanvasRef.current;
    if (!canvas) {
      return;
    }
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) {
      return;
    }
    exportCtx.drawImage(canvas, 0, 0);
    const imageData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha > 0) {
        pixels[index] = 255;
        pixels[index + 1] = 255;
        pixels[index + 2] = 255;
      }
    }
    exportCtx.putImageData(imageData, 0, 0);
    setMaskDataUrl(exportCanvas.toDataURL("image/png"));
    setMaskPath(undefined);
    setMaskDirty(true);
  };

  const pointerToCanvas = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  const drawMaskStroke = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const canvas = maskCanvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.save();
    const width = Math.max(1, maskBrushSize);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    if (maskTool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = "source-over";
      if (showMaskTint) {
        ctx.strokeStyle = "rgba(255, 64, 64, 0.44)";
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = width + 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.49)";
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  const onMaskPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const point = pointerToCanvas(event);
    if (!point) {
      return;
    }
    maskDrawingRef.current = true;
    maskLastPointRef.current = point;
    if (maskTool === "rect") {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        rectStartPointRef.current = point;
        rectBaseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } else {
      drawMaskStroke(point, point);
      updateMaskData();
    }
  };

  const onMaskPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!maskDrawingRef.current) {
      return;
    }
    const point = pointerToCanvas(event);
    const last = maskLastPointRef.current;
    if (!point || !last) {
      return;
    }
    if (maskTool === "rect") {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      const start = rectStartPointRef.current;
      const base = rectBaseImageRef.current;
      if (!canvas || !ctx || !start || !base) {
        return;
      }
      ctx.putImageData(base, 0, 0);
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const width = Math.abs(point.x - start.x);
      const height = Math.abs(point.y - start.y);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = showMaskTint ? "rgba(255, 64, 64, 0.16)" : "rgba(255,255,255,0.19)";
      ctx.strokeStyle = showMaskTint ? "rgba(255, 96, 96, 0.48)" : "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
      return;
    }
    drawMaskStroke(last, point);
    maskLastPointRef.current = point;
    updateMaskData();
  };

  const onMaskPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!maskDrawingRef.current) {
      return;
    }
    const canvas = maskCanvasRef.current;
    const start = rectStartPointRef.current;
    const end = pointerToCanvas(event);
    if (canvas && start && end && maskTool === "rect") {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (rectBaseImageRef.current) {
          ctx.putImageData(rectBaseImageRef.current, 0, 0);
        }
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = showMaskTint ? "rgba(255, 64, 64, 0.45)" : "rgba(255,255,255,0.49)";
        ctx.fillRect(x, y, width, height);
        ctx.restore();
        updateMaskData();
      }
    }
    maskDrawingRef.current = false;
    maskLastPointRef.current = null;
    rectStartPointRef.current = null;
    rectBaseImageRef.current = null;
  };

  const onMaskPointerLeave = (): void => {
    if (maskTool === "rect") {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx && rectBaseImageRef.current) {
        ctx.putImageData(rectBaseImageRef.current, 0, 0);
      }
    }
    maskDrawingRef.current = false;
    maskLastPointRef.current = null;
    rectStartPointRef.current = null;
    rectBaseImageRef.current = null;
  };

  const updateCompareFromClientX = (clientX: number, element: HTMLDivElement): void => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }
    const ratio = ((clientX - bounds.left) / bounds.width) * 100;
    const clamped = Math.max(0, Math.min(100, ratio));
    setCompareValue(clamped);
  };

  const onComparePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    compareDraggingRef.current = true;
    updateCompareFromClientX(event.clientX, event.currentTarget);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onComparePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!compareDraggingRef.current) {
      return;
    }
    updateCompareFromClientX(event.clientX, event.currentTarget);
  };

  const onComparePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    compareDraggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onStartEdit = async (item: GalleryItem): Promise<void> => {
    setBusy(true);
    setStatusTone("info");
    setStatus("Loading source image for editing...");
    const loaded = await window.appApi.loadImageAsDataUrl(item.path);
    if (!loaded.ok || !loaded.dataUrl) {
      setBusy(false);
      setStatusTone("error");
      setStatus(loaded.error ?? "Could not load source image for editing.");
      return;
    }
    setIsEditMode(true);
    setEditSourceImage(item);
    setEditRunId(createEditRunId());
    setReferenceImage(loaded.dataUrl);
    setReferencePreview(imageSrc(item.path));
    const width = item.metadata?.width ?? 1024;
    const height = item.metadata?.height ?? 1024;
    setEditSourceAspectRatio(Math.max(1, width) / Math.max(1, height));
    setPrompt("");
    setLatestEditResultSrc(null);
    setCompareValue(50);
    setIsCompareMode(false);
    setMaskDataUrl(undefined);
    setMaskPath(undefined);
    setMaskDirty(false);
    clearMask();
    setActiveImage(null);
    setIsEditStudioOpen(true);
    setBusy(false);
    setStatusTone("info");
    setStatus(`Editing mode active for ${item.filename}. Add an instruction, then generate.`);
  };

  const exitEditMode = (): void => {
    setIsEditMode(false);
    setEditSourceImage(null);
    setEditRunId(undefined);
    setMaskDataUrl(undefined);
    setMaskPath(undefined);
    setMaskDirty(false);
    setLatestEditResultSrc(null);
    setCompareValue(50);
    setIsCompareMode(false);
    setEditSourceAspectRatio(1);
    setIsEditStudioOpen(false);
    maskDrawingRef.current = false;
    maskLastPointRef.current = null;
    clearReferenceImage();
    clearMask();
    setStatusTone("info");
    setStatus("Exited edit mode.");
  };

  const onGenerate = async (): Promise<void> => {
    if (!prompt.trim() || selectedModelIds.length === 0) {
      return;
    }
    if (isEditMode && !editSourceImage) {
      setStatusTone("error");
      setStatus("Edit mode requires a source image.");
      return;
    }
    if (isEditMode && !referenceImage) {
      setStatusTone("error");
      setStatus("Unable to locate source image payload for edit mode.");
      return;
    }

    setBusy(true);
    setModelWarnings([]);
    setStatusTone("info");
    setStatus(isEditMode ? "Initializing edit run..." : "Initializing generation...");

    try {
      const safeCount = batchMode ? Math.max(2, Math.min(4, batchCount)) : 1;
      let successCount = 0;
      let failedCount = 0;
      const warnings: string[] = [];
      let currentMaskPath = maskPath;
      let latestProducedPath: string | null = null;

      if (isEditMode && maskDataUrl && maskDirty) {
        const runId = editRunId ?? createEditRunId();
        if (!editRunId) {
          setEditRunId(runId);
        }
        const savedMask = await window.appApi.saveMask(maskDataUrl, runId);
        if (savedMask.ok && savedMask.path) {
          currentMaskPath = savedMask.path;
          setMaskPath(savedMask.path);
          setMaskDirty(false);
        } else {
          warnings.push(savedMask.error ?? "Mask could not be persisted. Continuing without saved mask path.");
        }
      }

      for (const modelId of selectedModelIds) {
        const model = models.find((m) => m.model_id === modelId);
        const modelName = model?.name ?? modelId;
        const canImageInput = Boolean(model?.input_modalities?.includes("image"));
        const canMaskEdit = Boolean(model?.supportsMaskEdit);
        const wantsMaskEdit = isEditMode && Boolean(maskDataUrl);
        const modelMaskEnabled = wantsMaskEdit && canMaskEdit;

        if (isEditMode && !canImageInput) {
          warnings.push(`${modelName}: model does not support image input, skipped.`);
          failedCount += batchMode ? safeCount : 1;
          continue;
        }
        if (wantsMaskEdit && !canMaskEdit) {
          warnings.push(`${modelName}: mask edits unsupported, using full-image edit fallback.`);
        }

        setStatus(
          `${isEditMode ? "Editing" : "Generating"} with ${modelName}${batchMode ? ` (${safeCount} images)` : ""}...`
        );

        const runId = isEditMode ? (editRunId ?? createEditRunId()) : undefined;
        if (isEditMode && !editRunId && runId) {
          setEditRunId(runId);
        }

        const options: GenerationOptions = {
          model: modelId,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          stylePreset: presetName !== "None" ? presetName : undefined,
          aspectRatio,
          imageSize: modelId.toLowerCase().includes("gemini") ? imageSize : undefined,
          seed: useSeed ? seedValue : undefined,
          referenceImage,
          maskImage: modelMaskEnabled ? maskDataUrl : undefined,
          maskPath: modelMaskEnabled ? currentMaskPath : undefined,
          editMode: isEditMode ? (modelMaskEnabled ? "mask-edit" : "edit") : "generate",
          parentImageId: isEditMode ? editSourceImage?.id : undefined,
          editRunId: isEditMode ? runId : undefined,
          editInstruction: isEditMode ? prompt.trim() : undefined,
          sourceImagePath: isEditMode ? editSourceImage?.path : undefined
        };

        if (batchMode) {
          const results = await window.appApi.generateBatch(options, safeCount);
          const successful = results.filter((r) => r.ok);
          successCount += successful.length;
          failedCount += results.filter((r) => !r.ok).length;
          const latest = successful.at(-1)?.image;
          if (latest?.path) {
            latestProducedPath = latest.path;
          }
        } else {
          const result = await window.appApi.generateImage(options);
          if (result.ok) {
            successCount += 1;
            if (result.image?.path) {
              latestProducedPath = result.image.path;
            }
          } else {
            failedCount += 1;
          }
        }
      }

      setModelWarnings(warnings);
      if (isEditMode && latestProducedPath) {
        setLatestEditResultSrc(imageSrc(latestProducedPath));
        setIsCompareMode(true);
      }

      if (failedCount > 0) {
        setStatusTone("error");
        setStatus(
          `${isEditMode ? "Edit run" : "Generation"} completed: ${successCount} succeeded, ${failedCount} failed.${
            warnings.length ? ` ${warnings.length} warning(s).` : ""
          }`
        );
      } else {
        setStatusTone("success");
        setStatus(
          `${isEditMode ? "Edit run" : "Generation"} completed: ${successCount} image(s) produced.${
            warnings.length ? ` ${warnings.length} warning(s).` : ""
          }`
        );
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

  const menuItems: { label: string; items: { label: string; accelerator?: string; type?: "separator"; action?: () => void; submenu?: { label: string; checked?: boolean; action: () => void }[] }[] }[] = [
    {
      label: "File",
      items: [
        { label: "Export Gallery ZIP", accelerator: "Ctrl+Shift+E", action: () => void onExportZip() },
        { label: "Clear Gallery", accelerator: "Ctrl+Shift+Backspace", action: () => void onClearGallery() },
        { type: "separator", label: "" },
        { label: "Quit", accelerator: "Ctrl+Q", action: () => void window.appApi.menuQuit() }
      ]
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", accelerator: "Ctrl+Z", action: () => void window.appApi.menuUndo() },
        { label: "Redo", accelerator: "Ctrl+Y", action: () => void window.appApi.menuRedo() },
        { type: "separator", label: "" },
        { label: "Cut", accelerator: "Ctrl+X", action: () => void window.appApi.menuCut() },
        { label: "Copy", accelerator: "Ctrl+C", action: () => void window.appApi.menuCopy() },
        { label: "Paste", accelerator: "Ctrl+V", action: () => void window.appApi.menuPaste() },
        { label: "Select All", accelerator: "Ctrl+A", action: () => void window.appApi.menuSelectAll() }
      ]
    },
    {
      label: "View",
      items: [
        { label: "Reload", accelerator: "Ctrl+R", action: () => void window.appApi.menuReload() },
        { label: "Force Reload", accelerator: "Ctrl+Shift+R", action: () => void window.appApi.menuForceReload() },
        { label: "Toggle DevTools", accelerator: "F12", action: () => void window.appApi.menuToggleDevTools() },
        { type: "separator", label: "" },
        { label: "Reset Zoom", accelerator: "Ctrl+0", action: () => void window.appApi.menuResetZoom() },
        { label: "Zoom In", accelerator: "Ctrl++", action: () => void window.appApi.menuZoomIn() },
        { label: "Zoom Out", accelerator: "Ctrl+-", action: () => void window.appApi.menuZoomOut() },
        { type: "separator", label: "" },
        { label: "Toggle Fullscreen", accelerator: "F11", action: () => void window.appApi.menuToggleFullscreen() }
      ]
    },
    {
      label: "Settings",
      items: [
        { label: "Open Settings...", accelerator: "Ctrl+,", action: () => setIsSettingsOpen(true) },
        {
          label: "Theme",
          submenu: themes.map((t) => ({
            label: t.label,
            checked: themeInput === t.value,
            action: () => void onThemeChange(t.value)
          }))
        }
      ]
    },
    {
      label: "Help",
      items: [
        { label: "OpenRouter Keys", action: () => void window.appApi.menuOpenExternal("https://openrouter.ai/keys") },
        { label: "About", action: () => setIsAboutOpen(true) }
      ]
    }
  ];

  return (
    <>
      <div className="custom-titlebar" ref={menuBarRef}>
        <div className="custom-titlebar-menus">
          {menuItems.map((menu) => (
            <div
              key={menu.label}
              className={`custom-menu ${activeMenu === menu.label ? "custom-menu-open" : ""}`}
            >
              <button
                className="custom-menu-trigger"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActiveMenu(activeMenu === menu.label ? null : menu.label);
                }}
                onMouseEnter={() => {
                  if (activeMenu && activeMenu !== menu.label) {
                    setActiveMenu(menu.label);
                  }
                }}
              >
                {menu.label}
              </button>
              {activeMenu === menu.label && (
                <div className="custom-menu-dropdown">
                  {menu.items.map((item, idx) =>
                    item.type === "separator" ? (
                      <div key={`sep-${idx}`} className="custom-menu-separator" />
                    ) : item.submenu ? (
                      <div key={item.label} className="custom-menu-item custom-menu-submenu-parent">
                        <span>{item.label}</span>
                        <span className="custom-menu-arrow">&#9656;</span>
                        <div className="custom-menu-submenu">
                          {item.submenu.map((sub) => (
                            <button
                              key={sub.label}
                              className={`custom-menu-item ${sub.checked ? "custom-menu-checked" : ""}`}
                              onClick={() => { sub.action(); setActiveMenu(null); }}
                            >
                              <span className="custom-menu-check">{sub.checked ? "\u2022" : ""}</span>
                              <span>{sub.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={item.label}
                        className="custom-menu-item"
                        onClick={() => { item.action?.(); setActiveMenu(null); }}
                      >
                        <span>{item.label}</span>
                        {item.accelerator && <span className="custom-menu-accel">{item.accelerator}</span>}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="custom-titlebar-drag" />
      </div>
      <main className={`app-shell desktop ${appVisible ? "app-shell-visible" : "app-shell-hidden"}`}>
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
        </div>
      </header>

      {requiresApiKey && !appData.settings.apiKey ? (
        <div className="callout">
          API Key is required. Open <strong>Settings</strong> from the header or menu bar to configure OpenRouter.
        </div>
      ) : null}

      <section className="workspace">
        <aside className="tool-panel">
          <section className="no-divider">
            {isEditMode && editSourceImage ? (
              <div className="edit-callout">
                <strong>Edit Mode</strong>
                <small>Source: {editSourceImage.filename}</small>
                <small>Run: {editRunId?.slice(0, 12) ?? "pending"}</small>
                <button type="button" className="ghost" onClick={() => setIsEditStudioOpen(true)}>Open Edit Studio</button>
                <button type="button" className="ghost" onClick={exitEditMode}>Exit Edit Mode</button>
              </div>
            ) : null}

            <label>Prompt</label>
            <textarea
              className="prompt-glow"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder={
                isEditMode
                  ? "Edit instruction - e.g. no, i meant blonde hair, keep pose and lighting."
                  : "Positive Prompt - This tells the model what you want to see. Be concrete and intentional."
              }
            />
          </section>

          <section className="no-divider">
            <label>Negative Prompt</label>
            <textarea
              className="negative-glow"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={4}
              placeholder="Negative Prompt - This tells the model what to avoid. Think of it as guardrails for your image."
            />

            <div className={`generate-wrap${busy || !prompt || (requiresApiKey && !appData.settings.apiKey) || selectedModelIds.length === 0 || (isEditMode && !referenceImage) ? " generate-wrap-disabled" : ""}`}>
              <button
                type="button"
                className="generate"
                disabled={
                  busy ||
                  !prompt ||
                  (requiresApiKey && !appData.settings.apiKey) ||
                  selectedModelIds.length === 0 ||
                  (isEditMode && !referenceImage)
                }
                onClick={onGenerate}
              >
                {busy
                  ? isEditMode
                    ? "Editing..."
                    : "Generating..."
                  : "Let's Go!"}
              </button>
            </div>
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

              {isEditMode ? (
                <>
                  <label>Edit Source</label>
                  {referencePreview ? <img className="preview" src={referencePreview} alt="Edit Source" /> : null}
                  <small className="muted">Mask drawing and compare controls live in Edit Studio.</small>
                  <button type="button" className="ghost" onClick={() => setIsEditStudioOpen(true)}>Open Edit Studio</button>
                </>
              ) : (
                <>
                  <label>Image-to-Image</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onReferenceImage} />
                  {!supportsImageInput ? <small className="warn">One or more selected models may not support image input.</small> : null}
                  {referencePreview ? (
                    <>
                      <img className="preview" src={referencePreview} alt="Reference" />
                      <button type="button" className="ghost" onClick={clearReferenceImage}>Remove Reference</button>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </details>

          <p className={`status ${statusTone}`}>{status}</p>
          {modelWarnings.length ? (
            <div className="warning-list">
              {modelWarnings.map((warning, index) => (
                <small key={`${warning}-${index}`} className="warn">{warning}</small>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="content-panel">
          <div className="toolbar">
            <div>
              <h2>Gallery</h2>
              <p className="muted">Total cost tracked: ${appData.totalCost.toFixed(6)}</p>
            </div>
            <div className="toolbar-actions">
              <button type="button" className="ghost" onClick={onClearGallery} disabled={appData.gallery.length === 0}>Clear Gallery</button>
              <button type="button" onClick={onExportZip} disabled={appData.gallery.length === 0}>Export ZIP</button>
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
                    <div className="tag-row">
                      {item.editMode && item.editMode !== "generate" ? (
                        <small className="tag">{item.editMode === "mask-edit" ? "Mask Edit" : "Edited"}</small>
                      ) : null}
                      {item.editRunId ? <small className="tag">Run {item.editRunId.slice(0, 8)}</small> : null}
                      {item.parentImageId ? <small className="tag">From {item.parentImageId.slice(0, 8)}</small> : null}
                    </div>
                    <button type="button" className="ghost" onClick={() => void onStartEdit(item)}>Edit</button>
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

      {isAboutOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="About">
          <div className="modal about-modal">
            <header className="modal-header">
              <h3>About</h3>
            </header>
            <div className="modal-body">
              <div className="about-hero">
                <div className="about-title">{appInfo.name}</div>
                <div className="about-subtitle">Desktop AI image studio</div>
              </div>

              <div className="about-grid">
                <div className="about-card">
                  <div className="about-card-label">Version</div>
                  <div className="about-card-value">{appInfo.version}</div>
                </div>
                <div className="about-card">
                  <div className="about-card-label">Release Date</div>
                  <div className="about-card-value">{appInfo.releaseDate}</div>
                </div>
                <div className="about-card">
                  <div className="about-card-label">Platform</div>
                  <div className="about-card-value">{appInfo.platform}</div>
                </div>
              </div>

              <div className="about-links">
                <a
                  className="about-link"
                  href="https://github.com/aporb/openrouter-image-gen"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenRouter Image Gen
                </a>
                <a className="about-link" href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a>
                <a className="about-link" href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a>
                <a className="about-link" href="https://www.electronjs.org" target="_blank" rel="noreferrer">Electron</a>
                <a className="about-link" href="https://vite.dev" target="_blank" rel="noreferrer">Vite</a>
                <a className="about-link" href="https://react.dev" target="_blank" rel="noreferrer">React</a>
              </div>
            </div>
            <footer className="modal-footer">
              <button type="button" className="ghost" onClick={() => setIsAboutOpen(false)}>Close</button>
            </footer>
          </div>
        </div>
      ) : null}

      {isEditStudioOpen && isEditMode && editSourceImage ? (
        <div className="edit-studio-backdrop" role="dialog" aria-modal="true" aria-label="Edit Studio">
          <div className="edit-studio" onClick={(e) => e.stopPropagation()}>
            <header className="edit-studio-header">
              <div>
                <h3>Edit Studio</h3>
                <small className="muted">Source: {editSourceImage.filename}</small>
              </div>
              <div className="toolbar-actions">
                <button type="button" className="ghost" onClick={exitEditMode}>Exit Edit Mode</button>
              </div>
            </header>

            <div className="edit-studio-body">
              <section className="edit-studio-canvas-section">
                <div className="mask-tools">
                  <div className="tool-group" role="group" aria-label="Mask tools">
                    <button
                      type="button"
                      className={`tool-btn ${maskTool === "brush" ? "active" : ""}`}
                      onClick={() => setMaskTool("brush")}
                      title="Brush (B)"
                      aria-label="Brush tool"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="9" cy="19" r="3" />
                        <path d="M10.5 16.5C12 14 14 11 17 8c2-2 4-3 4-3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`tool-btn ${maskTool === "erase" ? "active" : ""}`}
                      onClick={() => setMaskTool("erase")}
                      title="Eraser (E)"
                      aria-label="Eraser tool"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 20H9.5l-5.3-5.3a2 2 0 010-2.8L13.4 3a2 2 0 012.8 0l5.5 5.5a2 2 0 010 2.8L15 18" />
                        <path d="M18 13l-8-8" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`tool-btn ${maskTool === "rect" ? "active" : ""}`}
                      onClick={() => setMaskTool("rect")}
                      title="Rectangle Select (R)"
                      aria-label="Rectangle tool"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
                      </svg>
                    </button>
                  </div>
                  <label className="brush-size" title="Brush size">
                    <small>{maskBrushSize}px</small>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={maskBrushSize}
                      onChange={(e) => setMaskBrushSize(Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 24)))}
                    />
                  </label>
                  <label className="toggle-inline mask-tint-toggle">
                    <input type="checkbox" checked={showMaskTint} onChange={(e) => setShowMaskTint(e.target.checked)} />
                    <span>Red Tint</span>
                  </label>
                  {latestEditResultSrc ? (
                    <button type="button" className="ghost" onClick={() => setIsCompareMode((prev) => !prev)}>
                      {isCompareMode ? "Back to Edit" : "Compare"}
                    </button>
                  ) : null}
                  <button type="button" className="ghost" onClick={clearMask}>Clear Mask</button>
                </div>

                {isCompareMode && latestEditResultSrc && referencePreview ? (
                  <div className="edit-studio-canvas-wrap" style={{ ["--stage-aspect" as string]: `${editSourceAspectRatio}` }}>
                    <div
                      className="compare-stage"
                      onPointerDown={onComparePointerDown}
                      onPointerMove={onComparePointerMove}
                      onPointerUp={onComparePointerUp}
                      onPointerCancel={onComparePointerUp}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <div className="compare-after">
                        <img src={latestEditResultSrc} alt="Edited result" className="compare-layer-image" draggable={false} />
                      </div>
                      <div className="compare-before" style={{ clipPath: `inset(0 ${100 - compareValue}% 0 0)` }}>
                        <img src={referencePreview} alt="Original" className="compare-layer-image" draggable={false} />
                      </div>
                      <div className="compare-divider" style={{ left: `${compareValue}%` }} />
                    </div>
                  </div>
                ) : (
                  <div
                    className="edit-studio-canvas-wrap"
                    style={{
                      ["--stage-aspect" as string]: `${editSourceAspectRatio}`
                    }}
                  >
                    {referencePreview ? (
                      <img
                        className="edit-studio-image"
                        src={referencePreview}
                        alt="Edit source"
                        onLoad={(event) => {
                          const img = event.currentTarget;
                          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                            setEditSourceAspectRatio(img.naturalWidth / img.naturalHeight);
                          }
                        }}
                      />
                    ) : null}
                    <canvas
                      ref={maskCanvasRef}
                      className="edit-studio-mask-canvas"
                      onPointerDown={onMaskPointerDown}
                      onPointerMove={onMaskPointerMove}
                      onPointerUp={onMaskPointerUp}
                      onPointerLeave={onMaskPointerLeave}
                    />
                  </div>
                )}
              </section>

              <aside className="edit-studio-controls">
                <label>Edit Instruction</label>
                <textarea
                  className="prompt-glow"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  placeholder="Describe what to change while keeping the rest intact."
                />

                <label>Negative Prompt</label>
                <textarea
                  className="negative-glow"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={4}
                  placeholder="What to avoid in the edit"
                />

                <small className="muted">Models selected: {selectedModelIds.length}</small>
                <small className="muted">Batch: {batchMode ? `${Math.max(2, Math.min(4, batchCount))} per model` : "1 per model"}</small>
                {modelWarnings.length ? (
                  <div className="warning-list">
                    {modelWarnings.map((warning, index) => (
                      <small key={`studio-${warning}-${index}`} className="warn">{warning}</small>
                    ))}
                  </div>
                ) : null}

                <div className={`generate-wrap${busy || !prompt || selectedModelIds.length === 0 || !referenceImage ? " generate-wrap-disabled" : ""}`}>
                  <button
                    type="button"
                    className="generate"
                    disabled={busy || !prompt || selectedModelIds.length === 0 || !referenceImage}
                    onClick={onGenerate}
                  >
                    {busy ? "Editing..." : "Edit"}
                  </button>
                </div>
              </aside>
            </div>
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
                <button type="button" className="ghost" onClick={() => void onStartEdit(activeImage)}>Edit</button>
                <button type="button" className="ghost" onClick={() => onReuseImageSettings(activeImage)}>Use Settings</button>
                <button type="button" onClick={() => onSaveImageAs(activeImage)}>Save As...</button>
                <button type="button" className="ghost" onClick={() => setActiveImage(null)}>Close</button>
              </div>
            </header>

            <div className="image-popover-body">
              <div className="image-popover-preview-wrap">
                <img
                  src={imageSrc(activeImage.path)}
                  alt={activeImage.prompt.slice(0, 80)}
                  className="image-popover-preview"
                  onClick={() => setFullscreenImageSrc(imageSrc(activeImage.path))}
                  title="Click to view fullscreen"
                />
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
                  <small>Edit Mode</small>
                  <small>{activeImage.editMode ?? "generate"}</small>
                  <small>Edit Run</small>
                  <small>{activeImage.editRunId ?? "None"}</small>
                  <small>Parent Image</small>
                  <small>{activeImage.parentImageId ?? "None"}</small>
                  <small>Mask</small>
                  <small>{activeImage.maskPath ? "Attached" : "None"}</small>
                  <small>Batch</small>
                  <small>{activeImage.batchMode ? `Yes (variation ${activeImage.batchIndex ?? "?"})` : "No"}</small>
                </div>
                <details open>
                  <summary>Prompt</summary>
                  <p>{activeImage.prompt}</p>
                </details>
                {activeImage.editInstruction ? (
                  <details open>
                    <summary>Edit Instruction</summary>
                    <p>{activeImage.editInstruction}</p>
                  </details>
                ) : null}
                <details open>
                  <summary>Negative Prompt</summary>
                  <p>{activeImage.negativePrompt ?? "None"}</p>
                </details>
              </aside>
            </div>
          </div>
        </div>
      ) : null}

      {fullscreenImageSrc ? (
        <div
          className="fullscreen-image-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen image preview"
          onClick={() => setFullscreenImageSrc(null)}
        >
          <img
            src={fullscreenImageSrc}
            alt="Fullscreen preview"
            className="fullscreen-image"
            onClick={(e) => e.stopPropagation()}
          />
          <button type="button" className="fullscreen-close" onClick={() => setFullscreenImageSrc(null)}>Close</button>
        </div>
      ) : null}

      {busy ? (
        <div className="gen-popover" role="status" aria-live="polite" aria-label="Generation in progress">
          <div className="gen-popover-header">
            <span className="gen-popover-title">{isEditMode ? "Editing" : "Generating"}</span>
          </div>
          <p className="gen-popover-status">{status}</p>
          <div className="gen-popover-bar-track" aria-hidden="true">
            <div className="gen-popover-bar-fill" />
          </div>
        </div>
      ) : null}
      </main>

      {showLoadingScreen ? (
        <div
          id="loading-screen"
          className={`${loadingScreenShown ? "is-visible" : ""} ${loadingScreenHidden ? "hidden" : ""}`.trim()}
          role="status"
          aria-live="polite"
          aria-busy={loading ? "true" : "false"}
          aria-hidden={loadingScreenHidden ? "true" : "false"}
        >
          <div className="loading-content">
            <div className="loading-title">AI Open Image</div>
            <div id="loading-status">{loadingStatusText}</div>
          </div>
          <div className="loading-footer">
            <div className="loading-oss-thanks">Built with open source tools</div>
            <div className="loading-oss-powered">Electron · React · Vite · OpenRouter · Ollama</div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default App;
