import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { ModelInfo } from "../../shared/types";

const imageCollectionRank: string[] = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3-pro-image-preview",
  "bytedance-seed/seedream-4.5",
  "openai/gpt-5-image-mini",
  "openai/gpt-5-image",
  "sourceful/riverflow-v2-fast",
  "sourceful/riverflow-v2-pro",
  "sourceful/riverflow-v2-fast-preview",
  "google/gemini-3.1-flash-image-preview",
  "sourceful/riverflow-v2-max-preview",
  "sourceful/riverflow-v2-standard-preview",
  "black-forest-labs/flux.2-klein-4b"
];

const modelRank = (modelId: string): number => {
  const index = imageCollectionRank.indexOf(modelId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const normalizeModel = (raw: Record<string, unknown>): ModelInfo => ({
  model_id: String(raw.model_id ?? ""),
  name: String(raw.name ?? raw.model_id ?? "Unknown"),
  description: String(raw.description ?? ""),
  best_for: Array.isArray(raw.best_for) ? raw.best_for.map(String) : [],
  cost_estimate: String(raw.cost_estimate ?? "unknown"),
  prompt_tips: Array.isArray(raw.prompt_tips) ? raw.prompt_tips.map(String) : [],
  input_modalities: Array.isArray(raw.input_modalities) ? raw.input_modalities.map(String) : ["text"],
  output_modalities: Array.isArray(raw.output_modalities) ? raw.output_modalities.map(String) : ["image"]
});

export const loadModels = async (appPath: string): Promise<ModelInfo[]> => {
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
  return models.sort((a, b) => {
    const rankDiff = modelRank(a.model_id) - modelRank(b.model_id);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.name.localeCompare(b.name);
  });
};
