export type GenerationOptions = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  stylePreset?: string;
  aspectRatio?: string;
  imageSize?: string;
  seed?: number;
  referenceImage?: string;
};

export type ThemePreference =
  | "system"
  | "light"
  | "dark"
  | "terminal"
  | "amber-terminal"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "indigo"
  | "white";

export type ImageBackend = "openrouter" | "ollama";

export type AppSettings = {
  apiKey: string;
  themePreference: ThemePreference;
  imageBackend: ImageBackend;
  ollamaBaseUrl: string;
};

export type GenerationResult = {
  ok: boolean;
  error?: string;
  image?: GalleryItem;
  cost?: number;
};

export type ModelInfo = {
  model_id: string;
  name: string;
  description: string;
  best_for: string[];
  cost_estimate: string;
  prompt_tips: string[];
  input_modalities: string[];
  output_modalities: string[];
};

export type AppData = {
  gallery: GalleryItem[];
  totalCost: number;
  settings: AppSettings;
};

export type GalleryItem = {
  id: string;
  path: string;
  filename: string;
  prompt: string;
  negativePrompt?: string;
  stylePreset?: string;
  model: string;
  modelName: string;
  timestamp: string;
  cost?: number;
  aspectRatio?: string;
  imageSize?: string;
  seed?: number;
  metadata?: ImageMetadata;
  batchMode?: boolean;
  batchIndex?: number;
  img2imgMode?: boolean;
};

export type ImageMetadata = {
  width: number;
  height: number;
  dimensions: string;
  bytes: number;
  sizeFormatted: string;
  format: string;
};
