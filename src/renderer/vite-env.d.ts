/// <reference types="vite/client" />

import type { AppData, GenerationOptions, GenerationResult, ModelInfo } from "../shared/types";
import type { AppSettings, ThemePreference } from "../shared/types";

declare global {
  interface Window {
    appApi: {
      loadAppData: () => Promise<AppData>;
      getAppInfo: () => Promise<{ name: string; version: string; releaseDate: string; platform: string }>;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppData>;
      clearGallery: () => Promise<AppData>;
      generateImage: (options: GenerationOptions) => Promise<GenerationResult>;
      generateBatch: (options: GenerationOptions, count: number) => Promise<GenerationResult[]>;
      listModels: () => Promise<ModelInfo[]>;
      exportGalleryZip: () => Promise<{ ok: boolean; path?: string; error?: string; warning?: string }>;
      saveImageAs: (imagePath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      loadImageAsDataUrl: (imagePath: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
      saveMask: (maskDataUrl: string, editRunId: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      setThemePreference: (themePreference: ThemePreference) => Promise<AppData>;
      menuReload: () => Promise<void>;
      menuForceReload: () => Promise<void>;
      menuToggleDevTools: () => Promise<void>;
      menuResetZoom: () => Promise<void>;
      menuZoomIn: () => Promise<void>;
      menuZoomOut: () => Promise<void>;
      menuToggleFullscreen: () => Promise<void>;
      menuOpenExternal: (url: string) => Promise<void>;
      menuQuit: () => Promise<void>;
      menuUndo: () => Promise<void>;
      menuRedo: () => Promise<void>;
      menuCut: () => Promise<void>;
      menuCopy: () => Promise<void>;
      menuPaste: () => Promise<void>;
      menuSelectAll: () => Promise<void>;
      onOpenSettings: (callback: () => void) => () => void;
      onOpenAbout: (callback: () => void) => () => void;
      onOpenUserGuide: (callback: () => void) => () => void;
      onThemeMenuChange: (callback: (theme: ThemePreference) => void) => () => void;
      onMenuExportZip: (callback: () => void) => () => void;
      onMenuClearGallery: (callback: () => void) => () => void;
    };
  }
}

export {};
