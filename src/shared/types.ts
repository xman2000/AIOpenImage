export type GenerationOptions = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  imageSize?: string;
  seed?: number;
  referenceImage?: string;
  referenceImages?: string[];
  maskImage?: string;
  maskPath?: string;
  editMode?: "generate" | "edit" | "mask-edit";
  parentImageId?: string;
  editRunId?: string;
  editInstruction?: string;
  sourceImagePath?: string;
  batchMode?: boolean;
  batchIndex?: number;
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
  /** USD per generated image, derived from live pricing. Authoritative for math; cost_estimate is display only. */
  estimatedImageCost?: number;
  prompt_tips: string[];
  input_modalities: string[];
  output_modalities: string[];
  supportsImageEdit?: boolean;
  supportsMaskEdit?: boolean;
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
  editMode?: "generate" | "edit" | "mask-edit";
  parentImageId?: string;
  editRunId?: string;
  editInstruction?: string;
  maskPath?: string;
  sourceImagePath?: string;
};

export type ImageMetadata = {
  width: number;
  height: number;
  dimensions: string;
  bytes: number;
  sizeFormatted: string;
  format: string;
};
