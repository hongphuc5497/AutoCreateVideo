---
name: create-news-video
description: Tạo video tin tức ngắn 9:16 (~60s) từ URL bài báo hoặc file .txt tiếng Việt. Trigger khi user yêu cầu tạo video tin tức, làm short news, làm bản tin video, render tin thành video, làm TikTok tin tức. Output: video.mp4 + voice.mp3 + script.txt cho CapCut.
---

# Create News Video Skill

This skill automates the creation of a 9:16 short news video from a Vietnamese article URL or local text file.

## Source of Truth Instruction
You MUST read and follow the authoritative rules, workflow steps, phonetic guidelines, template constraints, sound effect picking rules, and script schema examples defined in the **[CONTEXT.md](file:///Users/hongphuc/repos/AutoCreateVideo/CONTEXT.md)** file at the root of this repository.

Ensure that:
1. You identify URL vs local file mode correctly.
2. You fetch content and build the output directory under `output/<slug>-<timestamp>/`.
3. You generate `script.json` following the 6 active templates (`hook`, `comparison`, `stat-hero`, `feature-list`, `callout`, `outro`) exactly as detailed in the `Template Constraints` section of `CONTEXT.md`.
4. You adhere to the **Vietnamese TTS Phonetic Rules** in `CONTEXT.md` for the `voiceText` field, spelling out all numbers, decimal points, percentages, spec units, and currencies phonetically in Vietnamese.
5. You validate your JSON payload structure before writing it to `<outputDir>/script.json`.
6. You run `npm run pipeline -- <outputDir>/script.json` synchronously in the foreground.
7. You report success to the user with standard links to `video.mp4`, `voice.mp3`, and `script.txt`.
