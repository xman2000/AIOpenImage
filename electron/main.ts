import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import JSZip from "jszip";
import { loadModels } from "../src/main/services/knowledge";
import { generateImageBatchWithOllama, generateImageWithOllama, listOllamaModels } from "../src/main/services/providers/ollama";
import { generateImage, generateImageBatch } from "../src/main/services/providers/openrouter";
import {
  clearGallery,
  getAppData,
  getSettings,
  saveGeneratedImage,
  saveSettings,
  saveThemePreference
} from "../src/main/services/storage";
import type { GenerationOptions, ThemePreference } from "../src/shared/types";

let mainWindow: BrowserWindow | null = null;
const DEV_SERVER_URL = "http://localhost:5173";
const SHOULD_OPEN_DEVTOOLS = process.env.AI_OPEN_IMAGE_OPEN_DEVTOOLS === "1";

const imageMimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const availableThemes: ThemePreference[] = [
  "system",
  "light",
  "dark",
  "terminal",
  "amber-terminal",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "indigo",
  "white"
];

const themeLabels: Record<ThemePreference, string> = {
  system: "System",
  light: "Day",
  dark: "Night",
  terminal: "Terminal",
  "amber-terminal": "Amber Terminal",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  indigo: "Indigo",
  white: "White"
};

const sendToRenderer = (channel: string, ...args: unknown[]): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
};

const outputDir = (): string => path.join(app.getPath("userData"), "output");

const isPathInside = (targetPath: string, rootPath: string): boolean => {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(rootPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  if (!relative || relative === ".") {
    return true;
  }
  const escaped = relative.startsWith("..") || path.isAbsolute(relative);
  return escaped ? false : true;
};

const themeColors: Record<ThemePreference, { bg: string; ink: string }> = {
  system: nativeTheme.shouldUseDarkColors
    ? { bg: "#0b0b0d", ink: "#e4e7ee" }
    : { bg: "#e8eaef", ink: "#1a1e26" },
  light: { bg: "#e8eaef", ink: "#1a1e26" },
  dark: { bg: "#0b0b0d", ink: "#e4e7ee" },
  terminal: { bg: "#020503", ink: "#c8ffd8" },
  "amber-terminal": { bg: "#070502", ink: "#ffe4b0" },
  red: { bg: "#120708", ink: "#ffe0e0" },
  orange: { bg: "#140d05", ink: "#ffe8c8" },
  yellow: { bg: "#141105", ink: "#fff8d0" },
  green: { bg: "#030804", ink: "#c8ffd8" },
  blue: { bg: "#050b14", ink: "#d8eeff" },
  indigo: { bg: "#0a0818", ink: "#e8e2ff" },
  white: { bg: "#111214", ink: "#ffffff" }
};

const resolveThemeColors = (preference: ThemePreference): { bg: string; ink: string } => {
  if (preference === "system") {
    return nativeTheme.shouldUseDarkColors
      ? themeColors.dark
      : themeColors.light;
  }
  return themeColors[preference] ?? themeColors.dark;
};

const windowBackgroundColorFor = (preference: ThemePreference): string => {
  return resolveThemeColors(preference).bg;
};

const applyWindowBackground = (preference: ThemePreference): void => {
  const colors = resolveThemeColors(preference);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.setBackgroundColor(colors.bg);
      win.setTitleBarOverlay({
        color: colors.bg,
        symbolColor: colors.ink,
        height: 36
      });
    }
  }
};

const applyNativeWindowTheme = (preference: ThemePreference): void => {
  if (preference === "system") {
    nativeTheme.themeSource = "system";
  } else if (["dark", "terminal", "amber-terminal", "red", "orange", "yellow", "green", "blue", "indigo", "white"].includes(preference)) {
    nativeTheme.themeSource = "dark";
  } else {
    nativeTheme.themeSource = "light";
  }
  applyWindowBackground(preference);
};

const buildMenu = async (): Promise<void> => {
  const settings = await getSettings(app.getPath("userData"));
  const themeSubmenu: MenuItemConstructorOptions[] = availableThemes.map((theme) => ({
    label: themeLabels[theme],
    type: "radio",
    checked: settings.themePreference === theme,
    click: async () => {
      await saveThemePreference(app.getPath("userData"), theme);
      applyNativeWindowTheme(theme);
      sendToRenderer("ui:theme-changed", theme);
      await buildMenu();
    }
  }));

  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Export Gallery ZIP",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => sendToRenderer("ui:export-zip")
        },
        {
          label: "Clear Gallery",
          accelerator: "CmdOrCtrl+Shift+Backspace",
          click: async () => {
            const result = await dialog.showMessageBox({
              type: "warning",
              title: "Clear Gallery",
              message: "Clear all gallery entries?",
              detail: "This removes items from gallery index but does not delete image files from disk.",
              buttons: ["Cancel", "Clear Gallery"],
              defaultId: 0,
              cancelId: 0
            });
            if (result.response === 1) {
              sendToRenderer("ui:clear-gallery");
            }
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Settings",
      submenu: [
        {
          label: "Open Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => sendToRenderer("ui:open-settings")
        },
        {
          label: "Theme",
          submenu: themeSubmenu
        }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "User Guide",
          accelerator: "F1",
          click: () => {
            sendToRenderer("ui:open-user-guide");
          }
        },
        { type: "separator" },
        {
          label: "OpenRouter Keys",
          click: async () => {
            await shell.openExternal("https://openrouter.ai/keys");
          }
        },
        {
          label: "About",
          click: () => {
            sendToRenderer("ui:open-about");
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const createWindow = async (themePreference: ThemePreference): Promise<void> => {
  const colors = resolveThemeColors(themePreference);
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: colors.bg,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: colors.bg,
      symbolColor: colors.ink,
      height: 36
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  if (!app.isPackaged) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      let devServerReachable = false;
      try {
        const probe = await fetch(DEV_SERVER_URL, { signal: controller.signal });
        devServerReachable = probe.ok;
      } catch {
        devServerReachable = false;
      } finally {
        clearTimeout(timeout);
      }

      if (devServerReachable) {
        await mainWindow.loadURL(DEV_SERVER_URL);
      } else {
        await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
      }
      if (SHOULD_OPEN_DEVTOOLS) {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      }
      return;
    } catch {
      await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
      return;
    }
  }

  await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
};

app.whenReady().then(async () => {
  const initialSettings = await getSettings(app.getPath("userData"));
  applyNativeWindowTheme(initialSettings.themePreference);
  await buildMenu();
  await createWindow(initialSettings.themePreference);
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const settings = await getSettings(app.getPath("userData"));
      await createWindow(settings.themePreference);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("browser-window-created", async () => {
  await buildMenu();
});

ipcMain.handle("app:loadData", async () => getAppData(app.getPath("userData")));
ipcMain.handle("app:getInfo", async () => {
  const packagePath = path.join(app.getAppPath(), "package.json");
  let releaseDate = "Local Build";
  try {
    const stat = await fs.stat(packagePath);
    releaseDate = stat.mtime.toISOString().slice(0, 10);
  } catch {
    releaseDate = "Local Build";
  }
  return {
    name: app.getName(),
    version: app.getVersion(),
    releaseDate,
    platform: process.platform
  };
});
ipcMain.handle("settings:get", async () => getSettings(app.getPath("userData")));
ipcMain.handle("settings:save", async (_event, settings: Record<string, unknown>) => {
  const nextSettings = await saveSettings(app.getPath("userData"), {
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey : undefined,
    themePreference: settings.themePreference as ThemePreference | undefined,
    imageBackend: settings.imageBackend as "openrouter" | "ollama" | undefined,
    ollamaBaseUrl: typeof settings.ollamaBaseUrl === "string" ? settings.ollamaBaseUrl : undefined
  });
  applyNativeWindowTheme(nextSettings.themePreference);
  await buildMenu();
  return getAppData(app.getPath("userData"));
});

ipcMain.handle("gallery:clear", async () => {
  await clearGallery(app.getPath("userData"));
  return getAppData(app.getPath("userData"));
});

ipcMain.handle("settings:setThemePreference", async (_event, themePreference: ThemePreference) => {
  await saveThemePreference(app.getPath("userData"), themePreference);
  applyNativeWindowTheme(themePreference);
  await buildMenu();
  sendToRenderer("ui:theme-changed", themePreference);
  return getAppData(app.getPath("userData"));
});

ipcMain.handle("knowledge:listModels", async () => {
  try {
    const settings = await getSettings(app.getPath("userData"));
    if (settings.imageBackend === "ollama") {
      return listOllamaModels(settings.ollamaBaseUrl);
    }
    return loadModels(app.getAppPath());
  } catch {
    return [];
  }
});

ipcMain.handle("image:generate", async (_event, options: GenerationOptions) => {
  const settings = (await getAppData(app.getPath("userData"))).settings;
  let generated;
  if (settings.imageBackend === "ollama") {
    generated = await generateImageWithOllama(options, app.getPath("userData"), settings.ollamaBaseUrl);
  } else {
    const apiKey = options.model ? settings.apiKey : "";
    if (!apiKey) {
      return { ok: false, error: "No API Key found. Set it in the app first." };
    }
    generated = await generateImage({ ...options, apiKey }, app.getPath("userData"), app.getAppPath());
  }
  if (!generated.ok || !generated.image) {
    return generated;
  }
  await saveGeneratedImage(app.getPath("userData"), generated.image, options.prompt, generated.cost);
  return generated;
});

ipcMain.handle("image:generateBatch", async (_event, options: GenerationOptions, count: number) => {
  const settings = (await getAppData(app.getPath("userData"))).settings;
  let results;
  if (settings.imageBackend === "ollama") {
    results = await generateImageBatchWithOllama(options, count, app.getPath("userData"), settings.ollamaBaseUrl);
  } else {
    const apiKey = settings.apiKey;
    if (!apiKey) {
      return [{ ok: false, error: "No API Key found. Set it in the app first." }];
    }
    results = await generateImageBatch({ ...options, apiKey }, count, app.getPath("userData"), app.getAppPath());
  }
  for (const result of results) {
    if (result.ok && result.image) {
      await saveGeneratedImage(app.getPath("userData"), result.image, options.prompt, result.cost);
    }
  }
  return results;
});

ipcMain.handle("gallery:saveAs", async (_event, imagePath: string) => {
  const allowedDir = outputDir();
  if (!isPathInside(imagePath, allowedDir)) {
    return { ok: false, error: "Invalid image path." };
  }
  const defaultName = path.basename(imagePath);
  const saveResult = await dialog.showSaveDialog({ defaultPath: defaultName });
  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, error: "Save cancelled" };
  }
  await fs.copyFile(imagePath, saveResult.filePath);
  return { ok: true, path: saveResult.filePath };
});

ipcMain.handle("gallery:loadAsDataUrl", async (_event, imagePath: string) => {
  try {
    const allowedDir = outputDir();
    if (!isPathInside(imagePath, allowedDir)) {
      return { ok: false, error: "Invalid source image path." };
    }
    const extension = path.extname(imagePath).toLowerCase();
    const mime = imageMimeByExtension[extension] ?? "image/png";
    const buffer = await fs.readFile(imagePath);
    return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
  } catch (error) {
    return { ok: false, error: `Failed to load image: ${String(error)}` };
  }
});

ipcMain.handle("gallery:saveMask", async (_event, maskDataUrl: string, editRunId: string) => {
  try {
    if (!maskDataUrl.startsWith("data:image/")) {
      return { ok: false, error: "Mask must be a data URL image payload." };
    }
    const [, payload] = maskDataUrl.split(",", 2);
    if (!payload) {
      return { ok: false, error: "Invalid mask payload." };
    }
    const masksDir = path.join(outputDir(), "masks");
    await fs.mkdir(masksDir, { recursive: true });
    const safeRunId = (editRunId || "run").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "run";
    const filename = `mask_${new Date().toISOString().replace(/[:.]/g, "-")}_${safeRunId}.png`;
    const maskPath = path.join(masksDir, filename);
    await fs.writeFile(maskPath, Buffer.from(payload, "base64"));
    return { ok: true, path: maskPath };
  } catch (error) {
    return { ok: false, error: `Failed to save mask: ${String(error)}` };
  }
});

ipcMain.handle("gallery:exportZip", async () => {
  try {
    const data = await getAppData(app.getPath("userData"));
    if (!data.gallery.length) {
      return { ok: false, error: "Gallery is empty" };
    }

    const zip = new JSZip();
    let addedCount = 0;
    const missingFiles: string[] = [];
    for (const item of data.gallery) {
      try {
        const buffer = await fs.readFile(item.path);
        zip.file(item.filename, buffer);
        addedCount += 1;
      } catch {
        missingFiles.push(item.filename);
      }
    }

    if (addedCount === 0) {
      return { ok: false, error: "No readable images found for export." };
    }

    const metadata = data.gallery
      .map((item) => {
        const lines = [
          `File: ${item.filename}`,
          `Model: ${item.modelName}`,
          `Timestamp: ${item.timestamp}`,
          `Cost: $${(item.cost ?? 0).toFixed(6)}`,
          `Prompt: ${item.prompt}`,
          ""
        ];
        return lines.join("\n");
      })
      .join("\n");

    const metadataWithWarnings =
      missingFiles.length > 0
        ? `${metadata}\nSkipped missing files (${missingFiles.length}):\n${missingFiles.join("\n")}\n`
        : metadata;

    zip.file("metadata.txt", metadataWithWarnings);
    const blob = await zip.generateAsync({ type: "nodebuffer" });

    const saveResult = await dialog.showSaveDialog({
      defaultPath: "generated_images.zip",
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, error: "Export cancelled" };
    }

    await fs.writeFile(saveResult.filePath, blob);
    return {
      ok: true,
      path: saveResult.filePath,
      warning: missingFiles.length > 0 ? `${missingFiles.length} file(s) were missing and skipped.` : undefined
    };
  } catch (error) {
    return { ok: false, error: `ZIP export failed: ${String(error)}` };
  }
});

ipcMain.handle("menu:reload", () => {
  mainWindow?.webContents.reload();
});

ipcMain.handle("menu:forceReload", () => {
  mainWindow?.webContents.reloadIgnoringCache();
});

ipcMain.handle("menu:toggleDevTools", () => {
  mainWindow?.webContents.toggleDevTools();
});

ipcMain.handle("menu:resetZoom", () => {
  if (mainWindow) {
    mainWindow.webContents.zoomLevel = 0;
  }
});

ipcMain.handle("menu:zoomIn", () => {
  if (mainWindow) {
    mainWindow.webContents.zoomLevel += 0.5;
  }
});

ipcMain.handle("menu:zoomOut", () => {
  if (mainWindow) {
    mainWindow.webContents.zoomLevel -= 0.5;
  }
});

ipcMain.handle("menu:toggleFullscreen", () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle("menu:openExternal", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("menu:quit", () => {
  app.quit();
});

ipcMain.handle("menu:undo", () => {
  mainWindow?.webContents.undo();
});

ipcMain.handle("menu:redo", () => {
  mainWindow?.webContents.redo();
});

ipcMain.handle("menu:cut", () => {
  mainWindow?.webContents.cut();
});

ipcMain.handle("menu:copy", () => {
  mainWindow?.webContents.copy();
});

ipcMain.handle("menu:paste", () => {
  mainWindow?.webContents.paste();
});

ipcMain.handle("menu:selectAll", () => {
  mainWindow?.webContents.selectAll();
});
