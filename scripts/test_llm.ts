import { config } from "dotenv";
config({ path: ".env.local" });

import { loadConfig } from "../src/config.js";
import { createLlmClient } from "../src/llm/llm-client.js";

async function run() {
  const cfg = loadConfig();
  console.log("Config loaded:", {
    llmProvider: cfg.llmProvider,
    llmModel: cfg.llmModel,
    llmEndpoint: cfg.llmEndpoint,
  });
  const client = createLlmClient(cfg);
  try {
    const res = await client.generateScript(
      "https://vnexpress.net/cong-nghe-luong-tu-la-chien-luoc-quoc-gia-5076638.html",
      (msg) => console.log("Progress:", msg)
    );
    console.log("Response:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
