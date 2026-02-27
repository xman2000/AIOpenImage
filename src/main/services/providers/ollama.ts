import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import type { GalleryItem, GenerationOptions, GenerationResult, ModelInfo } from "../../../shared/types";
import { saveImageBuffer } from "../storage";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const sizeFromAspect = (aspectRatio?: string, imageSize?: string): string => {
  const base = imageSize === "4K" ? 2048 : imageSize === "2K" ? 1536 : 1024;
  const ratioMap: Record<string, [number, number]> = {
    "1:1": [1, 1],
    "16:9": [16, 9],
    "9:16": [9, 16],
    "4:3": [4, 3],
    "3:2": [3, 2],
    "21:9": [21, 9],
    "2:3": [2, 3],
    "3:4": [3, 4],
    "4:5": [4, 5],
    "5:4": [5, 4]
  };
  const ratio = ratioMap[aspectRatio ?? "1:1"] ?? ratioMap["1:1"];
  const [w, h] = ratio;
  const norm = Math.sqrt((base * base) / (w * h));
  const width = Math.max(256, Math.round(w * norm));
  const height = Math.max(256, Math.round(h * norm));
  return `${width}x${height}`;
};

const decodeB64 = (b64: string): Buffer => Buffer.from(b64, "base64");

type OllamaModelsResponse = {
  data?: Array<{ id?: string; name?: string; description?: string; modalities?: string[] }>;
};

type OllamaTagsResponse = {
  models?: Array<{ name?: string; model?: string }>; 
};

const buildOllamaNetworkError = (error: unknown): string => {
  const raw = String(error);
  const detail = raw.toLowerCase();
  if (detail.includes("ollama request failed") || detail.includes("ollama image endpoint") || detail.includes("unable to list ollama models")) {
    return raw;
  }
  if (detail.includes("enotfound") || detail.includes("getaddrinfo")) {
    return "Could not resolve Ollama host. Check the configured base URL.";
  }
  if (detail.includes("econnrefused")) {
    return "Could not connect to Ollama. Ensure Ollama is running and reachable at the configured URL.";
  }
  if (detail.includes("etimedout") || detail.includes("timeout")) {
    return "Connection to Ollama timed out. Check network connectivity and Ollama responsiveness.";
  }
  return `Failed to reach Ollama: ${raw}`;
};

const buildOllamaHttpError = (status: number, message: string): string => {
  const trimmed = message.trim();
  if (status === 404) {
    return `Ollama image endpoint was not found (404). Ensure your Ollama version supports /v1/images/generations. ${trimmed}`.trim();
  }
  if (status === 400) {
    return `Ollama rejected the request (400). Model or parameters may be unsupported. ${trimmed}`.trim();
  }
  if (status >= 500) {
    return `Ollama returned a server error (HTTP ${status}). Retry after checking Ollama logs. ${trimmed}`.trim();
  }
  return `Ollama request failed (HTTP ${status}). ${trimmed}`.trim();
};

export const listOllamaModels = async (baseUrl: string): Promise<ModelInfo[]> => {
  try {
    const response = await fetch(`${baseUrl}/v1/models`);
    if (response.ok) {
      const data = (await response.json()) as OllamaModelsResponse;
      const items = (data.data ?? [])
        .map((m) => {
          const id = String(m.id ?? m.name ?? "").trim();
          if (!id) {
            return null;
          }
          return {
            model_id: id,
            name: id,
            description: String(m.description ?? "Local Ollama model"),
            best_for: ["local generation"],
            cost_estimate: "$0.0000 per image (local)",
            prompt_tips: ["Ensure model supports /v1/images/generations."],
            input_modalities: ["text"],
            output_modalities: ["image"]
          } satisfies ModelInfo;
        })
        .filter((m): m is ModelInfo => m !== null);
      if (items.length > 0) {
        return items;
      }
    }
  } catch {
    // continue to /api/tags fallback
  }

  try {
    const fallback = await fetch(`${baseUrl}/api/tags`);
    if (!fallback.ok) {
      throw new Error(buildOllamaHttpError(fallback.status, `Unable to list Ollama models from ${baseUrl}/api/tags.`));
    }
    const tags = (await fallback.json()) as OllamaTagsResponse;
    return (tags.models ?? [])
      .map((m) => String(m.model ?? m.name ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map(
        (id) =>
          ({
            model_id: id,
            name: id,
            description: "Local Ollama model",
            best_for: ["local generation"],
            cost_estimate: "$0.0000 per image (local)",
            prompt_tips: ["Ensure model supports /v1/images/generations."],
            input_modalities: ["text"],
            output_modalities: ["image"]
          }) satisfies ModelInfo
      );
  } catch (error) {
    throw new Error(buildOllamaNetworkError(error));
  }
};

export const generateImageWithOllama = async (
  options: GenerationOptions,
  userDataPath: string,
  baseUrl: string
): Promise<GenerationResult> => {
  if (!options.prompt.trim()) {
    return { ok: false, error: "Prompt is required" };
  }
  if (!options.model.trim()) {
    return { ok: false, error: "Model is required" };
  }
  if (options.referenceImage) {
    return { ok: false, error: "Image-to-Image is not implemented for Ollama backend in this app yet." };
  }

  const combinedPrompt = [
    options.prompt.trim(),
    options.stylePreset ? `Style: ${options.stylePreset}` : "",
    options.negativePrompt ? `Negative prompt: ${options.negativePrompt.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const requestBody: Record<string, unknown> = {
    model: options.model,
    prompt: combinedPrompt,
    size: sizeFromAspect(options.aspectRatio, options.imageSize),
    response_format: "b64_json"
  };

  let data: Record<string, any> = {};
  try {
    const response = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const text = await response.text();
    try {
      data = text ? (JSON.parse(text) as Record<string, any>) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      const message = data.error?.message ?? data.error ?? `HTTP ${response.status}`;
      return { ok: false, error: buildOllamaHttpError(response.status, String(message)) };
    }
  } catch (error) {
    return { ok: false, error: buildOllamaNetworkError(error) };
  }

  const b64 = data.data?.[0]?.b64_json as string | undefined;
  if (!b64) {
    return {
      ok: false,
      error: "No image was returned by Ollama. Ensure the selected model supports /v1/images/generations."
    };
  }

  const buffer = decodeB64(b64);
  const saved = await saveImageBuffer(userDataPath, options.prompt, buffer, "png");

  let dimensions: { width?: number; height?: number } = {};
  try {
    dimensions = imageSize(buffer);
  } catch {
    dimensions = {};
  }

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
    modelName: options.model,
    timestamp,
    cost: 0,
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
    seed: options.seed,
    img2imgMode: false,
    metadata: {
      width: dimensions.width ?? 0,
      height: dimensions.height ?? 0,
      dimensions: `${dimensions.width ?? 0} x ${dimensions.height ?? 0}px`,
      bytes: buffer.byteLength,
      sizeFormatted: formatBytes(buffer.byteLength),
      format: "png"
    }
  };

  return { ok: true, image, cost: 0 };
};

export const generateImageBatchWithOllama = async (
  options: GenerationOptions,
  count: number,
  userDataPath: string,
  baseUrl: string
): Promise<GenerationResult[]> => {
  const results: GenerationResult[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = typeof options.seed === "number" ? options.seed + i : undefined;
    const result = await generateImageWithOllama({ ...options, seed }, userDataPath, baseUrl);
    if (result.ok && result.image) {
      result.image.batchMode = true;
      result.image.batchIndex = i + 1;
    }
    results.push(result);
  }
  return results;
};
