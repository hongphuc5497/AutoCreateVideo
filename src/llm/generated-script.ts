import { ScriptSchema } from "../render/script-schema.js";

export function parseGeneratedScriptJson(text: string): Record<string, unknown> {
  const jsonText = text.trim();
  const jsonMatch = jsonText.match(/(?:```(?:json)?\s*)?([\s\S]*?)(?:\s*```)?$/);
  const cleanJson = jsonMatch ? jsonMatch[1].trim() : jsonText;
  const parsed = JSON.parse(cleanJson);
  return ScriptSchema.parse(parsed) as Record<string, unknown>;
}

export function formatGeneratedScriptError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
