# Changelog

## [2.0.1] - 2026-05-20

### Added
- Web UI dashboard accessible at `http://localhost:4317` — paste a news URL and generate videos from the browser
- Real-time job progress via Server-Sent Events (SSE) — see pipeline stages live as they run
- LLM provider abstraction supporting Anthropic, OpenAI-compatible, and DeepSeek backends via `LLM_PROVIDER` env var
- Article content web fetcher with HTML extraction and og:image detection
- TikTok UI settings panel — configure avatar, handle, and follower count; settings persist across restarts
- Output listing API with artifact badges (script, video, voice, text) and download links

### Changed
- Pipeline now respects `TIKTOK_ENABLED` toggle — disables TikTok card rendering and avatar fetching when off
- Config supports `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, and `LLM_ENDPOINT` environment variables
- Script schema upgraded to discriminated union templates (6 types: hook, comparison, stat-hero, feature-list, callout, outro)
- HTML composer conditionally renders TikTok handle and outro card based on settings
