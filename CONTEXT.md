# CONTEXT — Auto News Video

## Glossary

**script.json** — The contract between Claude Code (skill) and the Node CLI (pipeline). Claude writes it, the CLI validates it with Zod, then renders a video from it. Contains metadata, voice config, and an array of scenes.

**templateData** — The content payload Claude provides per scene, discriminated by `template` field. Claude picks the template type (creative decision) and fills in the fields (content). The CLI reads `templateData` to compose HTML. NOT the same as `visual` (a stale term from the April 2026 design spec that never shipped in this form).

**Scene** — One segment of the video. Has `id`, `type` (hook|body|outro), `voiceText` (Vietnamese, TTS-safe), `templateData` (the chosen template + content), and optional `sfx` override.

**Skill** — A Claude Code slash command (`.claude/skills/create-news-video/SKILL.md`) that orchestrates: fetch content → analyze → write script.json → run pipeline. The "creative" half of the architecture.

**Pipeline** — The deterministic Node/TS half (`src/pipeline.ts`): validate script.json → TTS per scene → concat voice with SFX → compose HTML → render with HyperFrames → output video.mp4. Same input always produces identical frames.

**voiceText** — Per-scene Vietnamese text for TTS. Dual role: (1) fed verbatim to LucyLab/ElevenLabs for speech synthesis — numbers MUST be spelled out phonetically ("năm phần trăm" not "5%"), and (2) scanned by the 3-tier SFX picker for semantic keywords to auto-select sound effects. This coupling is intentional — news writing naturally uses emotional language that maps to SFX categories.

**SFX picker** — 3-tier per-scene sound effect selection: (1) explicit `scene.sfx` override, (2) semantic keyword match on `voiceText` (Vietnamese + English), (3) template default category. Within a category, files are picked deterministically by hashing `scene.id`. Anti-repetition window (last 2 scenes) prevents back-to-back duplicates.

**Channel** — The brand identity: "Công nghệ 24h". Appears on the outro card and can be customized via `metadata.channel`.

**Doc maintenance** — SKILL.md is the authoritative document (it's what Claude reads). The design spec (`docs/superpowers/specs/`) is a pre-implementation artifact and may drift. Code is the implementation but the skill file defines the contract Claude follows. When they diverge, SKILL.md wins — update it first, then align code to match.

**Template selection** — Claude picks templates per scene based on content signals (the "When it's picked" column in README), not randomly. Hook always first, outro always last. Body templates match the story beat: a stat → `stat-hero`, a comparison → `comparison`, a list → `feature-list`, a warning → `callout`. Following content signals naturally produces variety — no mechanical "don't repeat" rule needed.

**Template count** — 6 templates are implemented (hook, comparison, stat-hero, feature-list, callout, outro). README lists 6 more (quote-card, icon-grid, timeline, big-text, chart-bars, kinetic-quote) — these are documented aspirations, planned for future implementation. SKILL.md should only reference the 6 that actually render.

**Dashboard** — The web UI + HTTP server at `localhost:4317` (`src/server.ts` + `src/ui/`). Browses outputs, triggers video generation from an article URL, streams job progress via SSE. The third architectural component alongside Skill and Pipeline.

**Job** — An async process kicked off by the dashboard. Has an id, status (`running` | `success` | `failed`), logs, and an SSE event stream. Only one job runs at a time (V1). A pipeline job runs the full generate+render flow; a generate job produces script.json via LLM first, then chains into pipeline.

**Generate** — The LLM-powered step that turns an article URL into `script.json`. The creative half (formerly exclusive to the Skill slash command), now callable from the dashboard via `POST /api/generate`. The server reads SKILL.md as the system prompt and provides a `web_fetch` tool so the LLM can fetch the article. Supports Anthropic, OpenAI, and DeepSeek providers via `LLM_PROVIDER` env var.

