import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { ModelInfo } from "../../shared/types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/frontend/models/find?fmt=cards&output_modalities=image";

const imageCollectionRank: string[] = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3-pro-image-preview",
  "openai/gpt-5-image-mini",
  "openai/gpt-5-image"
];

const modelRank = (modelId: string): number => {
  const index = imageCollectionRank.indexOf(modelId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const normalizeModel = (raw: Record<string, unknown>): ModelInfo => {
  const inputModalities = Array.isArray(raw.input_modalities) ? raw.input_modalities.map(String) : ["text"];
  return {
    model_id: String(raw.model_id ?? ""),
    name: String(raw.name ?? raw.model_id ?? "Unknown"),
    description: String(raw.description ?? ""),
    best_for: Array.isArray(raw.best_for) ? raw.best_for.map(String) : [],
    cost_estimate: String(raw.cost_estimate ?? "unknown"),
    prompt_tips: Array.isArray(raw.prompt_tips) ? raw.prompt_tips.map(String) : [],
    input_modalities: inputModalities,
    output_modalities: Array.isArray(raw.output_modalities) ? raw.output_modalities.map(String) : ["image"],
    supportsImageEdit:
      typeof raw.supportsImageEdit === "boolean" ? raw.supportsImageEdit : inputModalities.includes("image"),
    supportsMaskEdit: typeof raw.supportsMaskEdit === "boolean" ? raw.supportsMaskEdit : false
  };
};

const loadLocalModels = async (appPath: string): Promise<ModelInfo[]> => {
  const modelsDir = path.join(appPath, "knowledge", "models");
  const entries = await fs.readdir(modelsDir, { withFileTypes: true });
  const files = entries.filter((d) => d.isFile() && d.name.endsWith(".yaml")).map((d) => d.name).sort();

  const models: ModelInfo[] = [];
  for (const file of files) {
    const fullPath = path.join(modelsDir, file);
    const content = await fs.readFile(fullPath, "utf8");
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === "object") {
      models.push(normalizeModel(parsed as Record<string, unknown>));
    }
  }
  return models;
};

type OpenRouterArchitecture = {
  input_modalities?: unknown;
  output_modalities?: unknown;
};

type OpenRouterModel = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  input_modalities?: unknown;
  output_modalities?: unknown;
  architecture?: OpenRouterArchitecture | null;
};

type OpenRouterResponse = {
  data?: {
    models?: OpenRouterModel[];
  };
};

const sortModels = (models: ModelInfo[]): ModelInfo[] => {
  return models.sort((a, b) => {
    const rankDiff = modelRank(a.model_id) - modelRank(b.model_id);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.name.localeCompare(b.name);
  });
};

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.map(String) : [];
};

const fetchRemoteModels = async (): Promise<OpenRouterModel[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, { signal: controller.signal });
    if (!response.ok) {
      return [];
    }
    const parsed = (await response.json()) as OpenRouterResponse;
    return Array.isArray(parsed.data?.models) ? parsed.data.models : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

const mergeRemoteModel = (remote: OpenRouterModel, local?: ModelInfo): ModelInfo | null => {
  const modelIdRaw = typeof remote.slug === "string" ? remote.slug : remote.id;
  const modelId = typeof modelIdRaw === "string" ? modelIdRaw.trim() : "";
  if (!modelId) {
    return null;
  }

  const inputModalities = toStringArray(remote.input_modalities).length
    ? toStringArray(remote.input_modalities)
    : toStringArray(remote.architecture?.input_modalities);
  const outputModalities = toStringArray(remote.output_modalities).length
    ? toStringArray(remote.output_modalities)
    : toStringArray(remote.architecture?.output_modalities);
  if (!outputModalities.includes("image")) {
    return null;
  }

  const hasImageInput = inputModalities.includes("image");
  const fallbackName = modelId;

  return {
    model_id: modelId,
    name: typeof remote.name === "string" && remote.name.trim() ? remote.name : local?.name ?? fallbackName,
    description:
      typeof remote.description === "string" && remote.description.trim()
        ? remote.description
        : local?.description ?? "Image model from OpenRouter catalog.",
    best_for: local?.best_for ?? ["image generation"],
    cost_estimate: local?.cost_estimate ?? "See OpenRouter pricing",
    prompt_tips: local?.prompt_tips ?? ["Use explicit subject, style, and composition instructions."],
    input_modalities: inputModalities.length ? inputModalities : local?.input_modalities ?? ["text"],
    output_modalities: outputModalities.length ? outputModalities : local?.output_modalities ?? ["image", "text"],
    supportsImageEdit:
      typeof local?.supportsImageEdit === "boolean" ? local.supportsImageEdit : hasImageInput,
    supportsMaskEdit: typeof local?.supportsMaskEdit === "boolean" ? local.supportsMaskEdit : false
  };
};

export const loadModels = async (appPath: string): Promise<ModelInfo[]> => {
  const localModels = await loadLocalModels(appPath);
  const localById = new Map(localModels.map((m) => [m.model_id, m]));

  const remoteModels = await fetchRemoteModels();
  if (!remoteModels.length) {
    return sortModels(localModels);
  }

  const merged = remoteModels
    .map((remote) => {
      const keyRaw = typeof remote.slug === "string" ? remote.slug : remote.id;
      const key = typeof keyRaw === "string" ? keyRaw.trim() : "";
      return mergeRemoteModel(remote, localById.get(key));
    })
    .filter((model): model is ModelInfo => model !== null);

  if (!merged.length) {
    return sortModels(localModels);
  }

  return sortModels(merged);
};
