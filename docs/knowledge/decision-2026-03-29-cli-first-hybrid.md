---
title: CLI-first hybrid 아키텍처 선택
category: decision
status: active
date: 2026-03-29
tags: [architecture, cli, mcp, skill]
---

# CLI-first hybrid 아키텍처 선택

## Context
AutoResearch + Ralph Loop 융합 플랫폼을 어떤 형태로 배포할지 결정이 필요했다. Codex 에이전트와 8라운드 깊은 토론을 거쳐 결론을 냈다.

## Considered Options
1. **Agent Skill only** — 빠른 확산, 하지만 ratchet 강제가 프롬프트 수준이라 깨지기 쉬움
2. **MCP Server only** — 에이전트 독립적이지만 low-level tool만으로는 "연구 루프"를 못 봄
3. **CLI tool** — 로컬 repo/git/파일에 강하고 brownfield 친화적
4. **Boilerplate/Template** — Day 0 경험은 좋지만 Day 30에 힘을 못 씀
5. **CLI-first hybrid** — CLI 코어 + MCP + Skill + Template 조합

## Decision
CLI-first hybrid. 역할 분담:
- CLI = 실행 엔진 (ratchet 강제를 코드로)
- MCP = 상호운용 인터페이스
- Skill = 에이전트별 UX 어댑터
- Template = 도메인별 부트스트랩

## Impact
- 정책 강제는 프롬프트가 아니라 코드에서 이뤄짐
- npx 배포가 첫 진입점
- MCP는 thin wrapper로 같은 service layer를 공유
