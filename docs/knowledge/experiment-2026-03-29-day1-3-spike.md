---
title: Day 1-3 핵심 가정 검증 spike
category: experiment
status: active
date: 2026-03-29
tags: [spike, validation, judge, bounded-patch, cross-domain]
---

# Day 1-3 핵심 가정 검증 spike

## Context
14일 MVP 구현 전에 "이 가정이 틀리면 프로젝트 방향을 바꿔야 한다" 수준의 3가지 핵심 가정을 코드로 검증.

## Results

### Day 1: LLM judge 신뢰성
- codex exec + gpt-5.4-mini, 8-way 병렬, 50회 평가
- human label agreement: **100%**, winner stability: **100%**, 77초
- anchor pair가 "명백한" 차이로 설계되어 100%가 나옴 — 미묘한 차이에서는 다를 수 있음

### Day 2: bounded patch 유효성
- 10개 후보 중 **2개** baseline 5/5 만장일치 승리
- restructure_outline(4개) 전부 탈락, compress_redundancy + strengthen_claim_evidence에서 승자
- 작은 변경(2줄)이 가장 효과적 — bounded patch 유효함 증명

### Day 3: cross-domain 추상화
- 같은 runner + manifest만 교체로 writing + code fixture 모두 동작
- writing: pairwise judge 3/3 accepted, code: pytest 0→2 passed accepted
- 53.82초, 5분 이내 기준 충족

## Impact
- 3가지 모두 통과 → 피벗 불필요, 14일 MVP 착수
- spike 결과는 spike/ 디렉토리에 보존됨
