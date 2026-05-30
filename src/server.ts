#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { ScriptSchema } from "./render/script-schema.js";
import { loadConfig } from "./config.js";
import type { TiktokConfig } from "./config.js";
import { createLlmClient } from "./llm/llm-client.js";
import { WebFetchError } from "./llm/web-fetcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "..");
export const OUTPUT_ROOT = join(PROJECT_ROOT, "output");
export const SETTINGS_PATH = join(OUTPUT_ROOT, ".ui-settings.json");
const UI_ROOT = join(PROJECT_ROOT, "src", "ui");
const MAX_BODY_BYTES = 64 * 1024;

type JobStatus = "running" | "success" | "failed";
type JobEvent = "log" | "status" | "progress" | "error";
type JobStage = "setup" | "fetch" | "script" | "tts" | "render" | "complete";
export type JobErrorCode =
  | "FETCH_FAILED"
  | "FETCH_TOO_LARGE"
  | "LLM_ERROR"
  | "TTS_ERROR"
  | "RENDER_ERROR"
  | "SERVER_MISCONFIGURED"
  | "UNKNOWN";

interface JobError {
  code: JobErrorCode;
  message: string;
}

interface OutputArtifacts {
  scriptJson: boolean;
  scriptTxt: boolean;
  voiceMp3: boolean;
  videoMp4: boolean;
}

export interface OutputItem {
  name: string;
  outputDir: string;
  title: string;
  createdAt?: string;
  modifiedAt: string;
  artifacts: OutputArtifacts;
  paths: {
    scriptJson: string;
    scriptTxt: string;
    voiceMp3: string;
    videoMp4: string;
  };
  urls: {
    scriptJson: string;
    scriptTxt: string;
    voiceMp3: string;
    videoMp4: string;
  };
}

interface Job {
  id: string;
  input: string;
  status: JobStatus;
  exitCode?: number | null;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  listeners: Set<(event: JobEvent, data: unknown) => void>;
  outputDir?: string;
  stage?: JobStage;
  error?: JobError;
}

export interface UiSettings {
  tiktok: TiktokConfig;
  llm: {
    provider: "anthropic" | "openai" | "deepseek";
    apiKey: string;
    model: string;
    endpoint?: string;
  };
  tts: {
    provider: "lucylab" | "elevenlabs";
    lucylabApiKey?: string;
    lucylabVoiceId?: string;
    elevenlabsApiKey?: string;
    elevenlabsVoiceId?: string;
  };
  gemini: {
    apiKey?: string;
    imageModel?: string;
  };
}

const jobs = new Map<string, Job>();
let runningJob: Job | null = null;

export function safeOutputPath(input: string): string {
  if (!input || typeof input !== "string") {
    throw new Error("Path is required");
  }

  const raw = input.trim();
  const resolved = resolve(PROJECT_ROOT, raw);
  const relToOutput = relative(OUTPUT_ROOT, resolved);
  if (relToOutput === "" || relToOutput.startsWith("..") || relToOutput.split(sep).includes("..")) {
    throw new Error("Path must stay inside output/");
  }

  return resolved;
}

export function toOutputRelative(absPath: string): string {
  return `output/${relative(OUTPUT_ROOT, absPath).split(sep).join("/")}`;
}

export async function assertExistingScriptPath(input: string): Promise<string> {
  const resolved = safeOutputPath(input);
  if (extname(resolved) !== ".json" || resolved.split(sep).pop() !== "script.json") {
    throw new Error("scriptPath must point to an output/*/script.json file");
  }
  await access(resolved);
  return toOutputRelative(resolved);
}

export async function listOutputs(): Promise<OutputItem[]> {
  let entries: string[];
  try {
    entries = await readdir(OUTPUT_ROOT);
  } catch {
    return [];
  }

  const items: Array<OutputItem | null> = await Promise.all(entries.map(async (name): Promise<OutputItem | null> => {
    const dir = join(OUTPUT_ROOT, name);
    const s = await stat(dir).catch(() => null);
    if (!s?.isDirectory()) return null;

    const artifacts: OutputArtifacts = {
      scriptJson: await exists(join(dir, "script.json")),
      scriptTxt: await exists(join(dir, "script.txt")),
      voiceMp3: await exists(join(dir, "voice.mp3")),
      videoMp4: await exists(join(dir, "video.mp4")),
    };

    let title = name;
    let createdAt: string | undefined;
    try {
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
      title = String(meta.name || meta.title || title);
      createdAt = typeof meta.createdAt === "string" ? meta.createdAt : undefined;
    } catch {
      try {
        const script = JSON.parse(await readFile(join(dir, "script.json"), "utf8"));
        title = String(script.metadata?.title || title);
      } catch {
        // Keep folder name.
      }
    }

    const outputDir = `output/${name}`;
    return {
      name,
      outputDir,
      title,
      createdAt,
      modifiedAt: s.mtime.toISOString(),
      artifacts,
      paths: {
        scriptJson: `${outputDir}/script.json`,
        scriptTxt: `${outputDir}/script.txt`,
        voiceMp3: `${outputDir}/voice.mp3`,
        videoMp4: `${outputDir}/video.mp4`,
      },
      urls: {
        scriptJson: `/outputs/${encodeURIComponent(name)}/script.json`,
        scriptTxt: `/outputs/${encodeURIComponent(name)}/script.txt`,
        voiceMp3: `/outputs/${encodeURIComponent(name)}/voice.mp3`,
        videoMp4: `/outputs/${encodeURIComponent(name)}/video.mp4`,
      },
    };
  }));

  return items
    .filter((item): item is OutputItem => item !== null)
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

function boolFromEnv(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (!v) return def;
  if (["1", "true", "yes", "on"].includes(v.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(v.toLowerCase())) return false;
  return def;
}

export function defaultUiSettings(): UiSettings {
  return {
    tiktok: {
      enabled: boolFromEnv("TIKTOK_ENABLED", true),
      displayName: process.env.TIKTOK_DISPLAY_NAME ?? "Công nghệ 24h",
      handle: process.env.TIKTOK_HANDLE ?? "@congnghe24h",
      followers: process.env.TIKTOK_FOLLOWERS ?? "1.2M followers",
      avatarUrl: process.env.TIKTOK_AVATAR_URL || undefined,
    },
    llm: {
      provider: (process.env.LLM_PROVIDER ?? "anthropic") as "anthropic" | "openai" | "deepseek",
      apiKey: process.env.LLM_API_KEY ?? "",
      model: process.env.LLM_MODEL ?? "claude-haiku-4-5-20251001",
      endpoint: process.env.LLM_ENDPOINT ?? "",
    },
    tts: {
      provider: (process.env.TTS_PROVIDER ?? "lucylab") as "lucylab" | "elevenlabs",
      lucylabApiKey: process.env.VIETNAMESE_API_KEY ?? "",
      lucylabVoiceId: process.env.VIETNAMESE_VOICEID ?? "",
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
      elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? "",
      imageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
    },
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function optionalUrl(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^https?:\/\/.+/.test(trimmed)) {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
  return trimmed;
}

function optionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function normalizeUiSettings(input: unknown, fallback = defaultUiSettings()): UiSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const tiktokInput = source.tiktok && typeof source.tiktok === "object"
    ? source.tiktok as Record<string, unknown>
    : {};
  const enabled = typeof tiktokInput.enabled === "boolean"
    ? tiktokInput.enabled
    : fallback.tiktok.enabled;

  const llmInput = source.llm && typeof source.llm === "object"
    ? source.llm as Record<string, unknown>
    : {};
  const ttsInput = source.tts && typeof source.tts === "object"
    ? source.tts as Record<string, unknown>
    : {};
  const geminiInput = source.gemini && typeof source.gemini === "object"
    ? source.gemini as Record<string, unknown>
    : {};

  return {
    tiktok: {
      enabled,
      displayName: requiredString(tiktokInput.displayName ?? fallback.tiktok.displayName, "TikTok display name"),
      handle: requiredString(tiktokInput.handle ?? fallback.tiktok.handle, "TikTok handle"),
      followers: requiredString(tiktokInput.followers ?? fallback.tiktok.followers, "TikTok followers"),
      avatarUrl: optionalUrl(tiktokInput.avatarUrl ?? fallback.tiktok.avatarUrl, "TikTok avatar URL"),
    },
    llm: {
      provider: (llmInput.provider ?? fallback.llm.provider) as "anthropic" | "openai" | "deepseek",
      apiKey: optionalString(llmInput.apiKey ?? fallback.llm.apiKey),
      model: optionalString(llmInput.model ?? fallback.llm.model),
      endpoint: optionalString(llmInput.endpoint ?? fallback.llm.endpoint),
    },
    tts: {
      provider: (ttsInput.provider ?? fallback.tts.provider) as "lucylab" | "elevenlabs",
      lucylabApiKey: optionalString(ttsInput.lucylabApiKey ?? fallback.tts.lucylabApiKey),
      lucylabVoiceId: optionalString(ttsInput.lucylabVoiceId ?? fallback.tts.lucylabVoiceId),
      elevenlabsApiKey: optionalString(ttsInput.elevenlabsApiKey ?? fallback.tts.elevenlabsApiKey),
      elevenlabsVoiceId: optionalString(ttsInput.elevenlabsVoiceId ?? fallback.tts.elevenlabsVoiceId),
    },
    gemini: {
      apiKey: optionalString(geminiInput.apiKey ?? fallback.gemini.apiKey),
      imageModel: optionalString(geminiInput.imageModel ?? fallback.gemini.imageModel),
    },
  };
}

export async function readUiSettings(): Promise<UiSettings> {
  const defaults = defaultUiSettings();
  try {
    const raw = JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
    return normalizeUiSettings(raw, defaults);
  } catch (e) {
    const code = typeof e === "object" && e && "code" in e ? String((e as NodeJS.ErrnoException).code) : "";
    if (code === "ENOENT") return defaults;
    throw e;
  }
}

export async function writeUiSettings(input: unknown): Promise<UiSettings> {
  const settings = normalizeUiSettings(input, await readUiSettings());
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

export function settingsToEnv(settings: UiSettings): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    TIKTOK_ENABLED: settings.tiktok.enabled ? "true" : "false",
    TIKTOK_DISPLAY_NAME: settings.tiktok.displayName,
    TIKTOK_HANDLE: settings.tiktok.handle,
    TIKTOK_FOLLOWERS: settings.tiktok.followers,
    TIKTOK_AVATAR_URL: settings.tiktok.avatarUrl ?? "",
  };
  if (settings.llm) {
    env.LLM_PROVIDER = settings.llm.provider;
    env.LLM_API_KEY = settings.llm.apiKey;
    env.LLM_MODEL = settings.llm.model;
    env.LLM_ENDPOINT = settings.llm.endpoint;
  }
  if (settings.tts) {
    env.TTS_PROVIDER = settings.tts.provider;
    env.VIETNAMESE_API_KEY = settings.tts.lucylabApiKey;
    env.VIETNAMESE_VOICEID = settings.tts.lucylabVoiceId;
    env.ELEVENLABS_API_KEY = settings.tts.elevenlabsApiKey;
    env.ELEVENLABS_VOICE_ID = settings.tts.elevenlabsVoiceId;
  }
  if (settings.gemini) {
    env.GEMINI_API_KEY = settings.gemini.apiKey;
    env.GEMINI_IMAGE_MODEL = settings.gemini.imageModel;
  }
  return env;
}

function createJob(input: string): Job {
  if (runningJob) {
    throw new Error(`Job ${runningJob.id} is still running`);
  }

  const job: Job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    input,
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  runningJob = job;
  return job;
}

function emit(job: Job, event: JobEvent, data: unknown): void {
  for (const listener of job.listeners) {
    listener(event, data);
  }
}

function appendLog(job: Job, text: string): void {
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line) continue;
    job.logs.push(line);
    emit(job, "log", { line });
  }
}

function emitProgress(job: Job, stage: JobStage, message: string): void {
  job.stage = stage;
  job.logs.push(`[progress] ${message}`);
  emit(job, "progress", { stage, message });
}

export function classifyJobError(error: unknown): JobError {
  if (error instanceof WebFetchError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { code: "LLM_ERROR", message: `Generated script failed schema validation: ${error.message}` };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/LLM_API_KEY|No response from LLM|JSON parse|anthropic|openai|deepseek|rate limit/i.test(message)) {
    return { code: "LLM_ERROR", message };
  }
  if (/VIETNAMESE_API_KEY|VIETNAMESE_VOICEID|ELEVENLABS_API_KEY|ELEVENLABS_VOICE_ID|ffmpeg|ffprobe|ENOENT/i.test(message)) {
    return { code: "SERVER_MISCONFIGURED", message };
  }
  return { code: "UNKNOWN", message };
}

function lastMatchingLog(logs: string[], pattern: RegExp): string | undefined {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];
    if (pattern.test(line)) return line.replace(/^Error:\s*/, "");
  }
  return undefined;
}

export function classifyPipelineExit(logs: string[], exitCode: number | null): JobError {
  const ttsMessage = lastMatchingLog(
    logs,
    /ElevenLabs TTS failed|LucyLab .*error|LucyLab export .*failed|LucyLab returned|TTS failed/i,
  );
  if (ttsMessage) {
    return { code: "TTS_ERROR", message: ttsMessage };
  }

  const misconfiguredMessage = lastMatchingLog(logs, /ffmpeg|ffprobe|ENOENT|No bundled avatar/i);
  if (misconfiguredMessage) {
    return { code: "SERVER_MISCONFIGURED", message: misconfiguredMessage };
  }

  return { code: "RENDER_ERROR", message: `Pipeline exited with code ${exitCode}` };
}

function failJob(job: Job, error: JobError, exitCode: number | null): void {
  if (job.status !== "running") return;
  job.error = error;
  appendLog(job, `Job failed [${error.code}]: ${error.message}`);
  emit(job, "error", error);
  finishJob(job, "failed", exitCode);
}

async function spawnPipeline(job: Job, scriptPath: string): Promise<void> {
  const settings = await readUiSettings();
  const relPath = toOutputRelative(scriptPath);
  emitProgress(job, "tts", "Generating voiceover...");
  appendLog(job, `$ npm run pipeline -- ${relPath}`);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, ["run", "pipeline", "--", relPath], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...settingsToEnv(settings) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handleOutput = (text: string) => {
    appendLog(job, text);
    if (/Render with hyperframes/i.test(text)) {
      emitProgress(job, "render", "Rendering video...");
    } else if (/\bDone\b|=== Result ===/i.test(text)) {
      emitProgress(job, "complete", "Video complete");
    }
  };
  child.stdout.on("data", (chunk) => handleOutput(chunk.toString()));
  child.stderr.on("data", (chunk) => handleOutput(chunk.toString()));
  child.on("error", (err) => {
    failJob(job, { code: "SERVER_MISCONFIGURED", message: `Failed to start process: ${err.message}` }, null);
  });
  child.on("close", (code) => {
    if (code === 0) {
      emitProgress(job, "complete", "Video complete");
      finishJob(job, "success", code);
    } else {
      failJob(job, classifyPipelineExit(job.logs, code), code);
    }
  });
}

function finishJob(job: Job, status: JobStatus, exitCode: number | null): void {
  if (job.status !== "running") return;
  job.status = status;
  job.exitCode = exitCode;
  job.finishedAt = new Date().toISOString();
  if (runningJob?.id === job.id) {
    runningJob = null;
  }
  emit(job, "status", serializeJob(job));
}

function serializeJob(job: Job) {
  return {
    id: job.id,
    input: job.input,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    outputDir: job.outputDir,
    stage: job.stage,
    error: job.error,
    logs: job.logs,
  };
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message });
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(res: ServerResponse, root: string, relPath: string): Promise<void> {
  const decoded = decodeURIComponent(relPath);
  const target = resolve(root, decoded);
  const rel = relative(root, target);
  const parts = rel.split(sep);
  if (rel.startsWith("..") || parts.includes("..") || parts.some((part) => part.startsWith("."))) {
    sendError(res, 403, "Forbidden");
    return;
  }
  const s = await stat(target).catch(() => null);
  if (!s?.isFile()) {
    sendError(res, 404, "Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType(target),
    "Content-Length": s.size,
    "Cache-Control": root === OUTPUT_ROOT ? "no-store" : "public, max-age=60",
  });
  createReadStream(target).pipe(res);
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".mp3": return "audio/mpeg";
    case ".mp4": return "video/mp4";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    const path = u.pathname.replace(/\/+$/, "").split("/").pop() || "";
    const raw = path
      ? `${host}-${path}`
      : host;
    return raw
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .toLowerCase() || "video";
  } catch {
    return "video";
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function runGenerateJob(job: Job, url: string, res: ServerResponse): Promise<void> {
  try {
    emitProgress(job, "setup", "Creating output directory...");
    const slug = slugFromUrl(url);
    const ts = timestamp();
    const outputDir = join(OUTPUT_ROOT, `${slug}-${ts}`);
    await mkdir(outputDir, { recursive: true });
    job.outputDir = toOutputRelative(outputDir);

    emitProgress(job, "setup", "Loading configuration...");
    const cfg = loadConfig();

    emitProgress(job, "script", "Starting LLM script generation...");
    const llmClient = createLlmClient(cfg);
    const rawScript = await llmClient.generateScript(url, (msg) => {
      emitProgress(job, msg.startsWith("Fetching ") ? "fetch" : "script", msg);
    });

    emitProgress(job, "script", "Validating generated script...");
    const script = ScriptSchema.parse(rawScript);

    const scriptPath = join(outputDir, "script.json");
    await writeFile(scriptPath, JSON.stringify(script, null, 2));

    emitProgress(job, "script", `Script written to ${toOutputRelative(scriptPath)}`);
    emitProgress(job, "tts", "Starting pipeline...");

    await spawnPipeline(job, scriptPath);
  } catch (e) {
    failJob(job, classifyJobError(e), null);
  }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/api/outputs") {
      sendJson(res, 200, { outputs: await listOutputs() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, { settings: await readUiSettings() });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readJsonBody(req);
      sendJson(res, 200, { settings: await writeUiSettings(body) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readJsonBody(req);
      const articleUrl = String(body.url || "").trim();
      if (!articleUrl || !/^https?:\/\/.+/.test(articleUrl)) {
        sendError(res, 400, "A valid HTTP(S) URL is required");
        return;
      }
      const job = createJob(articleUrl);
      sendJson(res, 202, { job: serializeJob(job) });
      // Fire-and-forget: don't await, let it run async
      runGenerateJob(job, articleUrl, res).catch(() => {});
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pipeline") {
      const body = await readJsonBody(req);
      const scriptPath = await assertExistingScriptPath(body.scriptPath);
      const job = createJob(scriptPath);
      job.outputDir = toOutputRelative(dirname(join(PROJECT_ROOT, scriptPath)));
      sendJson(res, 202, { job: serializeJob(job) });
      spawnPipeline(job, join(PROJECT_ROOT, scriptPath)).catch((e) => {
        failJob(job, classifyJobError(e), null);
      });
      return;
    }

    const eventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      const job = jobs.get(eventsMatch[1]);
      if (!job) {
        sendError(res, 404, "Job not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      });
      const send = (event: JobEvent | "snapshot", data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      send("snapshot", serializeJob(job));
      const listener = (event: JobEvent, data: unknown) => send(event, data);
      job.listeners.add(listener);
      req.on("close", () => job.listeners.delete(listener));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/outputs/")) {
      await serveStatic(res, OUTPUT_ROOT, url.pathname.slice("/outputs/".length));
      return;
    }

    if (req.method === "GET") {
      const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      await serveStatic(res, UI_ROOT, staticPath);
      return;
    }

    sendError(res, 405, "Method not allowed");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.includes("still running") ? 409 : 400;
    sendError(res, status, message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4317);
  const host = process.env.HOST ?? "127.0.0.1";
  createServer((req, res) => {
    handleRequest(req, res).catch((e) => sendError(res, 500, e instanceof Error ? e.message : String(e)));
  }).listen(port, host, () => {
    console.log(`Auto News Video UI: http://${host}:${port}${PUBLIC_BASE_PATH || "/"}`);
  });
}
