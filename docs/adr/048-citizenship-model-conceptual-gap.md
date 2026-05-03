# ADR-048 — Citizenship Model Conceptual Gap (v3.2 Foundation Lock + Migration Roadmap)

**Status**: Accepted (Phase 0 — documentation only, no code change)
**Date**: 2026-05-03
**Anchor**: AixxiA Design Specification v3.2 (May 3, 2026, Author: WYKO)
**Related**: ADR-007 (Face Orientation), ADR-019 (Line is Truth), ADR-021
(Closed Edge Loop), ADR-025 (P11 face synthesis), ADR-046 (P31 Product
Identity), ADR-047 (P32 Snap Chain)

---

## 0. Summary (3 lines)

> AixxiA Design Spec v3.2 정의하는 3계급 시민권 (XIA / Boundary / Reference)
> 모델과 현재 엔진의 "모든 것이 XIA" 모델 사이에 근본적 conceptual gap 존재.
> 본 ADR 은 그 gap 을 명문화하고 단계적 마이그레이션 로드맵 (Phase 0~5) 만 정의한다.
> Phase 0 (이 문서) 외엔 코드 변경 없음 — 후속 Phase 는 각각 별도 ADR + PR.

---

## 1. Context

### 1.1 v3.2 의 3계급 시민권 모델

AixxiA Design Spec v3.2 (2026-05-03) 가 정의하는 모델:

| 시민권 | 정의 | 조건 |
|---|---|---|
| **1급 — XIA** | 형상 + 재질 부여된 부재 | (i) 부피 또는 단면 > 0, (ii) 재질, (iii) Watertight 닫힘, (iv) 매니폴드 무결성 |
| **2급 — Boundary** | 형상만 갖춘 잠재 상태 | 닫힘 (1D / 2D / 3D Boundary) |
| **3급 — Reference** | 시민권 없는 참조 데이터 | Construction Line / Point Cloud / Imported Mesh |
| **시스템 도구** | Snap Point | 시민권과 무관, 위치 가진 모든 것에 자동 도출 |

**시민권 간 전환** (v3.2 §3.5):
- Reference → Boundary (가역 승격)
- Boundary → XIA (가역 승격, 두께+재질 부여 시)
- **XIA → Boundary (가역 강등)** — 재질 제거 시
- **XIA / Boundary → Reference (비가역 강등)** — 위상 깨질 시

**차원 붕괴 방지** (v3.2 §4.3):
- 부피 = 0, 어느 한 차원 = 0, self-intersecting, non-manifold → 시스템이 **자동 차단 또는 강등**
- 임계값 (예: 1mm) 도달 시 **경고 표시**, 강제 입력 시 자동 삭제 또는 강등

### 1.2 현재 엔진의 모델

현재 엔진은 **"모든 도구의 결과물이 XIA"**:

```
DrawLine    → "Line XIA" (Edge 1, Face 0, Volume 0)
DrawCircle  → "Circle XIA" (Face 1)
DrawRect    → "Rectangle XIA" (Face 1)
Push/Pull   → "XIA" 가 Volume 가짐
```

특징:
- 도구 실행 즉시 XIA 생성 (재질 = `default_material` 자동)
- 차원 붕괴 자동 처리 없음 (radius=0 입력해도 거부 안 됨)
- "Boundary" 와 "Reference" 시민권 분리 없음
- 강등 메커니즘 없음 (재질 제거 시 어떻게 되는지 정의 안 됨)
- "Centerline" 만 일부 분리 (ADR-019 A1) — 본격 Reference 카테고리 아님

### 1.3 사용자 식별 핵심 예시

> "원을 그려서 반지름이 0이 될 수 있습니다. 반지름이 0이면 문서의 내용대로
> point, vertex 가 됩니다. 이것이 가장 문제인 것 같습니다."

이 예시가 gap 을 가장 명확하게 드러냄:

```
사용자: DrawCircle (radius=100)
  현재 엔진: "Circle XIA" 생성, 정상 face 1개
  v3.2:     2D Boundary (재질 없으니 XIA 아님)

사용자: radius 줄임 → 1mm → 0.1mm → 0
  현재 엔진: 여전히 "Circle XIA"... 어느 시점에 NaN normal /
            zero-area face / earcut Ok([]) 등 degenerate 상태로 진입
            → 어제 (2026-05-02 세션) 의 많은 버그의 원천
  v3.2:     1mm 임계값 도달 시 경고
            radius=0 도달 시 → Point 로 자동 강등 + 재질 라이브러리 보존
```

**이 차원 붕괴 미처리가 어제 세션의 다음 버그들의 공통 origin** 임이 확인됨:
- earcut Ok([]) 잔존 face (`1cb1827` 에서 자동 deactivate 로 사후 처리)
- post-pipeline degenerate scan scope leak (`fc3abe6`)
- non-manifold edge by stacked-inner (`0c04ae1` 에서 R1 highlight 로 visual 처리)

이들 모두 **input 단계 가드가 없어서** 발생한 문제를 사후 self-healing 으로
땜질한 것.

---

## 2. Decision

### 2.1 Phase 0 — 본 ADR (문서화 + 로드맵 동결)

**이번 세션에서 진행:**

1. v3.2 spec 을 AxiA Engine 의 **개념적 anchor 문서** 로 인정
2. 현재 엔진 ↔ v3.2 의 conceptual gap 을 본 ADR 에 명시 (위 §1)
3. CLAUDE.md LOCKED #26 추가 — v3.2 Foundation 과 미정합 사실 동결
4. 단계적 마이그레이션 로드맵 (Phase 1~5) 정의
5. **코드 변경 0** — 안전한 anchor 잡기

### 2.2 Phase 1~5 — 후속 작업 (각각 별도 ADR + PR)

**시급도 + 의존성 순서**:

#### Phase 1 — 차원 붕괴 즉시 가드 (P0 — 가장 시급)

**목표**: radius / length / area / volume < ε (사용자 정의 임계값) 시
도구 단계에서 입력 거부 + Toast 안내.

**범위**:
- DrawCircle (radius < 1mm 거부)
- DrawRect (width || height < 1mm 거부)
- DrawLine (start == end 거부)
- Push/Pull (distance < 1mm 거부)
- Move/Scale 결과가 차원 붕괴 만들 시 작업 거부

**기대 효과**:
- 어제 세션의 self-healing 사후 처리들 (earcut empty, degenerate scan) 의
  **trigger 자체 차단**
- 사용자가 즉시 "왜 안 되지?" 알게 됨 — 침묵의 degenerate 상태 진입 차단

**비용**: 2-3시간. **회귀 위험**: 낮음 (입력 단계 reject 만).

**별도 ADR**: ADR-049 (예정) — "Dimensional Collapse Input Guards (P33)"

#### Phase 2 — XIA → Boundary 가역 강등 API

**목표**: XIA 에서 재질 제거 시 Boundary 상태로 강등. 재질 임시 보존 (세션
스코프). 재질 재부여 시 즉시 XIA 복귀.

**범위**:
- Rust API: `xia.demote_to_boundary()` / `boundary.promote_to_xia(material)`
- WASM bridge + TS 통합
- XIA Inspector UI 에서 "재질 제거" 버튼 → 강등 흐름

**비용**: 4-6시간. **회귀 위험**: 중간 (선택/렌더 통합 영향).

**별도 ADR**: ADR-050 (예정) — "Reversible Demotion Mechanism"

#### Phase 3 — Reference 시민권 분리

**목표**: Construction Line / Imported Mesh / (장기) Point Cloud 를 별도
Reference 카테고리로 분리. 1·2급 시민과 시각·논리 구분.

**범위**:
- 새 Rust enum `Citizenship { Xia, Boundary, Reference }` 또는 별도 Reference store
- 시각: 회색 반투명 + 별도 레이어
- 최종 출력 (DXF/IFC/SKP) 에서 자동 제외 옵션

**비용**: 1-2주. **회귀 위험**: 큼 (도구 전반 영향).

**별도 ADR**: ADR-051 (예정)

#### Phase 4 — XIA 자동 차원-붕괴 강등

**목표**: 사용자가 XIA 의 dimension 을 줄여서 임계값 도달 시 자동 강등
(가역 → Boundary, 또는 비가역 → Reference / Point).

**v3.2 §4.3**:
- 1mm 도달 시 경고
- 0 도달 시 자동 삭제 또는 강등

**비용**: 1주. **회귀 위험**: 큼 (transform 도구 전체 영향).

**별도 ADR**: ADR-052 (예정)

#### Phase 5 — 전면 정합 + 자산 라이브러리 3계층

**목표**:
- 모든 도구가 v3.2 시민권 모델로 동작
- v3.2 §13 자산 라이브러리 3계층 (시스템·프로젝트·사용자)
- v3.2 §12 자동 복구 (Hole filling / Edge restoration)

**비용**: 수주. **회귀 위험**: 매우 큼.

**별도 ADR**: ADR-053+ (예정)

### 2.3 v3.2 명제 ↔ 현재 엔진 매핑 표

| v3.2 명제 | 현재 엔진 | 격차 |
|---|---|---|
| **명제 1** Face 비-1급 시민 | ADR-019 ("Line is Truth, Face is Byproduct") | ✅ 일치 |
| **명제 2** Snap = 시스템 도구 | SnapManager + ADR-047 P32 | ✅ 일치 |
| **명제 3** Boundary 본질 = 닫힘 | ADR-021 P7, ADR-025 P11 | ✅ 일치 |
| **명제 4** XIA = 형상 + 재질 + 닫힘 + manifold | ⚠️ 부분 — 모든 도구 결과를 XIA 로 처리, 재질·차원 가드 없음 | 🔴 **Phase 1, 2 필요** |
| **명제 5** Constraint | Level 1/2/3 + ConstraintPanel | ✅ 일치 |
| **명제 6** Reference 카테고리 분리 | Centerline 일부만, 전면 미구현 | 🔴 **Phase 3 필요** |
| **명제 7** 위상 무결성 = 시민권 절대 조건 | ADR-007 invariant + 어제 self-healing (`52c42a0`, `1cb1827`, `fc3abe6` 등) | 🟡 **부분 구현 (사후) — Phase 1, 4 로 사전 가드 강화** |
| **§12** 가역/비가역 강등 | 미구현 | 🔴 **Phase 2, 4 필요** |
| **§13** 자산 라이브러리 3계층 | MaterialLibrary 단일 계층만 | 🔴 **Phase 5 필요** |

---

## 3. Open Questions (Phase 1 이전 결정 필요)

다음 항목들은 **Phase 1 시작 전에 사용자 결정 필요**:

### Q1. 차원 임계값
v3.2 §4.3 은 "1mm" 를 예시로 들었지만 도구별 / 단위별 다를 수 있음:
- 길이 임계: 1mm? 0.1mm? 사용자 단위 (m / mm / in) 별 비례?
- 면적 임계: 1mm² ? 1μm² ?
- 부피 임계: 1mm³ ?

**제안**: ADR-049 신설 시 결정. 기본값 + Settings 에서 사용자 조정 가능.

### Q2. ADR-021 P7 stacked-inner 정책 재검토
v3.2 명제 4 "manifold 무결성" 과 ADR-021 P7 (stacked-inner = 양쪽 sub-face 동시
fill) 간 잠재 충돌 (`caafe63` 에 기록됨).

- v3.2 strict 적용 → P7 재설계 (예: outer = ring-with-hole 1개, inner = 별개 1개)
- 현재 정책 유지 → ADR-021 P7-N amendment 로 "by design 예외" 명시 (이미 존재)

**제안**: 본 ADR 에선 결정 보류. Phase 1 / 2 작업 중 재논의.

### Q3. 기존 "Line XIA" 의 처리
v3.2 의 시민권 모델로 strict 정합 시:
- DrawLine 은 Reference (Construction Line) 만 만들어야 함
- 현재 "Line XIA" 는 v3.2 분류상 Reference 또는 Open Edge Boundary
- 마이그레이션 시 기존 사용자 파일 호환성?

**제안**: Phase 3 시작 시 결정. v1/v2/v3 파일 포맷 호환 정책 (ADR-008 기반)
와 함께 검토.

### Q4. 자동 강등 vs 사용자 결정 — 기본 정책
v3.2 §12.3 은 "자동 복구 시도 → 실패 시 사용자 결정". 어제 세션의 우리 self-
healing (earcut empty 자동 deactivate) 은 "사용자 결정 없이 자동 제거" 였음.

- v3.2 strict → 자동 제거 시 알림 + 5초 후 자동 닫힘 + Undo 가능
- 현재 동작 → 침묵의 자동 제거

**제안**: Phase 4 작업 시 알림 메커니즘 추가. 본 ADR 에선 격차만 인지.

---

## 4. Cross-Links

### 4.1 어제 세션 (2026-05-02) 작업과의 관계

본 ADR 의 Phase 1 가드가 있었다면 어제의 다음 작업이 **불필요했거나 더 단순했을** 것:

| 어제 작업 | Phase 1 사전 가드 시 |
|---|---|
| `1cb1827` earcut Ok([]) 자동 deactivate | DrawRect / DrawCircle 입력 단계에서 차원 가드 → degenerate 자체 미발생 |
| `fc3abe6` post-pipeline degenerate scan scope-leak fix | 동일 (사전 가드로 발생 빈도 격감) |
| `0c04ae1` R1 non-manifold edge highlight | 여전히 필요 (의도된 stacked-inner 시각화) |
| `52c42a0` `std::time::Instant` panic | 무관 (별개 WASM 호환성 이슈) |
| `8f0fe38` free-edge dashed overlay | 부분 무관 (사용자 인지 향상 목적) |

→ Phase 1 가드는 **다수 self-healing 코드의 trigger 를 차단** 함. 자동 cleanup
은 "사후 정리" 가 아닌 "예외적 last-resort safety net" 으로 격하 가능.

### 4.2 LOCKED 정책 cross-reference

**유지 (v3.2 와 호환)**:
- LOCKED #2 (ADR-007 winding), #5 (1.5μm tolerance), #6 (ADR-018 render),
  #8 (ADR-019 Line is Truth A6), #9 (ADR-022), #10 (ADR-023), #11 (ADR-024
  3-way chamfer), #13 (ADR-035), #14 (ADR-036), #15-#23 (MCP / UI / Snap)

**v3.2 와 잠재 충돌 — 별도 검토 필요**:
- LOCKED #1 (ADR-021 P7 stacked-inner) — Q2 참조
- LOCKED #3 (M1 Step 4.5 sub-face XIA inheritance) — v3.2 시민권 분리 후 재검토
- LOCKED #12 (ADR-025 P11 strict) — v3.2 §4.3 자동 강등과 정합 확인 필요

**재정의 필요 (v3.2 와 직접 충돌)**:
- 없음 (현재까지 식별된 직접 충돌은 conceptual gap 만)

---

## 5. Acceptance Criteria

본 ADR 의 Phase 0 완료 조건:

- [x] v3.2 spec 의 핵심 (3계급 시민권, 명제 4 XIA 4대 조건, §4.3 차원 붕괴
  방지) 이 본 ADR 에 명문화됨
- [x] 현재 엔진의 모델과의 conceptual gap 이 §1.2-1.3 에 명시됨
- [x] Phase 1~5 로드맵이 비용 / 위험 / 의존성 순서로 정의됨
- [x] v3.2 명제 ↔ 엔진 매핑 표 (§2.3) 작성됨
- [x] 어제 세션 작업들과의 관계 (§4.1) 명시됨
- [x] CLAUDE.md LOCKED #26 추가 (별도 작업)
- [ ] **코드 변경 0** — 본 PR 에선 문서만

---

## 6. References

- AixxiA Design Specification v3.2 (`D:\1. 도구의시작\AixxiA_Design_Specification_v3.2.docx`)
- ADR-007 (Face Orientation Policy)
- ADR-019 (Line is Truth, Face is Byproduct — 명제 1 의 코드 anchor)
- ADR-021 (Closed Edge Loop Divides Face)
- ADR-025 (P11 Closed Edge Cycle MUST Synthesize Face)
- ADR-047 (P32 Snap Chain Self-Touch Prevention)
- 어제 세션 commit log: `52c42a0`, `1cb1827`, `fc3abe6`, `0c04ae1`, `8f0fe38`,
  `6f6cd3e` (대표)

---

*Author*: AXiA team (사용자 v3.2 spec 기반 + Claude conceptual mapping) |
*Status*: Phase 0 — accepted, no code change |
*Next*: Phase 1 (ADR-049) decision pending — Open Questions §3 답변 후 진행
