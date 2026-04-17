# ADR-002: XIA 상태는 면 개수 기반 계산

- **Status**: Accepted
- **Date**: 2026-04-17
- **Scope**: `axia-core::xia`

## 맥락 (Context)

XIA(=Object)는 소유한 기하에 따라 다섯 상태 중 하나를 가진다:

```
Dissolved → Point → Edge → Face → Volume
```

**질문**: 이 상태를 어떻게 결정할 것인가?

두 가지 접근이 가능하다:

### A) 저장 방식
- XIA에 `state: XiaState` 필드 저장
- 연산마다 업데이트

### B) 계산 방식
- `face_ids.len()` 등 소유 데이터에서 파생
- 저장하지 않고 매번 계산

## 결정 (Decision)

**계산 방식(B)을 채택한다.**

### 구현

```rust
pub fn geometry_state(&self) -> XiaState {
    match (self.face_ids.len(), self.standalone_edge_id.is_some()) {
        (0, false) => XiaState::Dissolved,
        (0, true)  => XiaState::Edge,     // draw_line 전용
        (1 | 2, _) => XiaState::Face,
        _          => XiaState::Volume,   // 3+ faces
    }
}
```

- 비용: O(1)
- 외부 저장: 없음
- 직렬화: `face_ids`만 저장, state는 로드 시 재계산

### 자동 전이

Push/Pull로 Face→Volume, Face 삭제로 Volume→Face 등 **자동 승강**은 다음 연산에서 발생:
- `push_pull` — face 추가로 3+ → Volume 자동 승격
- `delete_face` — face 감소로 Volume → Face 자동 강등
- `boolean` — 결과 면 개수에 따라 재계산

## 근거 (Rationale)

### 저장 방식(A)의 문제
1. **일관성 버그** — 연산 추가 시 state 업데이트 누락 가능
2. **이중 표현** — 면 개수와 상태가 불일치할 수 있음
3. **Undo 복잡** — 스냅샷에 상태도 포함해야 함

### 계산 방식(B)의 장점
1. **Single source of truth** — `face_ids`만이 진실
2. **자동 일관성** — 상태가 데이터에서 파생되므로 불일치 불가능
3. **Undo 단순** — 데이터만 복원하면 상태도 자동 복원
4. **성능 영향 미미** — O(1) 계산

## 결과 (Consequences)

### 긍정
- ✅ 버그 표면적 감소 — state 업데이트 누락 불가능
- ✅ 직렬화 포맷 단순 — state 필드 없음
- ✅ `Vec::len()` 기반이라 컴파일러 최적화 친화적

### 부정
- ⚠️ **"유령 Volume" 가능** — 3+ face라도 기하학적 부피 0인 degenerate 가능
  - 예: 박스 윗면을 바닥으로 완전히 끌어내려 납작해진 경우
  - 현재 state는 여전히 Volume으로 판정
  - **대응**: ADR-003 (Geometric Validity Principle)로 애초에 이런 기하 생성을 거부

- ⚠️ **열린 쉘도 Volume** — 6면 중 5면만 있는 박스도 Volume
  - 현재는 허용. 사용자가 의도적으로 만들 수 있음
  - 엄격한 "닫힌 솔리드" 판정이 필요하면 `is_face_set_closed()` 별도 사용

## 개념 정정 (Clarification, 2026-04-17)

초기 설계에서 XIA 상태를 다음과 같이 **차원 축 하나**에 늘어놓았다:

```
Dissolved → Point → Edge → Face → Volume → "XIA"
```

이 표현은 **범주 오류(category error)** 를 포함한다:

- `Point`, `Edge`, `Face`, `Volume`은 **기하의 차원** (0D/1D/2D/3D) 속성
- `XIA`는 **Semantic 분류** (이름·재질·그룹·선택 단위를 가진 객체 여부)
- 둘은 **직교하는 축**이지, 한 축의 선형 진행 단계가 아니다

**정확한 모델**:

```
기하 차원 (Dimension): Vertex(0D) · Edge(1D) · Face(2D) · Volume(3D)
                         ↑ 이것이 "도구가 만드는 결과"
Semantic 정체성 (XIA): "이름 붙은 의미 단위" — 차원과 직교
```

즉:
- **Point/Line/Face는 "그리는 도구/기하 원소"이지 XIA의 진행 단계가 아니다.**
- XIA는 Line이든 Face든 Volume이든 **어느 차원에도 붙을 수 있는 Semantic wrapper**다.
- `XiaState::Point`는 현재 코드에서 dead branch로 **할당된 적이 없다** (이 점은 의도적).

### 이 정정이 코드에 미친 영향

- `XiaState` enum 자체는 **파일 포맷 호환성**을 위해 그대로 유지 (Point variant 포함)
- Inspector UI의 단계 바에서 `Point`/`XIA` 라벨을 제거:
  - 남은 단계: `Line → Face → Volume` (순수 차원)
  - XIA 승격은 별도 방식으로 표현 (이름/재질 부여 등 — 미래 UI 개선)
- 이 ADR은 계속 유효. "XIA 상태 = face 개수"라는 판정 공식 자체는 변경 없음.

## 대안 (Alternatives)

### 대안 A: 저장 방식
- **기각 이유**: 위의 버그/복잡성 문제

### 대안 B: 기하학적 차원 기반 (실시간)
- bbox/volume 계산으로 L, W, H 검사 → state 결정
- **기각 이유**:
  - O(V) 비용 → 성능 저하
  - Epsilon 의존 → 결정론 약화
  - 플래핑 가능 → 히스테리시스 필요
  - 단위 시스템 의존
- **이 문제는 ADR-003의 "생성 차단" 방식으로 대체 해결**

### 대안 C: 저장 + 계산 이중화 (캐시)
- state를 계산하되 캐시
- **보류**: 현재 O(1)이라 캐시 불필요. 미래 엄격 판정 도입 시 재검토.

## 재검토 트리거

- `geometry_state()` 호출이 성능 프로파일 상위에 올라오는 경우
- "유령 Volume" 문제가 실 사용자 리포트로 들어오는 경우
  - (단: 우선 대응은 ADR-003의 생성 차단)

## 관련 기록

- `crates/axia-core/src/xia.rs` — `geometry_state()` 구현
- [ADR-001](./001-geometry-semantic-layer-separation.md) — 왜 XIA가 Semantic 레이어에 있는가
- [ADR-003](./003-geometric-validity-principle.md) — 유령 Volume 문제의 근본 해결책
