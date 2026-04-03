# Project Knowledge Index

## Decisions
- [CLI-first hybrid 아키텍처 선택](decision-2026-03-29-cli-first-hybrid.md) — CLI 코어 + MCP + Skill + Template 조합 `architecture, cli, mcp`
- [4대 방어선 설계](decision-2026-03-29-four-defense-lines.md) — transaction safety, bounded change, trusted signal, explainability `architecture, safety, ratchet`
- [TypeScript 구현 스택 선택](decision-2026-03-29-typescript-stack.md) — commander + zod + yaml + execa + vitest `stack, typescript`

## Experiments
- [Day 1-3 핵심 가정 검증 spike](experiment-2026-03-29-day1-3-spike.md) — judge 100%, bounded patch 2/10 accepted, cross-domain 54초 `spike, validation`

## Discoveries
- [OpenAI/Anthropic long-task 연구 접목](discovery-2026-03-29-long-task-research.md) — graduated autonomy, compacted history, parallel proposers `research, anthropic, openai`

## Gotchas
- [scope glob이 좁으면 첫 run이 reject됨](gotcha-2026-03-29-scope-glob-rejection.md) — `**/*.md` 사용, maxLineDelta 넉넉하게 `scope, glob, debugging`

## Patterns
- [Claude Code 오케스트레이션 + Codex 구현](pattern-2026-03-29-codex-orchestration.md) — 1분 루프 모니터링 + simplify 체크 + Day별 지시 `workflow, codex, tmux`
