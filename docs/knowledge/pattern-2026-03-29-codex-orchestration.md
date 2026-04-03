---
title: Claude Code 오케스트레이션 + Codex 구현 패턴
category: pattern
status: active
date: 2026-03-29
tags: [workflow, codex, claude-code, tmux, orchestration]
---

# Claude Code 오케스트레이션 + Codex 구현 패턴

이 프로젝트는 Claude Code가 오케스트레이터, Codex CLI가 구현자 역할을 하는 패턴으로 만들어짐.

## 워크플로우
1. Claude Code가 사용자와 대화하며 요구사항 파악
2. tmux pane의 Codex에게 구체적 작업 지시 (Day별 목표, 통과 기준 명시)
3. 1분 간격 /loop로 Codex 진행 모니터링 (tmux capture-pane)
4. 작업 완료 시 Claude Code가 simplify skill로 리팩토링 체크
5. 다음 Day 지시 → 반복

## 효과적이었던 것
- Day별 명확한 목표 + 통과 기준 (npm test + typecheck)
- Codex가 자체적으로 typecheck 에러를 발견하고 수정하는 능력
- context compaction이 자동으로 일어나 장시간 작업 가능

## 주의점
- Codex 에이전트 컨텍스트는 모니터링 필요 (50% 이하면 범위 좁히기)
- 대규모 파일 작성 시 디스크 반영까지 1-2분 걸림 — 조급하게 재지시하지 말 것
- Codex가 분석에 시간을 많이 쓰는 것은 정상 — 복잡한 조립일수록 분석이 길어짐
