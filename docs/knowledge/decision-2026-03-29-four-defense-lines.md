---
title: 4대 방어선 설계
category: decision
status: active
date: 2026-03-29
tags: [architecture, safety, ratchet, trust]
---

# 4대 방어선 설계

## Context
Codex 에이전트의 blind spot 분석에서 "v0.1 실패 원인은 기능 부족이 아니라 accept/reject를 믿을 수 없는 것"이라는 지적이 나옴. 14일 MVP 계획에 4가지 필수 방어선을 녹이기로 결정.

## Decision
1. **Transaction safety** (Day 4) — recoverable state machine, phase별 idempotent 전이, crash 후 resume
2. **Bounded change** (Day 6) — scope.allowedGlobs, maxFilesChanged, maxLineDelta 검사, 초과 시 reject
3. **Trusted signal** (Day 7) — pairwise judge, anchor agreement, low-confidence human gate, audit sampling
4. **Explainability** (Day 9) — inspect에서 decision reason + judge rationale + metric delta + diff summary 한 화면

## Impact
- 각 방어선이 없으면 "두 번째로 쓰고 싶지 않은 도구"가 됨
- 기능 수를 줄이더라도 이 4개는 반드시 포함
- general/code template 대신 writing-only로 범위를 좁힌 것도 이 방어선 때문
