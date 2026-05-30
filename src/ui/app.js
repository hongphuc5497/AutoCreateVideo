const state = {
  outputs: [],
  events: null,
  activeJob: null,
  demoMode: false,
};

const $ = (selector) => document.querySelector(selector);
const scriptPathname = new URL(document.currentScript?.src || window.location.href).pathname;
const PUBLIC_BASE_PATH = scriptPathname.endsWith("/app.js")
  ? scriptPathname.slice(0, -"/app.js".length)
  : "";

function appPath(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${PUBLIC_BASE_PATH}${normalized}`;
}

const outputsList = $("#outputsList");
const outputCount = $("#outputCount");
const articleUrl = $("#articleUrl");
const scriptPath = $("#scriptPath");
const jobLog = $("#jobLog");
const jobStatus = $("#jobStatus");
const artifactLinks = $("#artifactLinks");
const settingsStatus = $("#settingsStatus");
const tiktokEnabled = $("#tiktokEnabled");
const tiktokDisplayName = $("#tiktokDisplayName");
const tiktokHandle = $("#tiktokHandle");
const tiktokFollowers = $("#tiktokFollowers");
const tiktokAvatarUrl = $("#tiktokAvatarUrl");

$("#refreshOutputs").addEventListener("click", loadOutputs);

$("#generateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  startJob(appPath("/api/generate"), { url: articleUrl.value.trim() });
});

$("#pipelineForm").addEventListener("submit", (event) => {
  event.preventDefault();
  startJob(appPath("/api/pipeline"), { scriptPath: scriptPath.value.trim() });
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings();
});

tiktokEnabled.addEventListener("change", updateTiktokInputs);

async function loadSettings() {
  settingsStatus.textContent = "Loading settings...";
  try {
    const response = await fetch(appPath("/api/settings"));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to load settings");
    state.demoMode = Boolean(data.demoMode);
    applySettings(data.settings);
    applyDemoMode();
    settingsStatus.textContent = state.demoMode ? "Public demo mode: settings are read-only" : "Settings ready";
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

async function saveSettings() {
  if (state.demoMode) {
    settingsStatus.textContent = "Public demo mode: settings are read-only";
    return false;
  }
  settingsStatus.textContent = "Saving settings...";
  try {
    const response = await fetch(appPath("/api/settings"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readSettingsForm()),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to save settings");
    applySettings(data.settings);
    settingsStatus.textContent = "Settings saved";
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

function applyDemoMode() {
  if (!state.demoMode) return;
  document
    .querySelectorAll("#settingsForm input, #settingsForm select, #generateForm input, #pipelineForm input")
    .forEach((field) => {
      field.disabled = true;
    });
  document
    .querySelectorAll("#settingsForm button, #generateForm button, #pipelineForm button")
    .forEach((button) => {
      button.disabled = true;
    });
}

function applySettings(settings) {
  const tiktok = settings.tiktok;
  tiktokEnabled.checked = Boolean(tiktok.enabled);
  tiktokDisplayName.value = tiktok.displayName || "";
  tiktokHandle.value = tiktok.handle || "";
  tiktokFollowers.value = tiktok.followers || "";
  tiktokAvatarUrl.value = tiktok.avatarUrl || "";
  updateTiktokInputs();
}

function readSettingsForm() {
  return {
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
    const response = await fetch(appPath("/api/outputs"));
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
          <button type="button" data-action="run" ${state.demoMode ? "disabled" : ""}>Run script</button>
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
        startJob(appPath("/api/pipeline"), { scriptPath: selectedScriptPath });
      }
    });
  });
}

async function startJob(endpoint, payload) {
  setJobMessage("Starting job...", "");
  artifactLinks.innerHTML = "";

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
  }
}

function connectJob(job) {
  state.activeJob = job;
  if (state.events) state.events.close();

  setJobMessage("running", job.logs.join("\n"));
  const events = new EventSource(appPath(`/api/jobs/${job.id}/events`));
  state.events = events;

  events.addEventListener("snapshot", (event) => {
    const snapshot = JSON.parse(event.data);
    setJobMessage(formatStatus(snapshot), snapshot.logs.join("\n"));
    if (snapshot.status !== "running") finishJob(snapshot);
  });

  events.addEventListener("log", (event) => {
    const { line } = JSON.parse(event.data);
    jobLog.textContent += `${line}\n`;
    jobLog.scrollTop = jobLog.scrollHeight;
  });

  events.addEventListener("progress", (event) => {
    const { message } = JSON.parse(event.data);
    jobLog.textContent += `> ${message}\n`;
    jobLog.scrollTop = jobLog.scrollHeight;
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
    <a href="${appPath(`/outputs/${encoded}/video.mp4`)}" target="_blank" rel="noreferrer">video.mp4</a>
    <a href="${appPath(`/outputs/${encoded}/voice.mp3`)}" target="_blank" rel="noreferrer">voice.mp3</a>
    <a href="${appPath(`/outputs/${encoded}/script.txt`)}" target="_blank" rel="noreferrer">script.txt</a>
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
    button.disabled = state.demoMode || isBusy;
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
