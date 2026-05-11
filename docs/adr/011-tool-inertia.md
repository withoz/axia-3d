# ADR-011 — Tool Inertia & Predictive Tool Switch

**Status**: Proposed
**Date**: 2026-04-27
**Axis**: UX 편의성
**Related**: ADR-008 #2 (RECT = 4 LINEs), Sketch Mode (Phase 1~4)

---

## 컨텍스트

현재 도구 전환 규칙:
- `Spacebar` → cancel + Select 도구로 (SketchUp 관습)
- 단일 키 (L, R, C, P 등) → 즉시 도구 전환

문제는 **연속 작업의 마찰**이다:

```
시나리오: 벽을 5개 그리는 사용자
1. L 누름 → LINE 도구
2. 첫 번째 line 완성 → 자동으로 Select로 돌아감 (또는 LINE 유지?)
3. L 다시 누름?
```

현재 동작이 "도구 유지" / "Select로 복귀" 사이에서 도구마다 일관되지 않다. 또한 **닫힌 loop를 완성한 직후** 사용자의 다음 의도는 거의 항상 Push/Pull인데, 매번 P를 눌러야 한다.

## 결정

### 1. Tool Inertia (도구 관성)

**원칙**: 같은 도구의 연속 사용 패턴이 감지되면, 도구를 *유지*한다. 그렇지 않으면 마지막 commit 후 1.5초 idle 시 Select로 복귀.

```
규칙:
- 같은 도구로 3회 이상 연속 commit → "Inertia ON" (Esc 전까지 유지)
- 마지막 commit 후 1500ms idle → Select로 복귀 (Inertia 해제)
- Spacebar / Esc → 즉시 해제 (관성 무시)
```

### 2. Predictive Tool Switch (예측적 도구 전환)

다음 *결정적* 패턴에서 다음 도구를 **제안**한다 (자동 전환 X — 사용자 명시 동의 필수, 메타-원칙 #5):

| 트리거 | 제안 도구 | 동의 방법 |
|---|---|---|
| 닫힌 face 합성 직후 | Push/Pull | Enter 또는 P |
| Push/Pull 완료 직후 | Move | M |
| Solid 생성 직후 | Material 패널 | (모호) — 제안만 |
| Sketch Mode finish 직후 | Push/Pull (자동, 기존 동작 유지) | — |

**제안 UI**: 상태바 우측에 ghost 텍스트 `[Enter] Push/Pull`.

### 3. 명시적 동의 요구 사항

ADR-009 메타-원칙 ("명확하면 자동, 모호하면 명시 동의")을 따른다:

- **자동 (모호성 0)**: Sketch Mode에서 loop 완성 → Push/Pull (기존 동작)
- **제안만 (모호성 있음)**: 외부 모드에서 loop 완성, Material 제안 등

## 결과

**긍정**
- 반복 작업 키 입력 ~30% 감소 (내부 추정)
- 학습 곡선 완만 — "이 다음에 뭐 해야 하지?" 가시화

**부정**
- Inertia 동작이 도구마다 다르면 다시 일관성 깨짐 → **모든 도구가 동일 규칙 적용 필수**
- 1500ms idle threshold는 사용자별 차이가 있을 수 있음 → 환경설정 노출

## 환경설정

```
settings.tool_inertia.enabled       (default: true)
settings.tool_inertia.idle_ms       (default: 1500)
settings.tool_inertia.repeat_count  (default: 3)
settings.predictive_suggestion      (default: true)
```

## 검증

1. LINE 3회 연속 → 4번째도 LINE 유지
2. LINE 1회 → 1.5초 idle → Select 복귀
3. 닫힌 loop 완성 직후 Enter → Push/Pull 자동 활성
4. 모든 도구가 동일 idle 규칙 따름 (회귀 테스트)

## 대안 (Alternatives)

- **항상 도구 유지** (SketchUp 동작): Select 복귀 안 함. 학습 곡선 가파름. 기각.
- **항상 Select 복귀**: 연속 작업 마찰 ↑. 기각.
- **자동 도구 전환** (제안 X): 사용자 의도 추측은 ADR-009 #6 위반. 기각.

## 재검토 트리거 (When to Revisit)

- 사용자 테스트에서 idle threshold 가 1500ms 와 다른 분포 (예: 95% 가 800~3000ms 밖)
- Predictive suggestion 수락률이 30% 미만 (제안 가치 부족)
- Inertia ON 상태 진입 후 평균 commit 횟수 가 4회 미만 (감지가 부정확)

## 관련 기록 (Related)

- ADR-008 #2, #8 — RECT/CIRCLE 의 epoch / undo 연결
- Sketch Mode Phase 1~4 — finish→Push/Pull 자동 전환은 이미 구현됨
- 메타-원칙 #1, #5, #11 (idle 전환은 budget 안에서)

## 메타-원칙 매핑

- #5 사용자 편의 최우선
- #1 기존 명령은 모두 그대로 — 추가/제거 ZERO (도구 자체 변경 없음, *전환 규칙*만 추가)
