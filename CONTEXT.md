# CONTEXT — Auto News Video (Source of Truth)

This document is the absolute source of truth for the `AutoCreateVideo` project, defining specifications, validation rules, design contracts, and the orchestrating workflow. All documentation (including `README.md` and `.claude/skills/create-news-video/SKILL.md`) and implementation details must align with this file.

## Glossary

**script.json** — The contract between Claude Code (skill) and the Node CLI (pipeline). Claude writes it, the CLI validates it with Zod, then renders a video from it. Contains metadata, voice config, and an array of scenes.

**templateData** — The content payload Claude provides per scene, discriminated by `template` field. Claude picks the template type (creative decision) and fills in the fields (content). The CLI reads `templateData` to compose HTML. NOT the same as `visual` (a stale term from the April 2026 design spec that never shipped in this form).

**Scene** — One segment of the video. Has `id`, `type` (hook|body|outro), `voiceText` (Vietnamese, TTS-safe), `templateData` (the chosen template + content), and optional `sfx` override.

**Skill** — A Claude Code slash command (`.claude/skills/create-news-video/SKILL.md`) that orchestrates: fetch content → analyze → write script.json → run pipeline. The "creative" half of the architecture.

**Pipeline** — The deterministic Node/TS half (`src/pipeline.ts`): validate script.json → TTS per scene → concat voice with SFX → compose HTML → render with HyperFrames → output video.mp4. Same input always produces identical frames.

**voiceText** — Per-scene Vietnamese text for TTS. Dual role: (1) fed verbatim to LucyLab/ElevenLabs for speech synthesis — numbers MUST be spelled out phonetically ("năm phần trăm" not "5%"), and (2) scanned by the 3-tier SFX picker for semantic keywords to auto-select sound effects. This coupling is intentional — news writing naturally uses emotional language that maps to SFX categories.

**SFX picker** — 3-tier per-scene sound effect selection: (1) explicit `scene.sfx` override, (2) semantic keyword match on `voiceText` (Vietnamese + English), (3) template default category. Within a category, files are picked deterministically by hashing `scene.id`. Anti-repetition window (last 2 scenes) prevents back-to-back duplicates.

**Channel** — The brand identity: "Công nghệ 24h". Appears on the outro card and can be customized via `metadata.channel`.

**Doc maintenance** — `CONTEXT.md` is the authoritative document. When code, skill files, or design specs diverge, `CONTEXT.md` wins — update it first, then align other files to match.

**Template selection** — Claude picks templates per scene based on content signals, not randomly. Hook always first, outro always last. Body templates match the story beat: a stat → `stat-hero`, a comparison → `comparison`, a list → `feature-list`, a warning → `callout`. Following content signals naturally produces variety — no mechanical "don't repeat" rule needed.

**Template count** — 6 templates are implemented (hook, comparison, stat-hero, feature-list, callout, outro). README lists 6 more (quote-card, icon-grid, timeline, big-text, chart-bars, kinetic-quote) — these are documented aspirations, planned for future implementation. Active generation skills should only reference the 6 that actually render.

**Dashboard** — The web UI + HTTP server at `localhost:4317` (`src/server.ts` + `src/ui/`). Browses outputs, triggers video generation from an article URL, streams job progress via SSE. The third architectural component alongside Skill and Pipeline.

**Job** — An async process kicked off by the dashboard. Has an id, status (`running` | `success` | `failed`), logs, and an SSE event stream. Only one job runs at a time (V1). A pipeline job runs the full generate+render flow; a generate job produces script.json via LLM first, then chains into pipeline.

**Generate** — The LLM-powered step that turns an article URL into `script.json`. The creative half (formerly exclusive to the Skill slash command), now callable from the dashboard via `POST /api/generate`. The server reads SKILL.md as the system prompt and provides a `web_fetch` tool so the LLM can fetch the article. Supports Anthropic, OpenAI, and DeepSeek providers via `LLM_PROVIDER` env var.

---

## Input Specifications

- **URL Mode**: Starts with `http://` or `https://`. The content should be fetched from the remote site.
- **File Mode**: Local path to a `.txt` or `.md` file. Title is derived from the first non-empty line (max 80 characters). The remaining lines serve as the content. `ogImage` is set to `null` and `domain` to `"local"`.

---

## Detailed Step-by-Step Pipeline Workflow

1. **Detect Input Type**: Determine if the argument is a URL or a local file path.
2. **Fetch Content**:
   - For URLs: Fetch the page and extract the `title`, `content` (~500–1500 words), `ogImage` URL, and `domain`. If fetching fails due to paywalls, JavaScript rendering, or HTTP errors, instruct the user to save the content locally to a `.txt` file and run it in file mode.
   - For local files: Read the file path using standard filesystem tools.
3. **Create Output Directory**:
   - `slug` = lowercase ASCII (stripping Vietnamese diacritics, đ/Đ -> d/D), non-alphanumeric replaced with `-`, trimmed dashes, max 40 characters.
   - `timestamp` = current local time formatted as `YYYYMMDD-HHmm`.
   - `outputDir` = `output/<slug>-<timestamp>/`.
4. **Generate script.json**: Generate the structured script matching the Zod schema in `src/render/script-schema.ts`.
5. **Self-Validate**: Check schema structures, scene types (first must be hook, last must be outro), total script length (~150-200 words, 5-8 scenes), and phonetic rules. Correct errors silently.
6. **Write script.json**: Save the resulting script to `<outputDir>/script.json`.
7. **Run Pipeline**: Run `npm run pipeline -- <outputDir>/script.json` synchronously in the foreground.
8. **Report Success**: Return absolute or relative markdown links to `video.mp4`, `voice.mp3` (for CapCut editing), and `script.txt` (for CapCut auto-captioning), as well as the computed video duration.

---

## Vietnamese TTS Phonetic Rules

The `voiceText` field is spoken by the LucyLab/ElevenLabs Vietnamese TTS engine. **Numbers and symbols must be spelled out phonetically in Vietnamese** to avoid bad intonation or literal interpretation errors by the model. 

The `templateData` fields (which appear visually on the screen) must retain standard user-friendly formatting (e.g. "82.7%", "5000mAh", "$5").

| Visual Form (templateData) | Spoken Form (voiceText phonetic rules) | Explanation / Notes |
|---|---|---|
| `GPT 5.5` | `GPT năm chấm năm` | Use `chấm` or `phẩy` for decimal points. |
| `82.7%` | `tám mươi hai phẩy bảy phần trăm` | Spell out decimals and percentage signs. |
| `iPhone 17` | `iPhone mười bảy` | Whole numbers must be spelled out. |
| `iOS 18.2` | `iOS mười tám chấm hai` | Complex version numbers spelled with `chấm`. |
| `200MP` | `hai trăm megapixel` | Spell out units. |
| `5000mAh` | `năm nghìn miliampe giờ` | Spell out units. |
| `1M tokens` | `một triệu token` | Spell out unit multipliers. |
| `21 triệu đồng` | `hai mươi mốt triệu đồng` | Ensure currency units are fully spelled out. |
| `$5` | `năm đô la` or `năm đô` | Never use `$` in voiceText. |
| `2x` | `gấp đôi` | Multipliers should use spoken form. |
| `2026` | `năm hai nghìn không trăm hai mươi sáu` | Years should be spelled out naturally. |
| `60 giây` | `sáu mươi giây` | Time durations should be spelled out. |
| `5G` | `năm gờ` | Spell out tech acronyms. |

### Additional Rules for voiceText
- **English Brand Names**: Keep standard spellings (`Apple`, `Google`, `OpenAI`, `Microsoft`, `TikTok`, `YouTube`), which are natively understood.
- **English Acronyms**: Spell phonetically if TTS misreads them (e.g. `AI` -> `ây ai`, `API` -> `ây pi ai`, `GPT` -> `gí pi tí`, `iOS` -> `ai ô ét`).
- **Symbols to AVOID**: Never include `→`, `&`, `%`, `$`, `#`, `+`, `=`, or emoji. They cause unpredictable speech rendering.
- **Intonation**: End every sentence in `voiceText` with `.` or `?` to enforce natural pauses.

---

## Template Constraints & Visual System

Every video uses a persistent background layout (header icon, channel tag, grain overlay, TikTok handle) with **5 to 8 scenes** (1 hook, 3–6 body scenes, 1 outro).

The 6 supported and active templates are:

| Template | When to use | Required fields in `templateData` |
|---|---|---|
| `hook` | First scene (3-5s). Gets viewer attention. | `headline` (max 40), `subhead` (max 40, optional), `bgSrc` (optional), `kenBurns` (default `zoom-in`, enum: `zoom-in`, `zoom-out`, `pan-left`, `pan-right`). |
| `comparison` | Content contains comparisons (e.g. X vs Y). | `left` and `right` sides with `label` (max 30), `value` (max 20), and `color` (`cyan` or `purple`). `right` can specify `winner` (boolean). |
| `stat-hero` | Shows a single giant metric or percentage. | `value` (max 20), `label` (max 40), `context` (max 50, optional). |
| `feature-list` | Listing items or steps (1-4 items). | `title` (max 40), `bullets` (array of string, max 50 chars each, length 1-4), `icon` (optional). |
| `callout` | Statement, pull-quote, or critical warning. | `statement` (max 80), `tag` (max 20, optional). |
| `outro` | Final scene (3-5s) with TikTok/social CTA. | `ctaTop` (max 30), `channelName` (max 30), `source` (max 40). |

---

## Sound Effects (SFX) System

The pipeline auto-mixes sound effects dynamically. The **SFX picker** follows a 3-tier resolution chain:

1. **Explicit Override**: If `scene.sfx` is specified in `script.json`, it resolves to that file (under `assets/sfx/`). Set `sfx.name = "none"` to disable sound effects for a scene.
2. **Semantic Keyword Match**: If no override exists, the picker scans `voiceText` for keyword matches:
   - `cảnh báo` / `rủi ro` / `nguy hiểm` / `warning` -> `alert/`
   - `kỷ lục` / `vượt` / `xuất sắc` / `breakthrough` / `success` -> `success/`
   - `thất bại` / `sai` / `lỗi` / `fail` / `wrong` -> `fail/`
   - `ra mắt` / `công bố` / `lần đầu` / `launch` / `unveil` -> `reveal/`
   - `đếm ngược` / `tích tắc` / `countdown` -> `countdown/`
   - `hùng vĩ` / `hoành tráng` / `cinematic` / `epic` -> `cinematic/`
   - `hồi hộp` / `chờ đợi` / `drumroll` / `suspense` -> `drumroll/`
3. **Template Default Category**: Fallback category by template:
   - `hook` -> `transition/` or `cinematic/` (default: `transition/whoosh-soft`)
   - `comparison` -> `transition/` or `emphasis/` (default: `transition/swoosh`)
   - `stat-hero` -> `emphasis/` or `success/` (default: `emphasis/ding`)
   - `feature-list` -> `transition/` or `emphasis/` (default: `transition/pop`)
   - `callout` -> `alert/` or `drumroll/` (default: `alert/notification`)
   - `outro` -> `outro/` or `success/` (default: `outro/tada`)

### Override syntax in script.json:
```json
{
  "id": "body-3",
  "type": "body",
  "voiceText": "...",
  "templateData": { ... },
  "sfx": {
    "name": "success/xbox-360-achievement-sound",
    "volume": 0.4,
    "startOffsetSec": 0.2
  }
}
```
*Note: Refer to sound effects without the `.mp3` extension.*

---

## Edge Case Handling

- **Paywalls or JS-heavy sites**: If `WebFetch` returns an empty string or fails, notify the user immediately and suggest saving the text locally for File Mode processing.
- **Short text**: If the source has less than 200 words, print a warning but continue.
- **Long text**: If the source exceeds 2000 words, summarize it aggressively down to ~150-200 script words.
- **Pipeline Failure**: Report errors clearly and output the directory path to let the user inspect generated JSON, layouts, and assets.

---

## Schema Examples

### Example 1: Web URL Mode with image
```json
{
  "version": "1.0",
  "metadata": {
    "title": "Apple ra mắt iPhone 17 với camera 200MP",
    "source": {
      "url": "https://vnexpress.net/iphone-17-200mp",
      "domain": "vnexpress.net",
      "image": "https://i1-vnexpress.vnecdn.net/iphone17.jpg"
    },
    "channel": "Công nghệ 24h"
  },
  "voice": { "provider": "lucylab", "voiceId": "${VIETNAMESE_VOICEID}", "speed": 1.0 },
  "scenes": [
    {
      "id": "hook", "type": "hook",
      "voiceText": "Apple vừa ra mắt iPhone mười bảy với camera hai trăm megapixel.",
      "templateData": {
        "template": "hook",
        "headline": "iPhone 17",
        "subhead": "Camera 200MP!",
        "bgSrc": "$source.image",
        "kenBurns": "zoom-in"
      },
      "sfx": { "name": "cinematic/impact", "volume": 0.5 }
    },
    {
      "id": "body-1", "type": "body",
      "voiceText": "Cảm biến hoàn toàn mới cho zoom quang học gấp mười lần, vượt mọi đối thủ Android.",
      "templateData": {
        "template": "stat-hero",
        "value": "200MP",
        "label": "Cảm biến mới",
        "context": "Zoom quang học 10x"
      }
    },
    {
      "id": "body-2", "type": "body",
      "voiceText": "Pin năm nghìn miliampe giờ, tăng ba mươi phần trăm so với đời cũ. Sạc nhanh sáu mươi lăm watt.",
      "templateData": {
        "template": "feature-list",
        "title": "Nâng cấp lớn",
        "bullets": ["Pin 5000mAh", "Tăng 30%", "Sạc nhanh 65W"],
        "icon": "spark"
      }
    },
    {
      "id": "body-3", "type": "body",
      "voiceText": "Giá khởi điểm hai mươi mốt triệu đồng, dự kiến mở bán tại Việt Nam vào tháng sau.",
      "templateData": {
        "template": "callout",
        "statement": "Giá từ 21 triệu đồng, mở bán tháng 5.",
        "tag": "Giá bán"
      }
    },
    {
      "id": "outro", "type": "outro",
      "voiceText": "Theo dõi Công nghệ 24h để xem bản tin mới mỗi ngày.",
      "templateData": {
        "template": "outro",
        "ctaTop": "Theo dõi ngay",
        "channelName": "Công nghệ 24h",
        "source": "vnexpress.net"
      }
    }
  ]
}
```

### Example 2: Local File Mode with no image
```json
{
  "version": "1.0",
  "metadata": {
    "title": "OpenAI công bố mô hình mới với khả năng lập luận",
    "source": { "url": "local", "domain": "local", "image": null },
    "channel": "Công nghệ 24h"
  },
  "voice": { "provider": "lucylab", "voiceId": "${VIETNAMESE_VOICEID}", "speed": 1.0 },
  "scenes": [
    {
      "id": "hook", "type": "hook",
      "voiceText": "OpenAI vừa công bố mô hình mới có khả năng lập luận như con người.",
      "templateData": {
        "template": "hook",
        "headline": "Mô hình mới",
        "subhead": "Lập luận như người"
      }
    },
    {
      "id": "body-1", "type": "body",
      "voiceText": "Mô hình đạt chín mươi hai phẩy bảy phần trăm trên benchmark, vượt xa phiên bản cũ.",
      "templateData": {
        "template": "stat-hero",
        "value": "92.7%",
        "label": "Benchmark",
        "context": "Vượt phiên bản cũ 75.1%"
      }
    },
    {
      "id": "body-2", "type": "body",
      "voiceText": "Hệ thống có thể tự suy luận đa bước, kiểm tra logic và sửa sai trước khi trả lời.",
      "templateData": {
        "template": "feature-list",
        "title": "Khả năng mới",
        "bullets": ["Suy luận đa bước", "Tự kiểm tra logic", "Tự sửa lỗi"]
      }
    },
    {
      "id": "outro", "type": "outro",
      "voiceText": "Theo dõi Công nghệ 24h để xem bản tin mới mỗi ngày.",
      "templateData": {
        "template": "outro",
        "ctaTop": "Xem bản tin mới mỗi ngày",
        "channelName": "Công nghệ 24h",
        "source": "local"
      }
    }
  ]
}
```
