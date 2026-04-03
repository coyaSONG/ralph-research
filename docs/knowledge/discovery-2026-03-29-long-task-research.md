---
title: OpenAI/Anthropic long-task 연구와 프로젝트 접목점
category: discovery
status: active
date: 2026-03-29
tags: [research, anthropic, openai, autonomy, compaction]
---

# OpenAI/Anthropic long-task 연구와 프로젝트 접목점

## 핵심 발견
- METR: AI 작업 시간이 **7개월마다 2배** (2025초 1시간 → 2026말 8시간+)
- Anthropic: 사용자 경험 쌓이면 auto-approve 20% → 40%+로 증가
- OpenAI Codex: **compaction** 기법으로 context window를 넘는 장시간 작업 가능

## 접목된 기능
1. **Graduated autonomy** (v0.2) — approval_gate에서 연속 N회 accept 시 epsilon_improve로 자동 졸업
2. **Compacted history** (v0.2) — proposer에 최근 cycle 히스토리 요약 주입 (RRX_HISTORY_SUMMARY env)
3. **Parallel proposers** (v0.3) — Anthropic multi-agent research에서 영감

## 마케팅 관점
> "작업이 길어질수록 '진짜 나아졌는가'를 자동으로 검증하는 ratchet의 가치가 커진다."

## Sources
- https://www.anthropic.com/research/measuring-agent-autonomy
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://developers.openai.com/blog/run-long-horizon-tasks-with-codex
