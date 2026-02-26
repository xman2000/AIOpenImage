import { contextBridge, ipcRenderer } from "electron";
import type {
  AppData,
  AppSettings,
  GenerationOptions,
  GenerationResult,
  ModelInfo,
  ThemePreference
} from "../src/shared/types";

type Unsubscribe = () => void;

const api = {
  loadAppData: (): Promise<AppData> => ipcRenderer.invoke("app:loadData"),
  getAppInfo: (): Promise<{ name: string; version: string; releaseDate: string; platform: string }> =>
    ipcRenderer.invoke("app:getInfo"),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<AppSettings>): Promise<AppData> => ipcRenderer.invoke("settings:save", settings),
  clearGallery: (): Promise<AppData> => ipcRenderer.invoke("gallery:clear"),
  generateImage: (options: GenerationOptions): Promise<GenerationResult> => ipcRenderer.invoke("image:generate", options),
  generateBatch: (options: GenerationOptions, count: number): Promise<GenerationResult[]> =>
    ipcRenderer.invoke("image:generateBatch", options, count),
  listModels: (): Promise<ModelInfo[]> => ipcRenderer.invoke("knowledge:listModels"),
  exportGalleryZip: (): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke("gallery:exportZip"),
  saveImageAs: (imagePath: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("gallery:saveAs", imagePath),
  loadImageAsDataUrl: (imagePath: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> =>
    ipcRenderer.invoke("gallery:loadAsDataUrl", imagePath),
  saveMask: (maskDataUrl: string, editRunId: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("gallery:saveMask", maskDataUrl, editRunId),
  setApiKey: (apiKey: string): Promise<AppData> => ipcRenderer.invoke("settings:setApiKey", apiKey),
  setThemePreference: (themePreference: ThemePreference): Promise<AppData> =>
    ipcRenderer.invoke("settings:setThemePreference", themePreference),
  onOpenSettings: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on("ui:open-settings", handler);
    return () => ipcRenderer.removeListener("ui:open-settings", handler);
  },
  onOpenAbout: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on("ui:open-about", handler);
    return () => ipcRenderer.removeListener("ui:open-about", handler);
  },
  onThemeMenuChange: (callback: (theme: ThemePreference) => void): Unsubscribe => {
    const handler = (_event: Electron.IpcRendererEvent, theme: ThemePreference): void => callback(theme);
    ipcRenderer.on("ui:theme-changed", handler);
    return () => ipcRenderer.removeListener("ui:theme-changed", handler);
  },
  onMenuExportZip: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on("ui:export-zip", handler);
    return () => ipcRenderer.removeListener("ui:export-zip", handler);
  },
  onMenuClearGallery: (callback: () => void): Unsubscribe => {
    const handler = (): void => callback();
    ipcRenderer.on("ui:clear-gallery", handler);
    return () => ipcRenderer.removeListener("ui:clear-gallery", handler);
  }
};

contextBridge.exposeInMainWorld("appApi", api);
