const state = {
  outputs: [],
  events: null,
  activeJob: null,
};
let currentStep = 1;

const $ = (selector) => document.querySelector(selector);

const outputsList = $("#outputsList");
const outputCount = $("#outputCount");
const articleUrl = $("#articleUrl");
const scriptPath = $("#scriptPath");
const jobLog = $("#jobLog");
const jobStatus = $("#jobStatus");
const artifactLinks = $("#artifactLinks");
const errorBanner = $("#errorBanner");
const progressPanel = $("#progressPanel");
const settingsStatus = $("#settingsStatus");

// LLM Fields
const llmProvider = $("#llmProvider");
const llmApiKey = $("#llmApiKey");
const llmModel = $("#llmModel");
const llmEndpoint = $("#llmEndpoint");

// TTS Fields
const ttsProvider = $("#ttsProvider");
const lucylabApiKey = $("#lucylabApiKey");
const lucylabVoiceId = $("#lucylabVoiceId");
const elevenlabsApiKey = $("#elevenlabsApiKey");
const elevenlabsVoiceId = $("#elevenlabsVoiceId");

// Gemini Fields
const geminiApiKey = $("#geminiApiKey");
const geminiImageModel = $("#geminiImageModel");

// TikTok Fields
const tiktokEnabled = $("#tiktokEnabled");
const tiktokDisplayName = $("#tiktokDisplayName");
const tiktokHandle = $("#tiktokHandle");
const tiktokFollowers = $("#tiktokFollowers");
const tiktokAvatarUrl = $("#tiktokAvatarUrl");

// Watermark Live Preview
const watermarkPreviewHandle = $("#watermarkPreviewHandle");

// Wizard Navigation
const prevStepBtn = $("#prevStepBtn");
const nextStepBtn = $("#nextStepBtn");

const STAGES = ["fetch", "script", "tts", "render", "complete"];
const ERROR_MESSAGES = {
  FETCH_FAILED: "Không đọc được bài viết từ URL này. Thử một URL khác.",
  FETCH_TOO_LARGE: "Bài viết quá dài. Thử bài ngắn hơn.",
  LLM_ERROR: "Không tạo được kịch bản. Hãy báo cho người quản lý.",
  TTS_ERROR: "Không tạo được giọng đọc. Hãy báo cho người quản lý.",
  RENDER_ERROR: "Không render được video. Kiểm tra dung lượng trống hoặc thử lại.",
  SERVER_MISCONFIGURED: "Máy chủ chưa được thiết lập đầy đủ. Hãy báo cho người quản lý.",
  UNKNOWN: "Có lỗi xảy ra. Thử lại.",
};

$("#refreshOutputs").addEventListener("click", loadOutputs);

$("#generateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  startJob("/api/generate", { url: articleUrl.value.trim() });
});

$("#pipelineForm").addEventListener("submit", (event) => {
  event.preventDefault();
  startJob("/api/pipeline", { scriptPath: scriptPath.value.trim() });
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (validateStep(currentStep)) {
    await saveSettings();
  }
});

tiktokEnabled.addEventListener("change", updateTiktokInputs);
tiktokHandle.addEventListener("input", updateWatermarkPreview);
ttsProvider.addEventListener("change", updateTtsProviderBlock);

prevStepBtn.addEventListener("click", () => {
  if (currentStep > 1) {
    setWizardStep(currentStep - 1);
  }
});

nextStepBtn.addEventListener("click", async () => {
  if (currentStep < 4) {
    if (!validateStep(currentStep)) return;
    const ok = await saveSettings();
    if (ok) {
      setWizardStep(currentStep + 1);
    }
  }
});

document.querySelectorAll(".wizard-step").forEach((stepEl) => {
  stepEl.addEventListener("click", async () => {
    const targetStep = parseInt(stepEl.dataset.step, 10);
    if (targetStep === currentStep) return;

    if (targetStep > currentStep) {
      if (!validateStep(currentStep)) return;
      const ok = await saveSettings();
      if (!ok) return;
    }

    setWizardStep(targetStep);
  });
});

function setWizardStep(step) {
  if (step < 1 || step > 4) return;
  currentStep = step;

  // Update visual timeline dots
  document.querySelectorAll(".wizard-step").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle("active", s === currentStep);
    el.classList.toggle("completed", s < currentStep);
  });

  // Toggle visible wizard panels
  document.querySelectorAll(".wizard-content").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle("active", s === currentStep);
  });

  // Enable/disable navigation buttons
  prevStepBtn.disabled = currentStep === 1;
  if (currentStep === 4) {
    nextStepBtn.style.display = "none";
  } else {
    nextStepBtn.style.display = "inline-block";
    nextStepBtn.textContent = "Next";
  }
}

function validateStep(step) {
  settingsStatus.textContent = "";

  if (step === 1) {
    const endpointVal = llmEndpoint.value.trim();
    if (endpointVal && !/^https?:\/\/.+/.test(endpointVal)) {
      settingsStatus.textContent = "Custom Endpoint must start with http:// or https://";
      return false;
    }
  } else if (step === 2) {
    // Gemini/TTS key validations can be kept loose as they support environment variable fallbacks
  } else if (step === 3) {
    if (tiktokEnabled.checked) {
      if (!tiktokDisplayName.value.trim()) {
        settingsStatus.textContent = "Display name is required when branding is enabled";
        return false;
      }
      if (!tiktokHandle.value.trim()) {
        settingsStatus.textContent = "Handle is required when branding is enabled";
        return false;
      }
      if (!tiktokFollowers.value.trim()) {
        settingsStatus.textContent = "Followers is required when branding is enabled";
        return false;
      }
      const avatarVal = tiktokAvatarUrl.value.trim();
      if (avatarVal && !/^https?:\/\/.+/.test(avatarVal)) {
        settingsStatus.textContent = "Avatar URL must start with http:// or https://";
        return false;
      }
    }
  }
  return true;
}

function updateWatermarkPreview() {
  const handleVal = tiktokHandle.value.trim() || "@handle";
  const displayHandle = handleVal.startsWith("@") ? handleVal : `@${handleVal}`;
  watermarkPreviewHandle.textContent = displayHandle;
}

function updateTtsProviderBlock() {
  const val = ttsProvider.value;
  if (val === "lucylab") {
    $("#lucylabSettingsBlock").style.display = "block";
    $("#elevenlabsSettingsBlock").style.display = "none";
  } else if (val === "elevenlabs") {
    $("#lucylabSettingsBlock").style.display = "none";
    $("#elevenlabsSettingsBlock").style.display = "block";
  }
}

async function loadSettings() {
  settingsStatus.textContent = "Loading settings...";
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to load settings");
    applySettings(data.settings);
    settingsStatus.textContent = "Settings ready";
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

async function saveSettings() {
  settingsStatus.textContent = "Saving settings...";
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readSettingsForm()),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to save settings");
    applySettings(data.settings);
    settingsStatus.textContent = "Settings saved";
    return true;
  } catch (error) {
    settingsStatus.textContent = error.message;
    return false;
  }
}

function applySettings(settings) {
  // LLM
  const llm = settings.llm || {};
  llmProvider.value = llm.provider || "anthropic";
  llmApiKey.value = llm.apiKey || "";
  llmModel.value = llm.model || "";
  llmEndpoint.value = llm.endpoint || "";

  // TTS
  const tts = settings.tts || {};
  ttsProvider.value = tts.provider || "lucylab";
  lucylabApiKey.value = tts.lucylabApiKey || "";
  lucylabVoiceId.value = tts.lucylabVoiceId || "";
  elevenlabsApiKey.value = tts.elevenlabsApiKey || "";
  elevenlabsVoiceId.value = tts.elevenlabsVoiceId || "";
  updateTtsProviderBlock();

  // Gemini
  const gemini = settings.gemini || {};
  geminiApiKey.value = gemini.apiKey || "";
  geminiImageModel.value = gemini.imageModel || "";

  // TikTok
  const tiktok = settings.tiktok || {};
  tiktokEnabled.checked = Boolean(tiktok.enabled);
  tiktokDisplayName.value = tiktok.displayName || "";
  tiktokHandle.value = tiktok.handle || "";
  tiktokFollowers.value = tiktok.followers || "";
  tiktokAvatarUrl.value = tiktok.avatarUrl || "";

  updateTiktokInputs();
  updateWatermarkPreview();
}

function readSettingsForm() {
  return {
    llm: {
      provider: llmProvider.value,
      apiKey: llmApiKey.value.trim(),
      model: llmModel.value.trim(),
      endpoint: llmEndpoint.value.trim(),
    },
    tts: {
      provider: ttsProvider.value,
      lucylabApiKey: lucylabApiKey.value.trim(),
      lucylabVoiceId: lucylabVoiceId.value.trim(),
      elevenlabsApiKey: elevenlabsApiKey.value.trim(),
      elevenlabsVoiceId: elevenlabsVoiceId.value.trim(),
    },
    gemini: {
      apiKey: geminiApiKey.value.trim(),
      imageModel: geminiImageModel.value.trim(),
    },
    tiktok: {
      enabled: tiktokEnabled.checked,
      displayName: tiktokDisplayName.value.trim(),
      handle: tiktokHandle.value.trim(),
      followers: tiktokFollowers.value.trim(),
      avatarUrl: tiktokAvatarUrl.value.trim(),
    },
  };
}

function updateTiktokInputs() {
  const disabled = !tiktokEnabled.checked;
  [tiktokDisplayName, tiktokHandle, tiktokFollowers, tiktokAvatarUrl].forEach((input) => {
    input.disabled = disabled;
  });
}


async function loadOutputs() {
  outputCount.textContent = "Loading result folders...";
  outputsList.innerHTML = "";
  try {
    const response = await fetch("/api/outputs");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to load outputs");
    state.outputs = data.outputs;
    renderOutputs();
  } catch (error) {
    outputCount.textContent = "Could not load outputs";
    outputsList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderOutputs() {
  outputCount.textContent = `${state.outputs.length} result folder${state.outputs.length === 1 ? "" : "s"} found`;
  if (state.outputs.length === 0) {
    outputsList.innerHTML = '<div class="empty-state">No result folders found under output/.</div>';
    return;
  }

  outputsList.innerHTML = state.outputs.map((item) => {
    const badges = [
      ["script", item.artifacts.scriptJson],
      ["video", item.artifacts.videoMp4],
      ["voice", item.artifacts.voiceMp3],
      ["text", item.artifacts.scriptTxt],
    ].map(([label, ok]) => `<span class="badge ${ok ? "ok" : "missing"}">${label}</span>`).join("");

    const links = [
      item.artifacts.videoMp4 ? `<a href="${item.urls.videoMp4}" target="_blank" rel="noreferrer">Video</a>` : "",
      item.artifacts.voiceMp3 ? `<a href="${item.urls.voiceMp3}" target="_blank" rel="noreferrer">Audio</a>` : "",
      item.artifacts.scriptTxt ? `<a href="${item.urls.scriptTxt}" target="_blank" rel="noreferrer">Script</a>` : "",
      item.artifacts.scriptJson ? `<a href="${item.urls.scriptJson}" target="_blank" rel="noreferrer">JSON</a>` : "",
    ].filter(Boolean).join("");

    return `
      <article class="output-card" data-output-dir="${escapeHtml(item.outputDir)}" data-script-path="${escapeHtml(item.paths.scriptJson)}">
        <div class="output-main">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.outputDir)}</p>
          <div class="badges">${badges}</div>
        </div>
        <div class="output-actions">
          <button type="button" data-action="run">Run script</button>
          <div class="links">${links}</div>
        </div>
      </article>
    `;
  }).join("");

  outputsList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".output-card");
      const selectedScriptPath = card.dataset.scriptPath;
      scriptPath.value = selectedScriptPath;
      if (button.dataset.action === "run") {
        startJob("/api/pipeline", { scriptPath: selectedScriptPath });
      }
    });
  });
}

async function startJob(endpoint, payload) {
  setJobMessage("Starting job...", "");
  artifactLinks.innerHTML = "";
  hideError();
  setBusy(true);
  renderProgress("fetch");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start job");
    connectJob(data.job);
  } catch (error) {
    setJobMessage("Failed to start", error.message);
    showError("UNKNOWN", error.message);
    setBusy(false);
  }
}

function connectJob(job) {
  state.activeJob = job;
  if (state.events) state.events.close();

  setJobMessage("running", job.logs.join("\n"));
  const events = new EventSource(`/api/jobs/${job.id}/events`);
  state.events = events;

  events.addEventListener("snapshot", (event) => {
    const snapshot = JSON.parse(event.data);
    setJobMessage(formatStatus(snapshot), snapshot.logs.join("\n"));
    if (snapshot.stage) renderProgress(snapshot.stage);
    if (snapshot.error) showError(snapshot.error.code, snapshot.error.message);
    if (snapshot.status !== "running") finishJob(snapshot);
  });

  events.addEventListener("log", (event) => {
    const { line } = JSON.parse(event.data);
    jobLog.textContent += `${line}\n`;
    jobLog.scrollTop = jobLog.scrollHeight;
  });

  events.addEventListener("progress", (event) => {
    const { stage, message } = JSON.parse(event.data);
    renderProgress(stage);
    jobLog.textContent += `> ${message}\n`;
    jobLog.scrollTop = jobLog.scrollHeight;
  });

  events.addEventListener("error", (event) => {
    const { code, message } = JSON.parse(event.data);
    showError(code, message);
  });

  events.addEventListener("status", (event) => {
    const snapshot = JSON.parse(event.data);
    finishJob(snapshot);
  });

  events.onerror = () => {
    if (state.activeJob?.status === "running") {
      jobStatus.textContent = "Log stream disconnected";
    }
  };
}

function finishJob(job) {
  state.activeJob = job;
  jobStatus.textContent = formatStatus(job);
  setBusy(false);
  if (job.status === "success") {
    hideError();
    renderProgress("complete");
  } else if (job.error) {
    showError(job.error.code, job.error.message);
  }
  if (state.events) {
    state.events.close();
    state.events = null;
  }
  renderArtifactLinks(job);
  loadOutputs();
}

function renderArtifactLinks(job) {
  const dir = job.outputDir;
  if (!dir) {
    artifactLinks.innerHTML = "";
    return;
  }
  const encoded = dir.replace(/^output\//, "").split("/").map(encodeURIComponent).join("/");
  artifactLinks.innerHTML = `
    <a href="/outputs/${encoded}/video.mp4" target="_blank" rel="noreferrer">video.mp4</a>
    <a href="/outputs/${encoded}/voice.mp3" target="_blank" rel="noreferrer">voice.mp3</a>
    <a href="/outputs/${encoded}/script.txt" target="_blank" rel="noreferrer">script.txt</a>
  `;
}

function setJobMessage(status, log) {
  jobStatus.textContent = status;
  jobLog.textContent = log ? `${log}\n` : "";
  jobLog.scrollTop = jobLog.scrollHeight;
}

function formatStatus(job) {
  const exit = job.exitCode === undefined || job.exitCode === null ? "" : `, exit ${job.exitCode}`;
  return `pipeline ${job.status}${exit}`;
}

function renderProgress(currentStage) {
  if (!currentStage) return;
  progressPanel.hidden = false;
  const visibleStage = currentStage === "setup" ? "fetch" : currentStage;
  const currentIndex = STAGES.indexOf(visibleStage);
  progressPanel.querySelectorAll(".progress-step").forEach((step) => {
    const index = STAGES.indexOf(step.dataset.stage);
    step.classList.toggle("done", currentIndex > index);
    step.classList.toggle("active", currentIndex === index);
  });
}

function showError(code, detail) {
  const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
  errorBanner.hidden = false;
  errorBanner.innerHTML = `
    <strong>${escapeHtml(message)}</strong>
    <span>${escapeHtml(detail || code || "")}</span>
  `;
}

function hideError() {
  errorBanner.hidden = true;
  errorBanner.innerHTML = "";
}

function setBusy(isBusy) {
  document.querySelectorAll("#generateForm button, #pipelineForm button, .output-actions button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

loadSettings();
loadOutputs();
setWizardStep(1);
