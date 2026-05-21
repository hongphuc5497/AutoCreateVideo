import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  OUTPUT_ROOT,
  SETTINGS_PATH,
  assertExistingScriptPath,
  classifyJobError,
  defaultUiSettings,
  listOutputs,
  normalizeUiSettings,
  readUiSettings,
  safeOutputPath,
  settingsToEnv,
  toOutputRelative,
  writeUiSettings,
} from "./server.js";
import { WebFetchError } from "./llm/web-fetcher.js";

const FIXTURE_NAME = "ui-server-test-fixture";
const FIXTURE_DIR = join(OUTPUT_ROOT, FIXTURE_NAME);

describe("local UI server helpers", () => {
  beforeEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
    await rm(SETTINGS_PATH, { force: true });
    await mkdir(FIXTURE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
    await rm(SETTINGS_PATH, { force: true });
  });

  it("rejects paths outside output", () => {
    expect(() => safeOutputPath("../package.json")).toThrow(/inside output/);
    expect(() => safeOutputPath("src/server.ts")).toThrow(/inside output/);
  });

  it("accepts an existing output script path", async () => {
    await writeFile(join(FIXTURE_DIR, "script.json"), "{}");
    await expect(assertExistingScriptPath(`output/${FIXTURE_NAME}/script.json`))
      .resolves.toBe(`output/${FIXTURE_NAME}/script.json`);
  });

  it("rejects bogus script path filenames", async () => {
    await expect(assertExistingScriptPath(`output/${FIXTURE_NAME}/other.json`))
      .rejects.toThrow(/script\.json/);
  });

  it("converts absolute output paths to output/ relative", () => {
    const abs = join(OUTPUT_ROOT, FIXTURE_NAME, "script.json");
    expect(toOutputRelative(abs)).toBe(`output/${FIXTURE_NAME}/script.json`);
  });

  it("lists output folders with artifact flags and metadata", async () => {
    await writeFile(join(FIXTURE_DIR, "script.json"), JSON.stringify({
      metadata: { title: "Fixture Script" },
    }));
    await writeFile(join(FIXTURE_DIR, "script.txt"), "hello");
    await writeFile(join(FIXTURE_DIR, "voice.mp3"), "audio");

    const outputs = await listOutputs();
    const fixture = outputs.find((item) => item.name === FIXTURE_NAME);

    expect(fixture).toMatchObject({
      outputDir: `output/${FIXTURE_NAME}`,
      title: "Fixture Script",
      artifacts: {
        scriptJson: true,
        scriptTxt: true,
        voiceMp3: true,
        videoMp4: false,
      },
      paths: {
        scriptJson: `output/${FIXTURE_NAME}/script.json`,
      },
      urls: {
        videoMp4: `/outputs/${FIXTURE_NAME}/video.mp4`,
      },
    });
  });

  it("loads default UI settings from environment fallback", async () => {
    await expect(readUiSettings()).resolves.toEqual(defaultUiSettings());
  });

  it("normalizes and persists TikTok UI settings", async () => {
    const settings = await writeUiSettings({
      tiktok: {
        enabled: false,
        displayName: "  UI Channel  ",
        handle: "  @ui-channel  ",
        followers: "  99 followers  ",
        avatarUrl: "  https://example.com/avatar.png  ",
      },
    });

    expect(settings).toEqual({
      tiktok: {
        enabled: false,
        displayName: "UI Channel",
        handle: "@ui-channel",
        followers: "99 followers",
        avatarUrl: "https://example.com/avatar.png",
      },
      llm: defaultUiSettings().llm,
      tts: defaultUiSettings().tts,
      gemini: defaultUiSettings().gemini,
    });
    await expect(readUiSettings()).resolves.toEqual(settings);
    expect(settingsToEnv(settings)).toMatchObject({
      TIKTOK_ENABLED: "false",
      TIKTOK_DISPLAY_NAME: "UI Channel",
      TIKTOK_HANDLE: "@ui-channel",
      TIKTOK_FOLLOWERS: "99 followers",
      TIKTOK_AVATAR_URL: "https://example.com/avatar.png",
    });
  });

  it("rejects invalid TikTok settings", () => {
    expect(() => normalizeUiSettings({
      tiktok: {
        enabled: true,
        displayName: "",
        handle: "@bad",
        followers: "1",
      },
    })).toThrow(/display name/);

    expect(() => normalizeUiSettings({
      tiktok: {
        enabled: true,
        displayName: "Bad",
        handle: "@bad",
        followers: "1",
        avatarUrl: "ftp://example.com/avatar.png",
      },
    })).toThrow(/HTTP\(S\)/);
  });

  it("classifies fetch and provider errors for friend-ready UI messages", () => {
    expect(classifyJobError(new WebFetchError("FETCH_FAILED", "HTTP 404"))).toEqual({
      code: "FETCH_FAILED",
      message: "HTTP 404",
    });
    expect(classifyJobError(new WebFetchError("FETCH_TOO_LARGE", "too big")).code).toBe("FETCH_TOO_LARGE");
    expect(classifyJobError(new Error("Missing LLM_API_KEY")).code).toBe("LLM_ERROR");
    expect(classifyJobError(new Error("Missing VIETNAMESE_API_KEY")).code).toBe("SERVER_MISCONFIGURED");
    expect(classifyJobError(new Error("weird failure")).code).toBe("UNKNOWN");
  });

});
