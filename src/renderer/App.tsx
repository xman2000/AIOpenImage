import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, JSX, PointerEvent as ReactPointerEvent } from "react";
import appLogo from "./assets/app-logo.png";
import appIcon from "./assets/app-icon.png";
import type {
  AppData,
  GalleryItem,
  GenerationOptions,
  ImageBackend,
  ModelInfo,
  ThemePreference
} from "../shared/types";

type AppInfo = {
  name: string;
  version: string;
  releaseDate: string;
  platform: string;
};

type ReferenceImageSlot = {
  id: string;
  dataUrl: string;
  previewSrc: string;
  name: string;
  locked?: boolean;
};

type RequestStatus = {
  id: string;
  label: string;
  state: "queued" | "running" | "success" | "failed" | "cancelled";
  detail?: string;
};

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
// The splash covers startup on purpose: the work happens behind the show.
// Real work is never delayed to fill it -- instead each stage the boot actually
// completes is held on screen long enough to read, and the splash keeps a floor
// so the animation has room to breathe even when startup is instant.
const SPLASH_MIN_VISIBLE_MS = 2600;
const SPLASH_FADE_MS = 700;
const SPLASH_STAGE_DWELL_MS = 380;
const SPLASH_TOTAL_STAGES = 8;

const maxReferenceImages = 3;
const galleryThumbnailWidths = [120, 160, 210, 280] as const;

const imageSrc = (absolutePath: string): string => {
  // Gallery files all live under userData/output; the main process serves that
  // directory over aoi://, which works from both the dev server and file://.
  const normalized = absolutePath.replaceAll("\\", "/");
  const marker = "/output/";
  const at = normalized.lastIndexOf(marker);
  const relative = at >= 0 ? normalized.slice(at + marker.length) : (normalized.split("/").pop() ?? "");
  const encoded = relative.split("/").map(encodeURIComponent).join("/");
  return `aoi://app/media/${encoded}`;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const safeLimit = Math.max(1, Math.min(limit, items.length));

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: safeLimit }, () => runWorker()));
  return results;
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

const createEditRunId = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  return `run_${Date.now().toString(36)}_${random}`;
};

const createReferenceSlotId = (): string => {
  const random = Math.random().toString(36).slice(2, 8);
  return `ref_${Date.now().toString(36)}_${random}`;
};

const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
};

const deriveStatusHelp = (args: {
  message: string;
  tone: "idle" | "info" | "success" | "error";
  backend: ImageBackend;
  requiresApiKey: boolean;
  hasApiKey: boolean;
}): string[] => {
  if (args.tone !== "error") {
    return [];
  }

  const text = args.message.toLowerCase();
  const help = new Set<string>();

  if (args.requiresApiKey && !args.hasApiKey) {
    help.add("Open Settings and add your OpenRouter API key.");
  }
  if (text.includes("401") || text.includes("unauthorized") || text.includes("api key")) {
    help.add("Verify your API key is valid and active for the selected backend.");
  }
  if (text.includes("402") || text.includes("billing") || text.includes("credits")) {
    help.add("Check account credits or billing status, then retry.");
  }
  if (text.includes("429") || text.includes("rate limit")) {
    help.add("Wait 10-30 seconds before retrying the same request.");
  }
  if (text.includes("timeout") || text.includes("network") || text.includes("enotfound") || text.includes("econnrefused")) {
    help.add("Check internet connectivity, firewall/proxy rules, and backend URL settings.");
  }
  if (args.backend === "ollama" && (text.includes("/v1/images/generations") || text.includes("404"))) {
    help.add("Update Ollama or use a model/build that supports image generation endpoint compatibility.");
  }
  if (text.includes("no models") || text.includes("no image payload") || text.includes("no image returned")) {
    help.add("Try another model and confirm that it supports image output.");
  }

  return Array.from(help);
};

const App = (): JSX.Element => {
  const [loading, setLoading] = useState(true);
  const [loadingStatusText, setLoadingStatusText] = useState("Starting up...");
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [loadingScreenShown, setLoadingScreenShown] = useState(false);
  const [loadingScreenHidden, setLoadingScreenHidden] = useState(false);
  const [appVisible, setAppVisible] = useState(false);
  const [splashStagesShown, setSplashStagesShown] = useState(0);
  // Starts false so the splash cannot dismiss before the narration has run.
  const [splashNarrationIdle, setSplashNarrationIdle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"idle" | "info" | "success" | "error">("idle");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isUserGuideOpen, setIsUserGuideOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<GalleryItem | null>(null);
  const [galleryThumbStop, setGalleryThumbStop] = useState(1);
  const [fullscreenImageSrc, setFullscreenImageSrc] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "AI Open Image",
    version: "",
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
  const [referenceImages, setReferenceImages] = useState<ReferenceImageSlot[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isEditStudioOpen, setIsEditStudioOpen] = useState(false);
  const [editSourceImage, setEditSourceImage] = useState<GalleryItem | null>(null);
  const [editRunId, setEditRunId] = useState<string | undefined>(undefined);
  const [latestEditResultSrc, setLatestEditResultSrc] = useState<string | null>(null);
  const [latestEditResultPath, setLatestEditResultPath] = useState<string | null>(null);
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
  const [requestStatuses, setRequestStatuses] = useState<RequestStatus[]>([]);
  const [isGenPopoverExpanded, setIsGenPopoverExpanded] = useState(false);
  const [toolPanelWidth, setToolPanelWidth] = useState(380);
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskDrawingRef = useRef(false);
  const maskLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const rectStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const rectBaseImageRef = useRef<ImageData | null>(null);
  const compareDraggingRef = useRef(false);
  const workspaceResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const bootStartedAtRef = useRef<number>(0);
  const stopGenerationRequestedRef = useRef(false);
  const splashQueueRef = useRef<string[]>([]);
  const bootDoneRef = useRef(false);

  // Startup finishes in milliseconds, far faster than anyone can read. Every
  // stage the boot really reached is queued, and one is revealed per beat, so
  // the splash narrates what happened rather than flashing past it. Nothing
  // here slows the actual work down -- it only paces the telling of it.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = splashQueueRef.current.shift();
      if (next !== undefined) {
        setLoadingStatusText(next);
        setSplashStagesShown((count) => count + 1);
        return;
      }
      if (bootDoneRef.current) {
        setSplashNarrationIdle(true);
      }
    }, SPLASH_STAGE_DWELL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const clampToolPanelWidth = (width: number): number => {
    const minWidth = 240;
    const maxWidth = Math.max(minWidth, Math.min(620, window.innerWidth - 260));
    return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
  };

  const selectedModels = useMemo(
    () => models.filter((m) => selectedModelIds.includes(m.model_id)),
    [models, selectedModelIds]
  );
  const supportsImageInput = useMemo(
    () => selectedModels.every((m) => m.input_modalities?.includes("image")),
    [selectedModels]
  );
  const referenceImagePayloads = useMemo(() => referenceImages.map((item) => item.dataUrl), [referenceImages]);
  const editSourcePreview = useMemo(
    () => (isEditMode ? referenceImages[0]?.previewSrc : undefined),
    [isEditMode, referenceImages]
  );
  const canAttachMoreReferences = referenceImages.length < maxReferenceImages;
  const requestsPerModel = batchMode && !isEditMode ? Math.max(2, Math.min(10, batchCount)) : 1;
  const totalExpectedCost = useMemo(() => {
    const perImageTotal = selectedModels.reduce((sum, model) => sum + (model.estimatedImageCost ?? 0), 0);
    return perImageTotal * requestsPerModel;
  }, [selectedModels, requestsPerModel]);

  const costBreakdown = useMemo(() => {
    const count = requestsPerModel;
    return selectedModels.map((model) => {
      const unit = model.estimatedImageCost ?? 0;
      return {
        modelId: model.model_id,
        label: model.name,
        unit,
        count,
        subtotal: unit * count
      };
    });
  }, [selectedModels, requestsPerModel]);

  const requiresApiKey = backendInput === "openrouter";
  const galleryThumbWidth = galleryThumbnailWidths[galleryThumbStop] ?? galleryThumbnailWidths[1];
  const requestSummary = useMemo(() => {
    const queued = requestStatuses.filter((item) => item.state === "queued").length;
    const running = requestStatuses.filter((item) => item.state === "running").length;
    const success = requestStatuses.filter((item) => item.state === "success").length;
    const failed = requestStatuses.filter((item) => item.state === "failed").length;
    const cancelled = requestStatuses.filter((item) => item.state === "cancelled").length;
    return { queued, running, success, failed, cancelled, total: requestStatuses.length };
  }, [requestStatuses]);
  const statusHelp = useMemo(
    () =>
      deriveStatusHelp({
        message: status,
        tone: statusTone,
        backend: backendInput,
        requiresApiKey,
        hasApiKey: Boolean(appData.settings.apiKey)
      }),
    [status, statusTone, backendInput, requiresApiKey, appData.settings.apiKey]
  );

  useEffect(() => {
    bootStartedAtRef.current = Date.now();

    const say = (text: string): void => {
      splashQueueRef.current.push(text);
    };

    const boot = async (): Promise<void> => {
      try {
        say("Initializing...");
        say("Loading settings and workspace...");
        const loadedData = await window.appApi.loadAppData();
        say("Applying theme...");
        setAppData(loadedData);
        setApiKeyInput(loadedData.settings.apiKey ?? "");
        setBackendInput(loadedData.settings.imageBackend ?? "openrouter");
        setOllamaBaseUrlInput(loadedData.settings.ollamaBaseUrl ?? "http://localhost:11434");
        setThemeInput(loadedData.settings.themePreference ?? "system");
        applyTheme(loadedData.settings.themePreference ?? "system");
        say("Loading model catalog...");
        const loadedModels = await window.appApi.listModels();
        say("Loading app info...");
        const loadedInfo = await window.appApi.getAppInfo();
        setAppInfo(loadedInfo);
        say("Preparing gallery...");
        setModels(loadedModels);
        if (loadedModels.length > 0) {
          setSelectedModelIds([loadedModels[0].model_id]);
        } else {
          setStatusTone("info");
          setStatus(
            `No models available for ${loadedData.settings.imageBackend}. Check your backend settings and try again.`
          );
        }
        say(`${loadedModels.length} models loaded. ${loadedData.gallery.length} images in gallery.`);
        say("Ready.");
      } catch (error) {
        setStatusTone("error");
        setStatus(`Startup warning: ${String(error)}`);
      } finally {
        bootDoneRef.current = true;
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
    if (!splashNarrationIdle) {
      return;
    }
    const elapsed = Date.now() - bootStartedAtRef.current;
    const startDelay = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);

    const fadeTimer = window.setTimeout(() => {
      setLoadingScreenHidden(true);
      setAppVisible(true);
    }, startDelay);

    const removeTimer = window.setTimeout(() => {
      setShowLoadingScreen(false);
    }, startDelay + SPLASH_FADE_MS);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [loading, splashNarrationIdle]);

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
    const onResize = (): void => {
      setToolPanelWidth((prev) => clampToolPanelWidth(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      if (!workspaceResizeRef.current) {
        return;
      }
      const next = workspaceResizeRef.current.startWidth + (event.clientX - workspaceResizeRef.current.startX);
      setToolPanelWidth(clampToolPanelWidth(next));
    };

    const stopResize = (): void => {
      workspaceResizeRef.current = null;
      setIsResizingWorkspace(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, []);

  const onWorkspaceResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (window.innerWidth <= 980) {
      return;
    }
    workspaceResizeRef.current = { startX: event.clientX, startWidth: toolPanelWidth };
    setIsResizingWorkspace(true);
    event.preventDefault();
  };

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
    setStatusTone(result.ok ? (result.warning ? "info" : "success") : "error");
    setStatus(
      result.ok
        ? result.warning
          ? `ZIP exported: ${result.path}. ${result.warning}`
          : `ZIP exported: ${result.path}`
        : `ZIP export failed: ${result.error}`
    );
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
    const unsubOpenUserGuide = window.appApi.onOpenUserGuide(() => setIsUserGuideOpen(true));
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
      unsubOpenUserGuide();
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
    if (nextModels.length === 0) {
      setStatusTone("error");
      setStatus(
        `Settings saved, but no models were found for ${next.settings.imageBackend}. Verify connectivity and backend configuration.`
      );
    } else {
      setStatusTone("success");
      setStatus(`Settings saved. Backend: ${next.settings.imageBackend}.`);
    }
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

  const onAddReferenceImages = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    const freeSlots = Math.max(0, maxReferenceImages - referenceImages.length);
    if (freeSlots <= 0) {
      setStatusTone("info");
      setStatus(`You can attach up to ${maxReferenceImages} images per request.`);
      return;
    }

    const accepted = files.slice(0, freeSlots);
    if (accepted.length < files.length) {
      setStatusTone("info");
      setStatus(`Only ${maxReferenceImages} total images are allowed. Extra files were ignored.`);
    }

    try {
      const loaded = await Promise.all(
        accepted.map(async (file) => {
          const dataUrl = await fileToDataUrl(file);
          return {
            id: createReferenceSlotId(),
            dataUrl,
            previewSrc: dataUrl,
            name: file.name
          } satisfies ReferenceImageSlot;
        })
      );
      setReferenceImages((prev) => [...prev, ...loaded]);
    } catch (error) {
      setStatusTone("error");
      setStatus(`Failed to load one or more images: ${String(error)}`);
    }
  };

  const onReplaceReferenceImage = async (index: number, event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const target = referenceImages[index];
    if (!target || target.locked) {
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setReferenceImages((prev) =>
        prev.map((item, itemIndex) =>
          itemIndex === index
            ? { ...item, dataUrl, previewSrc: dataUrl, name: file.name }
            : item
        )
      );
    } catch (error) {
      setStatusTone("error");
      setStatus(`Failed to replace image: ${String(error)}`);
    }
  };

  const removeReferenceImage = (index: number): void => {
    setReferenceImages((prev) => {
      const target = prev[index];
      if (!target || target.locked) {
        return prev;
      }
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const clearUserReferenceImages = (): void => {
    setReferenceImages((prev) => prev.filter((item) => item.locked));
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
    // The request tells the model white means change and black means preserve,
    // so the exported buffer has to be exactly that: opaque white where painted,
    // opaque black everywhere else. Anything left translucent is not a stencil.
    for (let index = 0; index < pixels.length; index += 4) {
      const value = pixels[index + 3] > 0 ? 255 : 0;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, maskBrushSize);
    if (maskTool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgb(0, 0, 0)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = showMaskTint ? "rgb(255, 64, 64)" : "rgb(255, 255, 255)";
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
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
      ctx.fillStyle = showMaskTint ? "rgb(255, 64, 64)" : "rgb(255, 255, 255)";
      ctx.strokeStyle = showMaskTint ? "rgb(255, 96, 96)" : "rgb(255, 255, 255)";
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
      return;
    }
    drawMaskStroke(last, point);
    maskLastPointRef.current = point;
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
        ctx.fillStyle = showMaskTint ? "rgb(255, 64, 64)" : "rgb(255, 255, 255)";
        ctx.fillRect(x, y, width, height);
        ctx.restore();
      }
    }
    // Encode once, when the stroke finishes.
    updateMaskData();
    maskDrawingRef.current = false;
    maskLastPointRef.current = null;
    rectStartPointRef.current = null;
    rectBaseImageRef.current = null;
  };

  const onMaskPointerLeave = (): void => {
    const wasDrawing = maskDrawingRef.current;
    if (maskTool === "rect") {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx && rectBaseImageRef.current) {
        ctx.putImageData(rectBaseImageRef.current, 0, 0);
      }
    } else if (wasDrawing) {
      updateMaskData();
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
    const sourceDataUrl = loaded.dataUrl as string;
    setReferenceImages([
      {
        id: `source_${item.id}`,
        dataUrl: sourceDataUrl,
        previewSrc: imageSrc(item.path),
        name: item.filename,
        locked: true
      }
    ]);
    const width = item.metadata?.width ?? 1024;
    const height = item.metadata?.height ?? 1024;
    setEditSourceAspectRatio(Math.max(1, width) / Math.max(1, height));
    setPrompt("");
    setLatestEditResultSrc(null);
    setLatestEditResultPath(null);
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
    setLatestEditResultPath(null);
    setCompareValue(50);
    setIsCompareMode(false);
    setEditSourceAspectRatio(1);
    setIsEditStudioOpen(false);
    maskDrawingRef.current = false;
    maskLastPointRef.current = null;
    setReferenceImages([]);
    clearMask();
    setStatusTone("info");
    setStatus("Exited edit mode.");
  };

  const onUseResultAsSource = async (): Promise<void> => {
    if (!latestEditResultPath) {
      return;
    }

    const resultItem = appData.gallery.find((g) => g.path === latestEditResultPath);
    if (!resultItem) {
      setStatusTone("error");
      setStatus("Could not find result image in gallery. Try refreshing.");
      return;
    }

    setBusy(true);
    setStatusTone("info");
    setStatus("Switching source to edit result...");

    const loaded = await window.appApi.loadImageAsDataUrl(resultItem.path);
    if (!loaded.ok || !loaded.dataUrl) {
      setStatusTone("error");
      setStatus(`Failed to load result image: ${loaded.error ?? "Unknown error"}`);
      setBusy(false);
      return;
    }

    setEditSourceImage(resultItem);
    const sourceDataUrl = loaded.dataUrl as string;
    setReferenceImages((prev) => {
      const userRefs = prev.filter((item) => !item.locked).slice(0, Math.max(0, maxReferenceImages - 1));
      return [
        {
          id: `source_${resultItem.id}`,
          dataUrl: sourceDataUrl,
          previewSrc: imageSrc(resultItem.path),
          name: resultItem.filename,
          locked: true
        },
        ...userRefs
      ];
    });
    const width = resultItem.metadata?.width ?? 1024;
    const height = resultItem.metadata?.height ?? 1024;
    setEditSourceAspectRatio(Math.max(1, width) / Math.max(1, height));
    setPrompt("");
    setLatestEditResultSrc(null);
    setLatestEditResultPath(null);
    setCompareValue(50);
    setIsCompareMode(false);
    clearMask();
    setMaskDataUrl(undefined);
    setMaskPath(undefined);
    setMaskDirty(false);

    setBusy(false);
    setStatusTone("success");
    setStatus(`Now editing: ${resultItem.filename}`);
  };

  const onGenerate = async (): Promise<void> => {
    if (isGenerating) {
      if (!stopGenerationRequestedRef.current) {
        stopGenerationRequestedRef.current = true;
        setStatusTone("info");
        setStatus(`Stopping ${isEditMode ? "edit" : "generation"} after active requests complete...`);
      }
      return;
    }

    if (!prompt.trim() || selectedModelIds.length === 0) {
      return;
    }
    if (isEditMode && !editSourceImage) {
      setStatusTone("error");
      setStatus("Edit mode requires a source image.");
      return;
    }
    if (isEditMode && referenceImagePayloads.length === 0) {
      setStatusTone("error");
      setStatus("Unable to locate source image payload for edit mode.");
      return;
    }

    setBusy(true);
    setIsGenerating(true);
    stopGenerationRequestedRef.current = false;
    setModelWarnings([]);
    setIsGenPopoverExpanded(false);
    setStatusTone("info");
    setStatus(isEditMode ? "Initializing edit run..." : "Initializing generation...");

    try {
      const concurrencyLimit = 3;
      const safeCount = requestsPerModel;
      const totalRequests = selectedModelIds.length * safeCount;
      let completedRequests = 0;
      let currentMaskPath = maskPath;
      const warnings: string[] = [];
      let successCount = 0;
      let failedCount = 0;
      let cancelledCount = 0;

      setStatus(
        `${isEditMode ? "Editing" : "Generating"} ${totalRequests} request(s) with up to ${Math.min(
          concurrencyLimit,
          totalRequests
        )} in parallel...`
      );

      const runId = isEditMode ? (editRunId ?? createEditRunId()) : undefined;
      if (isEditMode && !editRunId && runId) {
        setEditRunId(runId);
      }

      if (isEditMode && maskDataUrl && maskDirty) {
        const savedMask = await window.appApi.saveMask(maskDataUrl, runId ?? createEditRunId());
        if (savedMask.ok && savedMask.path) {
          currentMaskPath = savedMask.path;
          setMaskPath(savedMask.path);
          setMaskDirty(false);
        } else {
          warnings.push(savedMask.error ?? "Mask could not be persisted. Continuing without saved mask path.");
        }
      }

      const tasks = selectedModelIds.flatMap((modelId) => {
        const model = models.find((m) => m.model_id === modelId);
        const modelName = model?.name ?? modelId;
        return Array.from({ length: safeCount }, (_, index) => {
          const requestNumber = index + 1;
          return {
            id: `${modelId}:${requestNumber}`,
            modelId,
            modelName,
            requestNumber,
            label: batchMode ? `${modelName} #${requestNumber}` : modelName
          };
        });
      });

      const producedPaths: (string | null)[] = new Array(tasks.length).fill(null);

      setRequestStatuses(tasks.map((task) => ({ id: task.id, label: task.label, state: "queued" as const })));

      await runWithConcurrency(tasks, concurrencyLimit, async (task, taskIndex) => {
        if (stopGenerationRequestedRef.current) {
          cancelledCount += 1;
          completedRequests += 1;
          setRequestStatuses((prev) =>
            prev.map((item) => (item.id === task.id ? { ...item, state: "cancelled", detail: "Stopped" } : item))
          );
          setStatus(`${isEditMode ? "Editing" : "Generating"}... ${completedRequests}/${totalRequests} complete`);
          return;
        }

        if (taskIndex > 0) {
          await new Promise((resolve) => setTimeout(resolve, taskIndex * 500));
        }

        if (stopGenerationRequestedRef.current) {
          cancelledCount += 1;
          completedRequests += 1;
          setRequestStatuses((prev) =>
            prev.map((item) => (item.id === task.id ? { ...item, state: "cancelled", detail: "Stopped" } : item))
          );
          setStatus(`${isEditMode ? "Editing" : "Generating"}... ${completedRequests}/${totalRequests} complete`);
          return;
        }

        setRequestStatuses((prev) => prev.map((item) => (item.id === task.id ? { ...item, state: "running" } : item)));

        const model = models.find((m) => m.model_id === task.modelId);
        const canImageInput = Boolean(model?.input_modalities?.includes("image"));
        const canMaskEdit = Boolean(model?.supportsMaskEdit);
        const wantsMaskEdit = isEditMode && Boolean(maskDataUrl);
        const modelMaskEnabled = wantsMaskEdit && canMaskEdit;

        if (isEditMode && !canImageInput) {
          warnings.push(`${task.modelName}: model does not support image input, skipped.`);
          failedCount += 1;
          completedRequests += 1;
          setRequestStatuses((prev) =>
            prev.map((item) => (item.id === task.id ? { ...item, state: "failed", detail: "Image input unsupported" } : item))
          );
          setStatus(`${isEditMode ? "Editing" : "Generating"}... ${completedRequests}/${totalRequests} complete`);
          return;
        }

        if (wantsMaskEdit && !canMaskEdit) {
          warnings.push(`${task.modelName}: mask edits unsupported, using full-image edit fallback.`);
        }

        const options: GenerationOptions = {
          model: task.modelId,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          aspectRatio,
          imageSize: task.modelId.toLowerCase().includes("gemini") ? imageSize : undefined,
          seed: useSeed ? seedValue + (task.requestNumber - 1) : undefined,
          referenceImage: referenceImagePayloads[0],
          referenceImages: referenceImagePayloads.length ? referenceImagePayloads : undefined,
          maskImage: modelMaskEnabled ? maskDataUrl : undefined,
          maskPath: modelMaskEnabled ? currentMaskPath : undefined,
          editMode: isEditMode ? (modelMaskEnabled ? "mask-edit" : "edit") : "generate",
          parentImageId: isEditMode ? editSourceImage?.id : undefined,
          editRunId: isEditMode ? runId : undefined,
          editInstruction: isEditMode ? prompt.trim() : undefined,
          sourceImagePath: isEditMode ? editSourceImage?.path : undefined,
          batchMode,
          batchIndex: batchMode ? task.requestNumber : undefined
        };

        const result = await window.appApi.generateImage(options);
        completedRequests += 1;

        if (result.ok && result.image) {
          const generatedImage = result.image;
          successCount += 1;
          producedPaths[taskIndex] = generatedImage.path;
          setRequestStatuses((prev) =>
            prev.map((item) => (item.id === task.id ? { ...item, state: "success", detail: "Completed" } : item))
          );
          setAppData((prev) => ({
            ...prev,
            gallery: [...prev.gallery, generatedImage],
            totalCost: prev.totalCost + (result.cost ?? 0)
          }));
        } else {
          failedCount += 1;
          setRequestStatuses((prev) =>
            prev.map((item) => (item.id === task.id ? { ...item, state: "failed", detail: result.error ?? "Failed" } : item))
          );
        }

        setStatus(`${isEditMode ? "Editing" : "Generating"}... ${completedRequests}/${totalRequests} complete`);
      });

      setModelWarnings(warnings);
      // Deterministic: the first result in task order, not whichever worker
      // happened to finish last.
      const firstProducedPath = producedPaths.find((item): item is string => Boolean(item)) ?? null;
      if (isEditMode && firstProducedPath) {
        setLatestEditResultSrc(imageSrc(firstProducedPath));
        setLatestEditResultPath(firstProducedPath);
        setIsCompareMode(true);
      }

      if (failedCount > 0) {
        if (stopGenerationRequestedRef.current) {
          setStatusTone("info");
          setStatus(
            `${isEditMode ? "Edit run" : "Generation"} stopped: ${successCount} succeeded, ${failedCount} failed, ${cancelledCount} cancelled.${
              warnings.length ? ` ${warnings.length} warning(s).` : ""
            }`
          );
        } else {
          setStatusTone("error");
          setStatus(
            `${isEditMode ? "Edit run" : "Generation"} completed: ${successCount} succeeded, ${failedCount} failed.${
              warnings.length ? ` ${warnings.length} warning(s).` : ""
            }`
          );
        }
      } else if (stopGenerationRequestedRef.current) {
        setStatusTone("info");
        setStatus(
          `${isEditMode ? "Edit run" : "Generation"} stopped: ${successCount} completed, ${cancelledCount} cancelled.${
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
      stopGenerationRequestedRef.current = false;
      setIsGenerating(false);
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

    clearUserReferenceImages();

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
        { label: "User Guide", accelerator: "F1", action: () => setIsUserGuideOpen(true) },
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
        <div className="desktop-brand">
          <img src={appIcon} alt="AI Open Image" className="desktop-brand-logo" />
          <div>
            <h1>AI Open Image</h1>
            <p className="muted">Desktop studio for generation, iteration, and gallery export.</p>
          </div>
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

      <section
        className={`workspace${isResizingWorkspace ? " workspace-resizing" : ""}`}
        style={{ ["--tool-panel-width" as string]: `${toolPanelWidth}px` }}
      >
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
            <small className="muted">When references are attached, call them out as image 1, image 2, and image 3.</small>
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

            <div className={`generate-wrap${isGenerating ? " generate-wrap-stop" : ""}${(!isGenerating && (busy || !prompt.trim() || (requiresApiKey && !appData.settings.apiKey) || selectedModelIds.length === 0 || (isEditMode && referenceImagePayloads.length === 0))) ? " generate-wrap-disabled" : ""}`}>
              <button
                type="button"
                className={`generate${isGenerating ? " generate-stop" : ""}`}
                disabled={
                  isGenerating
                    ? false
                    : busy ||
                      !prompt.trim() ||
                      (requiresApiKey && !appData.settings.apiKey) ||
                      selectedModelIds.length === 0 ||
                      (isEditMode && referenceImagePayloads.length === 0)
                }
                onClick={onGenerate}
              >
                {isGenerating ? "Stop!" : "Let's Go!"}
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
                  title={`${model.name}\n${model.model_id}\n\n${model.description}\nBest for: ${model.best_for.join(", ")}\nCost: ${model.cost_estimate}`}
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
              <select value={batchCount} onChange={(e) => setBatchCount(Number.parseInt(e.target.value, 10) || 2)}>
                {Array.from({ length: 9 }, (_, index) => index + 2).map((countOption) => (
                  <option key={countOption} value={countOption}>{countOption}</option>
                ))}
              </select>
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

              <label>{isEditMode ? "Edit References" : "Image-to-Image References"}</label>
              <small className="muted">
                {isEditMode
                  ? "In Edit Mode, the source image is image 1. Add up to 2 more references (max 3 total)."
                  : "Upload up to 3 references and refer to them as image 1, image 2, and image 3 in your prompt."}
              </small>
              <div className="reference-toolbar">
                <label className={`ghost reference-add-btn${!canAttachMoreReferences ? " is-disabled" : ""}`}>
                  Add Image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    disabled={!canAttachMoreReferences}
                    onChange={(event) => {
                      void onAddReferenceImages(event);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="ghost"
                  disabled={referenceImages.every((item) => item.locked)}
                  onClick={clearUserReferenceImages}
                >
                  Clear User Images
                </button>
                <small className="muted">{referenceImages.length}/{maxReferenceImages}</small>
              </div>
              {!supportsImageInput ? <small className="warn">One or more selected models may not support image input.</small> : null}
              {referenceImages.length ? (
                <div className="reference-grid">
                  {referenceImages.map((item, index) => (
                    <article key={item.id} className="reference-card">
                      <img className="reference-thumb" src={item.previewSrc} alt={`Reference image ${index + 1}`} />
                      <div className="reference-meta">
                        <strong>{`image ${index + 1}`}</strong>
                        <small title={item.name}>{item.name}</small>
                      </div>
                      <div className="reference-actions">
                        <label className={`ghost reference-replace-btn${item.locked ? " is-disabled" : ""}`}>
                          Replace
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={item.locked}
                            onChange={(event) => {
                              void onReplaceReferenceImage(index, event);
                            }}
                          />
                        </label>
                        <button type="button" className="ghost" disabled={item.locked} onClick={() => removeReferenceImage(index)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {isEditMode ? (
                <>
                  <small className="muted">Mask drawing and compare controls live in Edit Studio.</small>
                  <button type="button" className="ghost" onClick={() => setIsEditStudioOpen(true)}>Open Edit Studio</button>
                </>
              ) : null}
            </div>
          </details>

          <p className={`status ${statusTone}`}>{status}</p>
          {statusHelp.length ? (
            <div className="status-help" role="note" aria-label="How to fix this">
              {statusHelp.map((item) => (
                <small key={item}>{item}</small>
              ))}
            </div>
          ) : null}
          {modelWarnings.length ? (
            <div className="warning-list">
              {modelWarnings.map((warning, index) => (
                <small key={`${warning}-${index}`} className="warn">{warning}</small>
              ))}
            </div>
          ) : null}
        </aside>

        <div
          className="workspace-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tool and gallery panels"
          onPointerDown={onWorkspaceResizeStart}
        />

        <section className="content-panel">
          <div className="toolbar">
            <div>
              <h2>Gallery</h2>
              <p className="muted">Estimated Total Cost: ${appData.totalCost.toFixed(6)}</p>
            </div>
            <div className="toolbar-actions">
              <label className="thumb-size-control" title="Gallery thumbnail size">
                <span>Thumbnail Size</span>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={galleryThumbStop}
                  onChange={(e) => setGalleryThumbStop(Number.parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <button type="button" className="ghost" onClick={onClearGallery} disabled={appData.gallery.length === 0}>Clear Gallery</button>
              <button type="button" onClick={onExportZip} disabled={appData.gallery.length === 0}>Export ZIP</button>
            </div>
          </div>

          <div className="gallery-grid" style={{ ["--thumb-size" as string]: `${galleryThumbWidth}px` }}>
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
                    <strong className="card-title">{item.modelName}</strong>
                    <div className="card-meta">
                      <small>{new Date(item.timestamp).toLocaleString()}</small>
                      <small>{item.metadata?.dimensions ?? ""}</small>
                    </div>
                    <div className="tag-row">
                      {item.editMode && item.editMode !== "generate" ? (
                        <small className="tag">{item.editMode === "mask-edit" ? "Mask Edit" : "Edited"}</small>
                      ) : null}
                      {item.img2imgMode ? <small className="tag">Img2Img</small> : null}
                    </div>
                    <div className="card-actions">
                      <button type="button" className="ghost" onClick={() => void onStartEdit(item)}>Edit</button>
                      <button type="button" onClick={() => onSaveImageAs(item)}>Save</button>
                    </div>
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

      {isUserGuideOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="User Guide" onClick={() => setIsUserGuideOpen(false)}>
          <div className="modal docs-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3>User Guide</h3>
              <button type="button" className="ghost" onClick={() => setIsUserGuideOpen(false)}>Close</button>
            </header>
            <div className="modal-body docs-body">
              <section>
                <h4>Quick Start</h4>
                <ol>
                  <li>Open <strong>Settings</strong> and choose your backend (OpenRouter or Ollama).</li>
                  <li>For OpenRouter, add your API key and save.</li>
                  <li>Optional: attach up to 3 references and refer to them in prompt as <strong>image 1</strong>, <strong>image 2</strong>, and <strong>image 3</strong>.</li>
                  <li>Select one or more models, write a prompt, and click <strong>Let&apos;s Go!</strong>.</li>
                  <li>Click any gallery image to view details, or use the card buttons to edit, reuse settings, or save.</li>
                </ol>
              </section>

              <section>
                <h4>Edit Studio</h4>
                <ul>
                  <li>Click <strong>Edit</strong> on any gallery image to open Edit Studio.</li>
                  <li>In Edit Mode, the source is always <strong>image 1</strong>; you can add up to 2 extra references (3 total).</li>
                  <li>Draw a mask with Brush (<code>B</code>), Eraser (<code>E</code>), or Rectangle (<code>R</code>). Adjust size with the slider.</li>
                  <li>Write an edit instruction and click <strong>Edit</strong> to generate.</li>
                  <li>Use <strong>Compare</strong> to drag-compare the original and result side by side.</li>
                  <li>Click <strong>Use Result as New Source</strong> to continue editing the output.</li>
                </ul>
              </section>

              <section>
                <h4>Keyboard Shortcuts</h4>
                <ul>
                  <li><code>Ctrl+,</code> &mdash; Settings</li>
                  <li><code>F1</code> &mdash; This help guide</li>
                  <li><code>B</code> / <code>E</code> / <code>R</code> &mdash; Brush / Eraser / Rectangle (in Edit Studio)</li>
                </ul>
              </section>

              <section>
                <h4>Troubleshooting</h4>
                <ul>
                  <li>Auth errors &mdash; re-check your API key or backend URL in Settings.</li>
                  <li>No models on Ollama &mdash; verify the base URL and that models are installed.</li>
                  <li>Empty results &mdash; try a different model or a simpler prompt.</li>
                </ul>
              </section>

              <section>
                <h4>Full Documentation</h4>
                <p>The complete guide is available in <code>docs/USER_GUIDE.md</code> and on GitHub.</p>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void window.appApi.menuOpenExternal("https://github.com/aporb/openrouter-image-gen/blob/main/docs/USER_GUIDE.md")}
                >
                  Open Full User Guide
                </button>
              </section>
            </div>
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

                {isCompareMode && latestEditResultSrc && editSourcePreview ? (
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
                        <img src={editSourcePreview} alt="Original" className="compare-layer-image" draggable={false} />
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
                    {editSourcePreview ? (
                      <img
                        className="edit-studio-image"
                        src={editSourcePreview}
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
                <small className="muted">Edits: 1 per selected model</small>
                {modelWarnings.length ? (
                  <div className="warning-list">
                    {modelWarnings.map((warning, index) => (
                      <small key={`studio-${warning}-${index}`} className="warn">{warning}</small>
                    ))}
                  </div>
                ) : null}

                <div className={`generate-wrap${busy || !prompt.trim() || selectedModelIds.length === 0 || referenceImagePayloads.length === 0 ? " generate-wrap-disabled" : ""}`}>
                  <button
                    type="button"
                    className="generate"
                    disabled={busy || !prompt.trim() || selectedModelIds.length === 0 || referenceImagePayloads.length === 0}
                    onClick={onGenerate}
                  >
                    {busy ? "Editing..." : "Edit"}
                  </button>
                </div>

                {latestEditResultPath ? (
                  <button
                    type="button"
                    className="ghost use-as-source"
                    disabled={busy}
                    onClick={() => void onUseResultAsSource()}
                  >
                    Use Result as New Source
                  </button>
                ) : null}
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
          <small className="gen-popover-status">
            Queued {requestSummary.queued} · Running {requestSummary.running} · Done {requestSummary.success + requestSummary.failed + requestSummary.cancelled}/{requestSummary.total}
          </small>
          <button
            type="button"
            className="ghost gen-popover-toggle"
            onClick={() => setIsGenPopoverExpanded((prev) => !prev)}
          >
            {isGenPopoverExpanded ? "Hide Requests" : "Show Requests"}
          </button>
          {isGenPopoverExpanded ? (
            <div className="gen-popover-list" role="list" aria-label="Request statuses">
              {requestStatuses.map((item) => (
                <div key={item.id} role="listitem" className={`gen-popover-item gen-popover-item-${item.state}`}>
                  <span>{item.label}</span>
                  <small>{item.state}{item.detail ? ` - ${item.detail}` : ""}</small>
                </div>
              ))}
            </div>
          ) : null}
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
            <img src={appLogo} alt="AI Open Image logo" className="loading-logo" />
            <div className="loading-title">AI Open Image</div>
            <div id="loading-status">{loadingStatusText}</div>
            <div
              className="loading-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={SPLASH_TOTAL_STAGES}
              aria-valuenow={Math.min(splashStagesShown, SPLASH_TOTAL_STAGES)}
              style={{ ["--splash-progress" as string]: `${Math.min(1, splashStagesShown / SPLASH_TOTAL_STAGES)}` }}
            >
              <div className="loading-progress-bar" />
            </div>
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
