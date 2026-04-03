---
title: scope glob이 좁으면 첫 run이 무조건 reject됨
category: gotcha
status: active
date: 2026-03-29
tags: [scope, glob, rrx-run, debugging]
---

# scope glob이 좁으면 첫 run이 무조건 reject됨

## Symptom
`rrx run` 첫 실행이 rejected — 변경 내용은 정상인데 scope 위반으로 거부됨.

## Root Cause
- `docs/**/*.md`는 `docs/draft.md`를 매칭하지 않음 — `**`는 디렉토리 구분자를 기대
- `maxLineDelta: 40`으로 설정하면 구조적 변경(섹션 추가, 리스트→테이블 변환)이 거의 항상 초과

## Fix / Workaround
- glob은 넓게: `**/*.md` 사용
- maxLineDelta는 넉넉하게 시작 (100-200), inspect로 실제 delta 확인 후 조임
- 항상 `rrx validate` 먼저 실행해서 manifest 오류 확인
