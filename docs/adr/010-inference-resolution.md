# ADR-010 — Inference Resolution Table (스냅 충돌 해결 정책)

**Status**: Proposed
**Date**: 2026-04-27
**Axis**: UX 편의성
**Related**: ADR-007 (Face Orientation), ADR-008 (Face Axioms), 기존 SnapManager

---

## 컨텍스트

현재 `SnapManager.findSnap()`은 다음 스코어링을 사용한다:

```
score = priority × 1000 - pixel_distance
recency_bonus = (last_hover_type == this.type && Δt < 400ms) ? -0.5 : 0
```

이 식은 *대부분의 경우* 잘 동작하지만, 다음 상황에서 **deterministic하지 않다**:

1. 두 endpoint가 같은 픽셀에 겹쳐 있을 때 (score 동률)
2. `Inference Lock(K)`이 걸린 상태에서 다른 type 후보가 더 가까울 때
3. VCB 입력 도중 마우스가 다른 추론 축에 닿을 때

비결정성은 사용자에게 "왜 이게 잡혔지?"라는 의문을 남기고, 더 큰 문제는 **회귀 테스트가 어렵다**는 것이다 (같은 입력에 다른 결과).

## 결정

스코어 동률(±EPSILON_SCORE = 0.1) 발생 시, 다음 **5단계 tie-breaker**를 순서대로 적용한다:

| 단계 | 기준 | 비고 |
|---|---|---|
| 1 | **Lock 상태** | K키 lock 활성 시 lock 방향과 일치하는 후보 우선 |
| 2 | **Recency** | 최근 400ms 내 hover했던 type 우선 |
| 3 | **Type priority** | endpoint > midpoint > intersection > onFace > axis > grid |
| 4 | **Pixel distance** | 작은 쪽 우선 |
| 5 | **Stable ID** | 작은 ID (deterministic 보장) |

### VCB ↔ Inference Lock 우선순위

VCB 입력이 활성화된 상태에서:

```
if (lock.active) {
    apply VCB value along lock direction
} else if (last_inference.exists && last_inference.is_axis) {
    apply VCB value along last inference axis
} else {
    apply VCB value along world axis (last used)
}
```

### Tab 키 동작 명시

`Tab`은 현재 프레임에서 *동일 score* 였던 후보들의 ranked list를 순환한다 (already implemented, 명시화).

## 결과 (Consequences)

**긍정**
- 같은 입력 → 같은 출력 (회귀 테스트 가능)
- 사용자가 "왜 이게 잡혔지?"를 디버그 패널에서 추적 가능
- Inference 관련 버그 리포트의 절반 이상이 자가 진단 가능

**부정**
- 5단계 tie-breaker는 cold path에서도 항상 평가됨 — 측정상 +50ns/snap. BVH/Spatial Hash 비용에 비하면 무시 가능.

## 검증

1. 동일 좌표 두 vertex 생성 → snap 후보가 항상 ID 작은 쪽
2. Lock 활성 + 더 가까운 다른 type 후보 → lock 방향이 이김
3. VCB "1000" 입력 + Lock(X축) → +X 방향 1000mm 정확 적용
4. Recency 400ms 경계 테스트

## 대안 (Alternatives)

- **무작위 tie-break**: hash 기반 결정. 사용자가 "왜 이게?" 디버그 못함 → 기각.
- **항상 endpoint 우선**: type priority 만 사용. Recency / Lock 무시 → 도구 사용감 저하.
- **사용자 설정 priority**: ADR-007 동적 분류처럼 설정. 학습 곡선 ↑, 기각.

## 재검토 트리거 (When to Revisit)

- Inference 후보 수가 10 종류 초과 (현재 9)
- snap 관련 버그 리포트가 월 5건 초과
- VCB 입력 정확도가 사용자 테스트에서 95% 미만

## 관련 기록 (Related)

- ADR-007 Rev 2 (Face Orientation) — 면 분류는 inference 후보의 onFace 형태 결정
- ADR-008 #7 (Face Interaction) — face split inference 와의 연동
- 메타-원칙 #4, #5, #9

## 메타-원칙 매핑

- #4 SSOT — 스냅 결정의 단일 진실 원천
- #5 사용자 편의 최우선 — 명확한 우선순위
- #9 회귀 없음 — deterministic 보장
