import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AppData, AppSettings, GalleryItem, ImageBackend, ThemePreference } from "../../shared/types";

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

// Generation runs several requests in parallel, and each completion appends to
// the same JSON file. Without serialization the read-modify-write cycles
// interleave and all but the last writer's entry is lost, so every mutation of
// a given file queues behind the previous one.
const fileQueues = new Map<string, Promise<unknown>>();

const withFileLock = <T>(filePath: string, task: () => Promise<T>): Promise<T> => {
  const previous = fileQueues.get(filePath) ?? Promise.resolve();
  // Run whether or not the previous task settled cleanly; one failed write
  // must not wedge the queue for every later one.
  const next = previous.then(task, task);
  fileQueues.set(
    filePath,
    next.catch(() => undefined)
  );
  return next;
};

// Write via a temp file and rename so an interrupted write cannot leave a
// truncated or half-serialized index behind.
const writeFileAtomic = async (filePath: string, contents: string): Promise<void> => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const ensureDirs = async (userDataPath: string): Promise<void> => {
  await fs.mkdir(path.join(userDataPath, "data"), { recursive: true });
  await fs.mkdir(path.join(userDataPath, "output"), { recursive: true });
};

const galleryPath = (userDataPath: string): string => path.join(userDataPath, "data", "gallery_index.json");
const settingsPath = (userDataPath: string): string => path.join(userDataPath, "data", "settings.json");

const defaultSettings = (): AppSettings => ({
  apiKey: "",
  themePreference: "system",
  imageBackend: "openrouter",
  ollamaBaseUrl: "http://localhost:11434"
});

const sanitizeBackend = (value: unknown): ImageBackend => {
  return value === "ollama" ? "ollama" : "openrouter";
};

const sanitizeBaseUrl = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "http://localhost:11434";
  }
  return value.trim().replace(/\/$/, "");
};

const sanitizeTheme = (value: unknown): ThemePreference => {
  const supported: ThemePreference[] = [
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
  if (value === "midnight" || value === "forest") {
    return "dark";
  }
  if (value === "latte" || value === "cotton-candy" || value === "texas-wildflowers") {
    return "light";
  }
  return supported.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
};

export const getSettings = async (userDataPath: string): Promise<AppSettings> => {
  await ensureDirs(userDataPath);
  const raw = await readJson<Record<string, unknown>>(settingsPath(userDataPath), {});
  const defaults = defaultSettings();
  return {
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : defaults.apiKey,
    themePreference: sanitizeTheme(raw.themePreference),
    imageBackend: sanitizeBackend(raw.imageBackend),
    ollamaBaseUrl: sanitizeBaseUrl(raw.ollamaBaseUrl)
  };
};

export const saveSettings = async (userDataPath: string, settings: Partial<AppSettings>): Promise<AppSettings> =>
  withFileLock(settingsPath(userDataPath), async () => {
    const current = await getSettings(userDataPath);
    const next: AppSettings = {
      apiKey: typeof settings.apiKey === "string" ? settings.apiKey : current.apiKey,
      themePreference: settings.themePreference ? sanitizeTheme(settings.themePreference) : current.themePreference,
      imageBackend: settings.imageBackend ? sanitizeBackend(settings.imageBackend) : current.imageBackend,
      ollamaBaseUrl:
        typeof settings.ollamaBaseUrl === "string" ? sanitizeBaseUrl(settings.ollamaBaseUrl) : current.ollamaBaseUrl
    };
    await writeFileAtomic(settingsPath(userDataPath), JSON.stringify(next, null, 2));
    return next;
  });

export const getAppData = async (userDataPath: string): Promise<AppData> => {
  await ensureDirs(userDataPath);
  const gallery = await readJson<GalleryItem[]>(galleryPath(userDataPath), []);
  const settings = await getSettings(userDataPath);
  const totalCost = gallery.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  return { gallery, totalCost, settings };
};

export const clearGallery = async (userDataPath: string): Promise<void> =>
  withFileLock(galleryPath(userDataPath), async () => {
    await ensureDirs(userDataPath);
    await writeFileAtomic(galleryPath(userDataPath), "[]");
  });

export const saveThemePreference = async (userDataPath: string, themePreference: ThemePreference): Promise<void> => {
  await saveSettings(userDataPath, { themePreference });
};

export const saveImageBuffer = async (
  userDataPath: string,
  prompt: string,
  buffer: Buffer,
  extension: string
): Promise<{ id: string; filePath: string; filename: string }> => {
  await ensureDirs(userDataPath);
  const timestamp = new Date();
  const id = crypto.randomUUID();
  const promptHash = crypto.createHash("md5").update(prompt).digest("hex").slice(0, 8);
  const filename = `img_${timestamp.toISOString().replace(/[:.]/g, "-")}_${promptHash}.${extension}`;
  const filePath = path.join(userDataPath, "output", filename);
  await fs.writeFile(filePath, buffer);
  return { id, filePath, filename };
};

export const saveGeneratedImage = async (
  userDataPath: string,
  image: GalleryItem,
  _prompt: string,
  _cost?: number
): Promise<void> =>
  withFileLock(galleryPath(userDataPath), async () => {
    await ensureDirs(userDataPath);
    const current = await readJson<GalleryItem[]>(galleryPath(userDataPath), []);
    const next = [...current, image];
    await writeFileAtomic(galleryPath(userDataPath), JSON.stringify(next, null, 2));
  });
