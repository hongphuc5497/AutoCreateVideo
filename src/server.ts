#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ScriptSchema } from "./render/script-schema.js";
import { loadConfig } from "./config.js";
import type { TiktokConfig } from "./config.js";
import { createLlmClient } from "./llm/llm-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "..");
export const OUTPUT_ROOT = join(PROJECT_ROOT, "output");
export const SETTINGS_PATH = join(OUTPUT_ROOT, ".ui-settings.json");
const UI_ROOT = join(PROJECT_ROOT, "src", "ui");
const MAX_BODY_BYTES = 64 * 1024;
const PUBLIC_BASE_PATH = normalizePublicBasePath(process.env.PUBLIC_BASE_PATH);

type JobStatus = "running" | "success" | "failed";
type JobEvent = "log" | "status" | "progress";

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
}

export interface UiSettings {
  tiktok: TiktokConfig;
}

const jobs = new Map<string, Job>();
let runningJob: Job | null = null;

function normalizePublicBasePath(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function publicPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${PUBLIC_BASE_PATH}${normalized}`;
}

function stripPublicBasePath(pathname: string): string {
  if (!PUBLIC_BASE_PATH) return pathname;
  if (pathname === PUBLIC_BASE_PATH) return "/";
  if (pathname.startsWith(`${PUBLIC_BASE_PATH}/`)) {
    return pathname.slice(PUBLIC_BASE_PATH.length) || "/";
  }
  return pathname;
}

export function isPublicDemoMode(): boolean {
  return boolFromEnv("PUBLIC_DEMO_MODE", false);
}

function redactSecret(value: string | undefined): string {
  return value ? "REDACTED" : "";
}

function redactUiSettings(settings: UiSettings): UiSettings {
  return {
    ...settings,
    llm: {
      ...settings.llm,
      apiKey: redactSecret(settings.llm.apiKey),
    },
    tts: {
      ...settings.tts,
      lucylabApiKey: redactSecret(settings.tts.lucylabApiKey),
      lucylabVoiceId: redactSecret(settings.tts.lucylabVoiceId),
      elevenlabsApiKey: redactSecret(settings.tts.elevenlabsApiKey),
      elevenlabsVoiceId: redactSecret(settings.tts.elevenlabsVoiceId),
    },
    gemini: {
      ...settings.gemini,
      apiKey: redactSecret(settings.gemini.apiKey),
    },
  };
}

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
        scriptJson: publicPath(`/outputs/${encodeURIComponent(name)}/script.json`),
        scriptTxt: publicPath(`/outputs/${encodeURIComponent(name)}/script.txt`),
        voiceMp3: publicPath(`/outputs/${encodeURIComponent(name)}/voice.mp3`),
        videoMp4: publicPath(`/outputs/${encodeURIComponent(name)}/video.mp4`),
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

export function normalizeUiSettings(input: unknown, fallback = defaultUiSettings()): UiSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const tiktokInput = source.tiktok && typeof source.tiktok === "object"
    ? source.tiktok as Record<string, unknown>
    : {};
  const enabled = typeof tiktokInput.enabled === "boolean"
    ? tiktokInput.enabled
    : fallback.tiktok.enabled;

  return {
    tiktok: {
      enabled,
      displayName: requiredString(tiktokInput.displayName ?? fallback.tiktok.displayName, "TikTok display name"),
      handle: requiredString(tiktokInput.handle ?? fallback.tiktok.handle, "TikTok handle"),
      followers: requiredString(tiktokInput.followers ?? fallback.tiktok.followers, "TikTok followers"),
      avatarUrl: optionalUrl(tiktokInput.avatarUrl ?? fallback.tiktok.avatarUrl, "TikTok avatar URL"),
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
  return {
    TIKTOK_ENABLED: settings.tiktok.enabled ? "true" : "false",
    TIKTOK_DISPLAY_NAME: settings.tiktok.displayName,
    TIKTOK_HANDLE: settings.tiktok.handle,
    TIKTOK_FOLLOWERS: settings.tiktok.followers,
    TIKTOK_AVATAR_URL: settings.tiktok.avatarUrl ?? "",
  };
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

function emitProgress(job: Job, message: string): void {
  job.logs.push(`[progress] ${message}`);
  emit(job, "progress", { message });
}

async function spawnPipeline(job: Job, scriptPath: string): Promise<void> {
  const settings = await readUiSettings();
  const relPath = toOutputRelative(scriptPath);
  appendLog(job, `$ npm run pipeline -- ${relPath}`);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, ["run", "pipeline", "--", relPath], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...settingsToEnv(settings) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => appendLog(job, chunk.toString()));
  child.stderr.on("data", (chunk) => appendLog(job, chunk.toString()));
  child.on("error", (err) => {
    appendLog(job, `Failed to start process: ${err.message}`);
    finishJob(job, "failed", null);
  });
  child.on("close", (code) => {
    finishJob(job, code === 0 ? "success" : "failed", code);
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
    emitProgress(job, "Creating output directory...");
    const slug = slugFromUrl(url);
    const ts = timestamp();
    const outputDir = join(OUTPUT_ROOT, `${slug}-${ts}`);
    await mkdir(outputDir, { recursive: true });
    job.outputDir = toOutputRelative(outputDir);

    emitProgress(job, "Loading configuration...");
    const cfg = loadConfig();

    emitProgress(job, "Starting LLM script generation...");
    const llmClient = createLlmClient(cfg);
    const rawScript = await llmClient.generateScript(url, (msg) => {
      emitProgress(job, msg);
    });

    emitProgress(job, "Validating generated script...");
    const script = ScriptSchema.parse(rawScript);

    const scriptPath = join(outputDir, "script.json");
    await writeFile(scriptPath, JSON.stringify(script, null, 2));

    emitProgress(job, `Script written to ${toOutputRelative(scriptPath)}`);
    emitProgress(job, "Starting pipeline...");

    await spawnPipeline(job, scriptPath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendLog(job, `Generate failed: ${message}`);
    finishJob(job, "failed", null);
  }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = stripPublicBasePath(url.pathname);

  try {
    if (req.method === "GET" && pathname === "/api/outputs") {
      sendJson(res, 200, { outputs: await listOutputs() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/settings") {
      const settings = await readUiSettings();
      sendJson(res, 200, {
        demoMode: isPublicDemoMode(),
        settings: isPublicDemoMode() ? redactUiSettings(settings) : settings,
      });
      return;
    }

    if (req.method === "PUT" && pathname === "/api/settings") {
      if (isPublicDemoMode()) {
        sendError(res, 403, "Settings are read-only in public demo mode");
        return;
      }
      const body = await readJsonBody(req);
      sendJson(res, 200, { settings: await writeUiSettings(body) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/generate") {
      if (isPublicDemoMode()) {
        sendError(res, 403, "Video generation is disabled in public demo mode");
        return;
      }
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

    if (req.method === "POST" && pathname === "/api/pipeline") {
      if (isPublicDemoMode()) {
        sendError(res, 403, "Pipeline runs are disabled in public demo mode");
        return;
      }
      const body = await readJsonBody(req);
      const scriptPath = await assertExistingScriptPath(body.scriptPath);
      const job = createJob(scriptPath);
      job.outputDir = toOutputRelative(dirname(join(PROJECT_ROOT, scriptPath)));
      sendJson(res, 202, { job: serializeJob(job) });
      spawnPipeline(job, join(PROJECT_ROOT, scriptPath)).catch((e) => {
        appendLog(job, `Failed to start pipeline: ${e instanceof Error ? e.message : String(e)}`);
        finishJob(job, "failed", null);
      });
      return;
    }

    const eventsMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
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

    if (req.method === "GET" && pathname.startsWith("/outputs/")) {
      await serveStatic(res, OUTPUT_ROOT, pathname.slice("/outputs/".length));
      return;
    }

    if (req.method === "GET") {
      const staticPath = pathname === "/" ? "index.html" : pathname.slice(1);
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
