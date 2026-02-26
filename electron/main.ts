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
  saveApiKey,
  saveGeneratedImage,
  saveSettings,
  saveThemePreference
} from "../src/main/services/storage";
import type { GenerationOptions, ThemePreference } from "../src/shared/types";

let mainWindow: BrowserWindow | null = null;

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

const windowBackgroundColorFor = (preference: ThemePreference): string => {
  if (["dark", "terminal", "amber-terminal", "red", "orange", "yellow", "green", "blue", "indigo", "white"].includes(preference)) {
    return "#111113";
  }
  if (preference === "system") {
    return nativeTheme.shouldUseDarkColors ? "#111113" : "#ffffff";
  }
  return "#ffffff";
};

const applyWindowBackground = (preference: ThemePreference): void => {
  const color = windowBackgroundColorFor(preference);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.setBackgroundColor(color);
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
          label: "OpenRouter Keys",
          click: async () => {
            await shell.openExternal("https://openrouter.ai/keys");
          }
        },
        {
          label: "About",
          click: async () => {
            await dialog.showMessageBox({
              type: "info",
              title: "About",
              message: "AI Open Image",
              detail: "Desktop image generation tool with OpenRouter and Ollama backends."
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const createWindow = async (themePreference: ThemePreference): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: false,
    backgroundColor: windowBackgroundColorFor(themePreference),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  mainWindow.setMenuBarVisibility(true);

  if (!app.isPackaged) {
    try {
      await mainWindow.loadURL("http://127.0.0.1:5173");
      mainWindow.webContents.openDevTools({ mode: "detach" });
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

ipcMain.handle("settings:setApiKey", async (_event, apiKey: string) => {
  await saveApiKey(app.getPath("userData"), apiKey);
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
  const defaultName = path.basename(imagePath);
  const saveResult = await dialog.showSaveDialog({ defaultPath: defaultName });
  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, error: "Save cancelled" };
  }
  await fs.copyFile(imagePath, saveResult.filePath);
  return { ok: true, path: saveResult.filePath };
});

ipcMain.handle("gallery:exportZip", async () => {
  const data = await getAppData(app.getPath("userData"));
  if (!data.gallery.length) {
    return { ok: false, error: "Gallery is empty" };
  }

  const zip = new JSZip();
  for (const item of data.gallery) {
    const buffer = await fs.readFile(item.path);
    zip.file(item.filename, buffer);
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

  zip.file("metadata.txt", metadata);
  const blob = await zip.generateAsync({ type: "nodebuffer" });

  const saveResult = await dialog.showSaveDialog({
    defaultPath: "generated_images.zip",
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, error: "Export cancelled" };
  }

  await fs.writeFile(saveResult.filePath, blob);
  return { ok: true, path: saveResult.filePath };
});
