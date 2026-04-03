---
title: TypeScript 구현 스택 선택
category: decision
status: active
date: 2026-03-29
tags: [stack, typescript, tooling]
---

# TypeScript 구현 스택 선택

## Context
1인 2주 MVP 제약 하에서 구현 언어를 선택해야 했다.

## Considered Options
1. **Python** — ML 생태계 친화, uv/typer/pydantic. 사용자를 ML 연구자로 상정하면 좋음
2. **TypeScript** — CLI+MCP+schema를 한 코드베이스, npm 배포 자연스러움
3. **Go** — 단일 바이너리, 운영 안정성. 2주 MVP에는 과함
4. **Rust** — 장기적으로 단단하지만 1인 2주에 명백히 느림

## Decision
TypeScript. 스택: commander + zod + yaml + execa + pino + @modelcontextprotocol/sdk + vitest

## Impact
- npx 배포가 첫 진입점 (`npx ralph-research demo writing`)
- 실험 대상 언어와 오케스트레이션 언어 분리 — 코어는 TS, 실험은 Python/쉘/노트북 호출
- strict mode + exactOptionalPropertyTypes로 타입 안전성 확보
