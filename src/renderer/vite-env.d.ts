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
      exportGalleryZip: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      saveImageAs: (imagePath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      loadImageAsDataUrl: (imagePath: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
      saveMask: (maskDataUrl: string, editRunId: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      setApiKey: (apiKey: string) => Promise<AppData>;
      setThemePreference: (themePreference: ThemePreference) => Promise<AppData>;
      onOpenSettings: (callback: () => void) => () => void;
      onOpenAbout: (callback: () => void) => () => void;
      onThemeMenuChange: (callback: (theme: ThemePreference) => void) => () => void;
      onMenuExportZip: (callback: () => void) => () => void;
      onMenuClearGallery: (callback: () => void) => () => void;
    };
  }
}

export {};
