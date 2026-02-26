import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import type { GalleryItem, GenerationResult } from "../../../shared/types";
import type { GenerationOptions } from "../../../shared/types";
import { loadModels } from "../knowledge";
import { saveImageBuffer } from "../storage";

type GenerationWithKey = GenerationOptions & { apiKey: string };

const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const extensionFromMime = (mime: string): string => {
  if (mime.includes("jpeg") || mime.includes("jpg")) {
    return "jpg";
  }
  if (mime.includes("webp")) {
    return "webp";
  }
  return "png";
};

const decodeDataUrl = (dataUrl: string): { buffer: Buffer; extension: string } | null => {
  if (!dataUrl.startsWith("data:image/")) {
    return null;
  }
  const [header, body] = dataUrl.split(",", 2);
  if (!header || !body) {
    return null;
  }
  const mime = header.replace("data:", "").replace(";base64", "");
  const extension = extensionFromMime(mime);
  return { buffer: Buffer.from(body, "base64"), extension };
};

const decodeFromRemoteUrl = async (url: string): Promise<{ buffer: Buffer; extension: string } | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const mime = response.headers.get("content-type") ?? "image/png";
    const extension = extensionFromMime(mime);
    const bytes = await response.arrayBuffer();
    return { buffer: Buffer.from(bytes), extension };
  } catch {
    return null;
  }
};

const decodeImagePayload = async (payload: string): Promise<{ buffer: Buffer; extension: string } | null> => {
  if (payload.startsWith("data:image/")) {
    return decodeDataUrl(payload);
  }
  if (payload.startsWith("http://") || payload.startsWith("https://")) {
    return decodeFromRemoteUrl(payload);
  }
  return null;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const buildMessages = (options: GenerationOptions): unknown[] => {
  if (options.referenceImage) {
    return [
      {
        role: "user",
        content: [
          { type: "text", text: options.prompt },
          { type: "image_url", image_url: { url: options.referenceImage } }
        ]
      }
    ];
  }

  const messages: unknown[] = [{ role: "user", content: options.prompt }];
  if (options.negativePrompt?.trim()) {
    messages.push({ role: "user", content: `Negative: ${options.negativePrompt.trim()}` });
  }
  return messages;
};

const modelNameFor = async (modelId: string, appPath: string): Promise<string> => {
  try {
    const models = await loadModels(appPath);
    const model = models.find((m) => m.model_id === modelId);
    return model?.name ?? modelId;
  } catch {
    return modelId;
  }
};

const estimatedCost = (costEstimate: string): number | undefined => {
  const cleaned = costEstimate.replaceAll("$", "").replaceAll("per image", "").trim();
  if (!cleaned) {
    return undefined;
  }
  if (cleaned.includes("-")) {
    const [low, high] = cleaned.split("-").map((n) => Number.parseFloat(n.trim()));
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return (low + high) / 2;
    }
  }
  const single = Number.parseFloat(cleaned);
  if (Number.isFinite(single)) {
    return single;
  }
  return undefined;
};

const fetchCostEstimate = async (modelId: string, appPath: string): Promise<number | undefined> => {
  try {
    const models = await loadModels(appPath);
    const model = models.find((m) => m.model_id === modelId);
    return model ? estimatedCost(model.cost_estimate) : undefined;
  } catch {
    return undefined;
  }
};

export const generateImage = async (
  options: GenerationWithKey,
  userDataPath: string,
  appPath: string
): Promise<GenerationResult> => {
  if (!options.prompt.trim()) {
    return { ok: false, error: "Prompt is required" };
  }
  if (!options.model.trim()) {
    return { ok: false, error: "Model is required" };
  }

  const requestBody: Record<string, unknown> = {
    model: options.model,
    messages: buildMessages(options),
    modalities: ["image", "text"]
  };

  const imageConfig: Record<string, string> = {};
  if (options.aspectRatio) {
    imageConfig.aspect_ratio = options.aspectRatio;
  }
  if (options.imageSize) {
    imageConfig.image_size = options.imageSize;
  }
  if (Object.keys(imageConfig).length > 0) {
    requestBody.image_config = imageConfig;
  }

  if (typeof options.seed === "number") {
    requestBody.seed = options.seed;
  }

  let data: Record<string, any> | null = null;
  let retries = 0;
  try {
    while (retries < 3) {
      const response = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ai-open-image.local",
          "X-Title": "AI Open Image"
        },
        body: JSON.stringify(requestBody)
      });

      const text = await response.text();
      let parsed: Record<string, any> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, any>) : {};
      } catch {
        parsed = {};
      }

      if (response.status === 429) {
        retries += 1;
        await new Promise((resolve) => setTimeout(resolve, 2 ** retries * 1000));
        continue;
      }

      if (!response.ok) {
        const message = parsed.error?.message ?? `HTTP ${response.status}`;
        return { ok: false, error: message };
      }
      data = parsed;
      break;
    }
  } catch (error) {
    return { ok: false, error: `Network error: ${String(error)}` };
  }

  if (!data) {
    return { ok: false, error: "Max retries exceeded" };
  }

  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
  if (!url) {
    return { ok: false, error: "No image found in API response" };
  }

  const decoded = await decodeImagePayload(url);
  if (!decoded) {
    return { ok: false, error: "Image payload could not be decoded" };
  }

  const saved = await saveImageBuffer(userDataPath, options.prompt, decoded.buffer, decoded.extension);
  let dimensions: { width?: number; height?: number } = {};
  try {
    dimensions = imageSize(decoded.buffer);
  } catch {
    dimensions = {};
  }
  const modelName = await modelNameFor(options.model, appPath);
  const timestamp = new Date().toISOString();
  const id = createHash("sha256").update(saved.id + timestamp).digest("hex").slice(0, 16);

  const image: GalleryItem = {
    id,
    path: saved.filePath,
    filename: saved.filename,
    prompt: options.prompt,
    negativePrompt: options.negativePrompt,
    stylePreset: options.stylePreset,
    model: options.model,
    modelName,
    timestamp,
    cost: await fetchCostEstimate(options.model, appPath),
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
    seed: options.seed,
    img2imgMode: Boolean(options.referenceImage),
    metadata: {
      width: dimensions.width ?? 0,
      height: dimensions.height ?? 0,
      dimensions: `${dimensions.width ?? 0} x ${dimensions.height ?? 0}px`,
      bytes: decoded.buffer.byteLength,
      sizeFormatted: formatBytes(decoded.buffer.byteLength),
      format: decoded.extension
    }
  };

  return { ok: true, image, cost: image.cost };
};

export const generateImageBatch = async (
  options: GenerationWithKey,
  count: number,
  userDataPath: string,
  appPath: string
): Promise<GenerationResult[]> => {
  const results: GenerationResult[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = typeof options.seed === "number" ? options.seed + i : 42 + i;
    const result = await generateImage({ ...options, seed }, userDataPath, appPath);
    if (result.ok && result.image) {
      result.image.batchMode = true;
      result.image.batchIndex = i + 1;
    }
    results.push(result);
  }
  return results;
};
