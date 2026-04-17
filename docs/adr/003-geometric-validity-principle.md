# ADR-003: Geometric Validity Principle (기하학적 유효성 원칙)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Scope**: 모든 기하 연산 (`push_pull`, `move`, `scale`, `boolean`, `split`, `draw_*`, import)

## 맥락 (Context)

XIA 상태는 면 개수로 결정된다(ADR-002). 그런데 다음과 같은 문제 케이스가 존재:

### 유령 객체 (Phantom Objects)

```
Volume = L × W × H
  만약 L, W, H 중 하나라도 0이면 → 수학적 부피 = 0
  그러나 현재 엔진은 face_ids.len() = 6 이라는 이유로 여전히 Volume 판정
```

즉 **토폴로지적으로는 존재하지만 기하학적으로는 실체가 없는 객체**가 생길 수 있다.

구체적 시나리오:
- Push/Pull에 `dist = 1e-10` 같은 극미소 값 → 두께 없는 박스 생성
- Scale로 Z축을 0으로 → 6면이지만 납작한 박스
- Boolean A - B 결과에 두께 0인 sliver 조각
- 외부 파일(DXF/OBJ) 임포트 시 degenerate face 포함

### 왜 문제인가

1. **렌더링에서 안 보임** — 사용자 혼란 ("내가 만든 것 어디 갔지?")
2. **후속 연산 불안정** — 0-부피 객체에 대한 Push/Pull, Boolean, Split 결과 예측 불가
3. **수치 오차 증폭** — degenerate 삼각분할, 0-길이 엣지의 정규화 등
4. **상태 왜곡** — Volume으로 잘못 분류되어 사용자 쿼리/UI 오동작

## 결정 (Decision)

### 공식 원칙

> **XIA는 자신의 상태가 요구하는 차원을 충분한 extent로 가져야 한다.**
> **이 불변식을 위반하는 기하를 생성하려는 연산은 거부된다.**

### 차원별 요구사항

| 상태 | 요구 extent |
|-----|----------|
| Volume | 3D extent: 모든 축에서 ≥ `EPSILON_LENGTH` |
| Face | 2D extent: 두 축 이상에서 ≥ `EPSILON_LENGTH` |
| Edge | 1D extent: 길이 ≥ `EPSILON_LENGTH` |
| Point | 차원 없음 (trivial) |

### 적용 전략: **Preventive (사전 차단)**

**핵심: "소멸(curative)"이 아닌 "생성 거부(preventive)" 방식을 택한다.**

```rust
// 나쁜 예 — Curative (사후 삭제)
fn push_pull_bad(&mut self, face_id: FaceId, dist: f64) {
    execute(face_id, dist);
    if self.is_degenerate(face_id) {
        self.delete_xia(face_id);  // ❌ 예상치 못한 삭제 → UX 충격
    }
}

// 좋은 예 — Preventive (사전 거부)
fn push_pull_good(&mut self, face_id: FaceId, dist: f64) -> Result<()> {
    if !dist.is_finite() || dist.abs() < EPSILON_LENGTH {
        return Err(Error::WouldCreateDegenerate);  // ✅ 애초에 만들지 않음
    }
    execute(face_id, dist);
    Ok(())
}
```

### 각 연산별 가드

| 연산 | 거부 조건 |
|-----|---------|
| `push_pull(dist)` | `!dist.is_finite() \|\| dist.abs() < EPSILON_LENGTH` |
| `scale(fx, fy, fz)` | 결과 bbox의 어느 축이든 < EPSILON_LENGTH |
| `move(delta)` + snap | snap 후 정점 병합으로 degenerate 발생 |
| `draw_rect(w, h)` | `w < EPSILON_LENGTH \|\| h < EPSILON_LENGTH` |
| `draw_circle(r)` | `r < EPSILON_LENGTH` |
| `boolean(op)` | 결과에 degenerate face 발생 시 `DegenerateMode` 참조 |

### Import / Boolean 결과의 Degenerate 처리

이 두 경로는 **연산 결과가 예측 불가**하므로 옵션 제공:

```rust
pub enum DegenerateMode {
    Reject,   // degenerate 감지 시 전체 연산 실패
    Discard,  // degenerate 조각만 버리고 나머지는 유지 (기본값)
    Preserve, // 유지 (사용자 책임 — 의도적 얇은 판 등)
}
```

### 기존 Degenerate 데이터의 처리

이미 파일에 저장된 degenerate 객체 (과거 버전 파일, 외부 임포트 등):
- **자동 삭제하지 않음** — 데이터 손실 위험
- 별도 명시적 커맨드로 처리:

```rust
Command::ValidateScene { report_only: bool }
Command::CleanDegenerateXias { confirm: bool, preview_first: bool }
```

## 근거 (Rationale)

### 왜 Preventive인가

"차원 강등" 또는 "자동 소멸" 방식 대비 Preventive의 우월성:

| 비교 항목 | 차원 강등 | 자동 소멸 (Curative) | **Preventive** |
|---------|--------|-------------------|--------------|
| 상태 단순성 | 낮음 (하이브리드) | 높음 | **높음** |
| 플래핑 | 있음 (히스테리시스 필요) | 없음 | **없음** |
| UX 예측성 | 낮음 | 낮음 (순삭) | **높음** (명확한 거부) |
| 데이터 손실 위험 | 낮음 | 높음 | **없음** |
| 외부 참조 무효화 | 중간 | 높음 | **없음** |
| 구현 복잡도 | 높음 | 중간 | **낮음** |

### 왜 EPSILON은 절대값인가

상대값(bbox 기준)도 고려했으나:
- 상대값은 단일 객체 내부 기준이라 **기하학적 스케일과 무관한 사용자 의도**를 반영 못 함
- 예: 1m 박스에서 1μm 두께는 사용자가 의도했을 가능성이 있음 (도면 선 두께)
- 절대값은 **단위 시스템에 종속되지만 명확**

→ EPSILON은 단위 변환 시 함께 변환되는 "물리적 허용 오차"로 관리

## 결과 (Consequences)

### 긍정
- ✅ 유령 Volume / Face 불가능 — 기하학적 무결성
- ✅ UI/UX 일관성 — 보이는 것이 곧 실체
- ✅ 후속 연산(Boolean, Export)의 안정성 확보
- ✅ 수치 오차 누적 차단

### 부정
- ⚠️ **의도적 얇은 객체 생성이 번거로워짐**
  - 예: 0.01mm 금속판을 만들고 싶은데 EPSILON=1e-6 기준이면 가능하나, EPSILON을 너무 크게 잡으면 거부됨
  - **대응**: 기본 EPSILON은 보수적(작게), 사용자가 설정에서 조정 가능
  
- ⚠️ **인터랙티브 프리뷰와의 조율 필요**
  - Drag 중 잠깐 degenerate 상태를 지나야 하는 UX
  - **대응**: 프리뷰는 "임시 상태"로 취급, 커밋 시점에만 가드 검사

- ⚠️ **Boolean 결과의 예측 불가성**
  - `DegenerateMode::Discard`가 기본이지만 사용자는 모를 수 있음
  - **대응**: Discard 발생 시 Toast 알림

## 대안 (Alternatives)

### 대안 A: 저장 방식 state + 자동 차원 판정
- 매 연산 후 bbox/volume 계산 → state 조정
- **기각**: 성능, 플래핑, 단위 의존성 문제

### 대안 B: Curative (자동 삭제)
- Degenerate 발생 시 해당 XIA를 자동 삭제
- **기각**: 데이터 손실, 외부 참조 무효화, UX 충격

### 대안 C: 허용 + 경고만
- Degenerate 허용하고 UI에 경고 표시
- **기각**: 근본 문제 해결 안 됨. 후속 연산 불안정 그대로.

## 재검토 트리거

- 사용자가 "얇은 판을 만들려는데 거부된다" 라는 실 리포트
  - 대응: EPSILON 기본값 하향 또는 단위별 자동 조정
- 대용량 임포트에서 Discard가 과도하게 일어남
  - 대응: Import 전용 EPSILON 별도 관리

## 관련 기록

- [ADR-002](./002-xia-state-from-face-count.md) — 상태 계산이 왜 면 개수 기반인가 (이 원칙이 해결하는 "유령 Volume" 문제의 뿌리)
- `crates/axia-geo/src/tolerances.rs` — EPSILON 상수 정의
- Phase 1 구현 계획 — `docs/roadmap-2026-04-17.md`

## 구현 체크리스트

- [ ] `EPSILON_LENGTH`, `EPSILON_AREA`, `EPSILON_VOLUME` 상수 정의
- [ ] `push_pull` 가드 추가
- [ ] `scale` 가드 추가
- [ ] `move` + snap 가드 추가
- [ ] `draw_rect`, `draw_circle` 최소 크기 검증
- [ ] `boolean` 의 `DegenerateMode` 옵션
- [ ] `Toast` 기반 사용자 피드백
- [ ] `Command::ValidateScene` 수동 검증 커맨드
- [ ] 각 연산의 단위 테스트에 degenerate 거부 케이스 추가
