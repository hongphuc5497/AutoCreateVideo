import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  OUTPUT_ROOT,
  assertExistingScriptPath,
  listOutputs,
  safeOutputPath,
  toOutputRelative,
} from "./server.js";

const FIXTURE_NAME = "ui-server-test-fixture";
const FIXTURE_DIR = join(OUTPUT_ROOT, FIXTURE_NAME);

describe("local UI server helpers", () => {
  beforeEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
    await mkdir(FIXTURE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
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
});
