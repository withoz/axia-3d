# ADR-049 — Two-Layer Citizenship Model (Form XIA vs Property XIA)

**Status**: Accepted (Phase 0 — documentation only, no code change)
**Date**: 2026-05-03
**Anchor**: AixxiA Design Specification v3.2 (May 3, 2026, Author: WYKO)
**Supersedes**: ADR-048 §1.2-1.3, §2.3, §3, §4 (격차 진단 + 마이그레이션
로드맵 부분만; ADR-048 의 결정 이력은 amendment 로 보존)
**Related**: ADR-007 (Face Orientation), ADR-019 (Line is Truth — 형태
계층의 anchor), ADR-021, ADR-025, ADR-046 (P31 Product Identity), ADR-047
(P32 Snap Chain), ADR-048 (역사적 격차 진단)

---

## 0. Summary (3 lines)

> AixxiA 의 "XIA" 는 **두 계층** 으로 분리된다 — 형태 XIA (현재 엔진의 모든
> 도구가 만드는 기하 추상, 0 차원 자연 허용) 와 특성 XIA (v3.2 spec 의 정식
> XIA, 부피·재질·닫힘·manifold 4조건 충족). 두 계층은 coexist 하며, 진짜
> 정합 대상은 **두 계층 간 승격/강등 transition**. 형태 계층에 차원 가드를
> 강요하면 Face/Line 의 본질을 부정하는 잘못이 된다.

---

## 1. Context

### 1.1 사용자 통찰 (2026-05-03, ADR-048 검토 직후)

> "FACE 는 두께가 0이다. LINE 도 두께·너비 0, 길이만 있다. POINT/VERTEX 도
> 모두 0이다. **형태에서는 0이 허용되어야 한다.**"
>
> "현재 엔진의 XIA 는 **형태 XIA** 이고, v3.2 의 XIA 는 **특성 XIA** 이다.
> 부피가 있는 것과 한 부분이 0이 되는 것은 (다른 계층의) 별개 사건이다."

이 통찰이 ADR-048 의 진단 ("엔진 XIA 가 v3.2 XIA 와 안 맞음 — 격차") 을
**카테고리 오류** 로 지적한다. 두 XIA 는 다른 추상 계층의 같은 이름.

### 1.2 두 계층 정의

#### 형태 계층 (Form Layer)

```
형태 XIA = 기하학적 추상 (geometric abstraction)
  - Point   (0D): 위치만, 모든 차원 0
  - Line    (1D): 길이만, 두께·너비 0
  - Face    (2D): 길이·너비, 두께 0  ← 명제 1 의 "Face"
  - Volume  (3D): 길이·너비·두께
  - Closed Loop (1D Boundary), Closed Surface (3D Boundary) 등 위상 형태도 포함

특징:
  - **0 차원 허용 + 자연** — Face 의 두께 0 은 본질
  - 재질 없음, default 값도 없음 (또는 sentinel)
  - 차원 붕괴 자체는 사건 아님 (Point 가 되는 것일 뿐)
  - 단, "0-area face" / "self-intersecting" 같은 위상적 무효는 별개로 차단
```

ADR-019 "Line is Truth, Face is Byproduct" 가 이 계층을 운영. 현재 엔진의
모든 Draw 도구 (DrawLine / DrawCircle / DrawRect / Push-Pull / etc.) 는
형태 XIA 를 만든다.

#### 특성 계층 (Property Layer)

```
특성 XIA = 부재 (member) 정체성 (identity as member)
  - Volumetric XIA: 부피 > 0 + 재질 + 닫힘 + manifold (v3.2 명제 4 ①)
  - Linear XIA:    중심선 길이 > 0 + 단면 면적 > 0 + 재질 (v3.2 명제 4 ②)

특징:
  - 4조건 (부피·재질·닫힘·manifold) 동시 충족 필수
  - 차원 붕괴 = 강등 사건 (특성 → 형태)
  - 재질 제거 = 가역 강등 (v3.2 §12.1.1)
  - Edge/Face/Volume 손실 = 비가역 강등 (v3.2 §12.1.2)
```

v3.2 명제 4 + 명제 7 + §12 가 이 계층을 운영. 현재 엔진엔 미구현
(default_material 자동 부여로 형태/특성 구분 없음).

### 1.3 두 계층 transition

```
            [형태 XIA]
                ↑↓
   재질 부여 │ │ 재질 제거 (가역 강등)
   + 4조건  │ │ 또는 차원 붕괴 (가역)
   검증     │ │ 또는 위상 손상 (비가역, → Reference)
                ↓
            [특성 XIA]
                ↓
            v3.2 §12
            가역/비가역 강등
```

**transition 만이 진짜 정합 대상**. 형태 계층 자체의 0 차원은 손대면 안 됨.

### 1.4 어제 세션 (2026-05-02) fix 들의 재해석

| 어제 fix | 형태 계층 의미 | 특성 계층 의미 | 계속 valid? |
|---|---|---|---|
| `1cb1827` earcut Ok([]) auto-deactivate | 0-area face 는 형태에서도 rendering 무의미 → 자동 정리 정당 | (형태에서 처리되므로 특성에 도달 안 함) | ✅ 유지 |
| `fc3abe6` post-pipeline degenerate scan | NaN normal 은 어느 계층에서도 무효 | 동일 | ✅ 유지 |
| `0c04ae1` non-manifold highlight (R1) | manifold 위반은 형태 계층에서도 HE chain 불안정 | v3.2 명제 4 manifold 조건 위반 — 특성 자격 없음 | ✅ 유지 |
| `52c42a0` `std::time` panic | WASM runtime — 무관 | 동일 | ✅ 유지 |
| `8f0fe38` free-edge dashed overlay | 형태 계층의 line vs face boundary 시각 구분 | 사용자 인지 향상 | ✅ 유지 |
| `0877913` ConstraintVisual snapshot-once | 무관 (성능 패턴) | 동일 | ✅ 유지 |

→ 어제 fix 들은 **두 계층 모델 하에서 모두 정당한 형태 계층 무결성 보장**.
"v3.2 명제 7 의 사후 구현" 이라는 ADR-048 §4.1 의 framing 은 부정확.
형태 계층의 자체 invariant 강화로 재해석.

---

## 2. Decision

### 2.1 두 계층 coexistence 동결

본 ADR 은 다음을 운영 anchor 로 동결:

- **현재 엔진의 모든 "XIA" = 형태 XIA**. 0 차원 허용은 의도된 동작.
- **v3.2 spec 의 "XIA" = 특성 XIA**. 재질 + 4조건 부여 시 형태 → 특성 승격.
- **두 계층은 별도 추상**. 형태 계층에 특성 계층의 제약 (재질 강제, 차원
  > 0 강제) 을 강요하면 Face/Line 의 본질을 부정하는 카테고리 오류.

### 2.2 v3.2 명제 ↔ 두 계층 매핑 (재정의)

| v3.2 명제 | 형태 계층 | 특성 계층 | 현재 엔진 상태 |
|---|---|---|---|
| **명제 1** Face 비-1급 | ✅ Face = 2D Boundary, 두께 0 자연 | ✅ Face 자체로는 특성 XIA 아님 (재질·두께 부여 시 승격) | ADR-019 일치 |
| **명제 2** Snap = 시스템 도구 | ✅ 형태 위에 직접 작동 | ✅ 특성 위에도 동일 작동 | SnapManager 정합 |
| **명제 3** Boundary 닫힘 본질 | ✅ Closed Loop / Surface 가 Boundary | (Boundary → 특성 승격은 별개 transition) | ADR-021/025 정합 |
| **명제 4** XIA 4조건 | (해당 없음 — 형태 XIA 는 자유) | 🔴 미구현 — 승격 메커니즘 없음 | **Phase 1 신규 작업** |
| **명제 5** Constraint | ✅ 형태 계층에 작용 | ✅ 특성 계층에도 작용 | Level 1/2/3 정합 |
| **명제 6** Reference 카테고리 | (Reference 는 별개 시민권 — 두 XIA 계층과 직교) | 동일 | 🔴 미구현 (Phase 3) |
| **명제 7** 위상 무결성 | ✅ 형태 계층의 manifold/closure 무결성 (어제 fix 들이 이 부분) | ✅ 특성 자격 유지 조건 | 부분 (사전 가드 미흡) |
| **§12** 가역/비가역 강등 | (해당 없음) | 🔴 미구현 — 승격/강등 메커니즘 없음 | **Phase 2 신규 작업** |
| **§13** 자산 라이브러리 | (해당 없음) | 🔴 부분 — MaterialLibrary 단일 계층 | Phase 5 |

### 2.3 새 Phase 로드맵 (ADR-048 §4 의 봐 좁아진 scope)

| Phase | 작업 | 비용 | 변화 |
|---|---|---|---|
| **0** | 본 ADR + ADR-048 amendment + LOCKED #26 | (완료) | 코드 변경 0 |
| **1** | 형태 → 특성 XIA 승격 API | 4-6h | 새 method `promote_to_property_xia(material, thickness)` + 4조건 검증. **형태 단계 차원 가드는 작아짐 — "특성 승격 시점에만" 검증** |
| **2** | 특성 → 형태 가역 강등 API | 4-6h | 재질만 제거, 형태 보존, 재질 임시 보존 |
| **3** | Reference 시민권 분리 | 1-2주 | Construction Line / Imported Mesh / (장기) Point Cloud |
| **4** | 특성 XIA 자동 차원-붕괴 강등 | 1주 | 부피 → 0 시 자동 강등 + 임계값 경고. **형태 계층 dimension 자체는 건드리지 않음** |
| **5** | 자산 라이브러리 3계층 + 자동 복구 | 수주 | v3.2 §12.3 자동 복구 + §13 시스템/프로젝트/사용자 |

**핵심 차이 (ADR-048 vs ADR-049)**:
- ADR-048 Phase 1: "차원 가드 — 모든 도구 입력 단계에서 reject" → **너무 큰 hammer**
- ADR-049 Phase 1: "특성 승격 시점에만 검증" → **외과적 정밀**

### 2.4 형태 계층의 자체 무결성 (어제 fix 들의 자리)

형태 계층은 0 차원 허용하지만 **위상적 무효** 는 차단해야 함:

| 형태 계층 자체 무결성 항목 | 현재 fix |
|---|---|
| 0-area face (3 vertex collinear, etc.) | `1cb1827` earcut empty auto-deactivate |
| NaN / zero-length normal | `fc3abe6` degenerate scan |
| HE chain stale (split_edge bug) | `ee066e3` Phase 7 cleanup scope-leak |
| Snap chain self-touch | ADR-047 P32 |
| RECT direction invariance | `6f6cd3e` |

→ 이들은 **v3.2 명제 7 의 사전 구현이 아니라 형태 계층의 자체 invariant**.
운영 정책: "형태 XIA 는 0 차원 허용하되, 위상이 깨지는 결과 (NaN normal /
HE 사슬 stale) 는 차단".

---

## 3. Consequences

### 3.1 코드 변경 측면 (긍정)

- **ADR-048 의 "Phase 1 차원 가드 (모든 도구)" 작업이 불필요해짐**. 사용자가
  radius=0 원을 그려도 형태 계층에선 정상.
- 어제 fix 들의 "v3.2 명제 7 사후 구현" framing 이 깨끗해짐 — 형태 계층의
  자체 invariant 로 명확히 분류.
- Phase 1 (승격 API) + Phase 2 (강등 API) 는 명확한 새 surface — 기존 도구
  영향 0.

### 3.2 코드 변경 측면 (부정 / 주의)

- "현재 엔진의 모든 XIA 가 default_material 자동 부여" 는 형태 계층 의미상
  잘못 — material 이 없는 게 자연. 향후 default_material 의 의미 재검토
  필요 (sentinel value? optional? Phase 1/2 와 같이).
- "Line XIA" 라는 이름 자체가 v3.2 의 "Linear XIA (특성)" 와 혼동 유발.
  내부 명명을 "Line Form" / "Linear Property" 로 분리하면 좋지만 큰 작업.
  Phase 3 시점에 검토.

### 3.3 정책/문서 측면 (긍정)

- LOCKED #1-#25 대부분이 **형태 계층 정책** 으로 깔끔히 분류 가능. 특성
  계층 정책은 LOCKED #26 (본 ADR 동결) 부터 추가.
- v3.2 spec 을 strict 적용해야 한다는 부담이 사라짐 — 두 계층 coexistence
  로 "엔진은 형태 책임, v3.2 strict 부분은 특성 계층 책임" 분리.

### 3.4 의사결정 이력 (긍정)

ADR-048 의 격차 진단도 amendment 로 보존됨. 미래 reader 가:
1. v3.2 spec 의 strict 모델이 첫인상에 자연스러웠다는 점
2. 도메인 전문가 (사용자) 의 "형태 vs 특성" 통찰이 결정을 한 단계 추상화시킨 점
3. 두 계층 coexistence 가 migration cost 를 격감시키는 결정인 점
을 학습.

---

## 4. Open Questions — **모두 결정 완료 (2026-05-03 사용자 세션)**

본 §4 의 Q1~Q5 는 작성 직후 사용자 인터뷰 세션을 통해 모두 답변됨.
아래는 final lock — 향후 Phase 1~5 ADR 의 spec 기반.

### Q1. 차원 임계값 — ✅ **확정**

```
특성 XIA 승격 조건 (v3.2 명제 4 strict):
  ✓ 재질 부여 (유일한 트리거)
  ✓ 부피 > 0 (Volumetric, strict — ε 없음)
  ✓ 단면 > 0 (Linear, strict)
  ✓ Watertight 닫힘
  ✓ Manifold 무결성

형태 (Shape): 일반 기하 형상 — 0 차원 자유 (Face 두께 0 자연)

수치 안정 floor: 없음. 사용자 의도 (`> 0` mathematical) 존중.
v3.2 §4.3 의 "1mm 경고" 는 별개 UX feature (Phase 4 자동 강등 시).
```

**근거**: 사용자 명시 — "재질이 부여되어야만 승격합니다", "0 보다 크면 됩니다", "재질과 부피가 있어야만 특성 XIA 로 승격되며, 그 이전의 형태는 일반적인 형상과 동일합니다".

### Q2. ADR-021 P7 stacked-inner 재설계 — ✅ **확정 (옵션 B 채택)**

```
새 정의 (canonical, ADR-006 multi-loop face 정책 복원):

  큰 RECT 안 작은 RECT
  → 큰 면 (Face A): outer loop + inner loop (작은 RECT 4 line) = ring-with-hole
  → 작은 면 (Face B): 작은 RECT 4 line 의 반대 방향 HE = simple face
  → 모든 edge = 2-face share = manifold ✓
  → 두 면 모두 특성 XIA 승격 가능 (manifold OK)

영향:
  - LOCKED #1 (ADR-021 P7) 변경 — 새 ADR (P7 supersede) 필요
  - 어제 R1 highlight (`0c04ae1`) 가 stacked-inner 영역에선 발동 안 함
  - non-manifold edge 0 → wireframe 시각 문제 사라짐
  - 회귀 테스트 (test_two_stacked_inner_rects_both_faced 등) 의미 재정의
```

**근거**: 사용자 명시 — "큰 RECT 의 면은 작은 RECT 로 구멍이 난 면이 생성되어야 합니다" (Copilot 분석 인용 포함).

### Q3. 명명 분리 — ✅ **확정 (옵션 A 채택)**

```
영문/코드:
  Shape (형태)  — 일반 기하 (재질 없음)
  Xia (특성)    — v3.2 strict (재질 + 부피 + 닫힘 + manifold)

한국어 UI:
  형태 — 재질 없음
  XIA — 재질 + 부피 (= v3.2 정식)

코드 type:
  pub struct ShapeId(u32);  pub struct Shape { ... }   // 형태 계층
  pub struct XiaId(u32);    pub struct Xia { ... }     // 특성 계층

마이그레이션: Phase 1 작업과 함께 단일 PR (회귀 테스트로 보장)

사용자 facing: 재질 없는 단계엔 "XIA" 단어 노출 안 함
```

**근거**: 사용자 명시 — "형태 XIA 는 이제 일반 형태로 명명되어야 혼선이 없을것 같습니다".

### Q4. default_material 폐지 — ✅ **확정 (Q1 + Q3 자동 귀결)**

```
default_material 자동 부여: 폐지

Shape:
  - material 필드 없음 (개념 부재)
  - 순수 기하

Xia (v3.2 strict):
  - primary_material: Material  (정의상 필수, Option 아님)
  - face_materials: HashMap<FaceId, Material>  (override, 다중 마감 지원)
```

**근거**: Q1 (재질 트리거) + Q3 (Shape vs Xia type split) 의 자연 귀결 +
사용자 Q4.5 답변 — face-level material 호환성 유지 + Xia 의 primary_material.

### Q5. 강등 정책 — ✅ **확정 (옵션 A — v3.2 §12 strict)**

```
사건 1 (재질 제거 — 가역 강등):
  → Shape 로 즉시 강등 (geometry 보존)
  → 5초 알림 Toast: "재질 제거됨 — Shape 로 강등 [되돌리기]"
  → 재질 자동 임시 보존 (세션 스코프, v3.2 §12.6.1)
  → Undo 가능

사건 2-4 (위상 손상 — 비가역 강등):
  → 자동 복구 시도 (v3.2 §12.3.1):
      ✓ 한 Edge 누락 → 인접 vertex 직선 연결
      ✓ 한 Face 누락 → 평면 자동 생성
      ✓ 작은 hole (≤ 4 edges) → 자동 닫음
      ✓ Vertex 미세 어긋남 → LOCKED #5 1.5μm dedup
  → 자동 복구 NO (v3.2 §12.3.2):
      ✗ 다중 Face 누락
      ✗ 큰 hole (≥ 5 edges)
      ✗ 자기 교차
      ✗ Manifold 위반
      ✗ Linear XIA 중심선 끊김
  → 자동 복구 성공: 5초 알림 + 노란 점선 highlight 30초 (v3.2 §12.4.2)
  → 자동 복구 실패: 작업 중단 + 다이얼로그 (v3.2 §12.5):
      [작업 취소 (Undo)]
      [강등 수락 (Accept Demotion)] — 재질 라이브러리 저장 여부 확인
      [수동 수정 (Manual Repair)] — 편집 모드 진입

비활성화 옵션 (v3.2 §12.4.5):
  Settings 에서 "자동 복구 시도 안 함" → 모든 손상이 사용자 결정으로
```

**근거**: 사용자 명시 — "(A) 권장 그대로 — v3.2 §12 strict 따름".

### 결정 종합

5개 Q 모두 확정되어 Phase 1 (ADR-050) 의 spec 이 구체화됨. 다음 세션의
구현 작업은 다음 단위로 분리 권장:

1. **ADR-050** — Form/Property type split + Phase 1 promote API + face-
   level material policy (Q3 + Q4 + Q1 의 일부)
2. **ADR-051** — ADR-021 P7 supersede (Q2)
3. **ADR-052** — Phase 2 demote API (Q5 의 사건 1)
4. **ADR-053** — Phase 3 Reference 시민권
5. **ADR-054** — Phase 4 자동 강등 + 알림 + 복구 (Q5 의 사건 2-4)
6. **ADR-055+** — Phase 5 자산 라이브러리 등

**ADR-050 + ADR-051 이 함께 가야 정합** — Phase 1 promote 가 P7 재설계
이후의 manifold 검증을 가정하기 때문. 단일 PR 또는 sequential PR 권장.

---

## 4.5 Amendments

### Amendment 1 (2026-05-09) — Three-Layer Extension (보고서 P2 High)

ADR-095 가 본 모델을 **Three-Layer Citizenship Model** 로 확장:

- **Form (Shape)** — 기하학적 추상 (본 ADR §1.2 형태 계층)
- **Property (Xia)** — 부재 정체성 (material + volume/section > 0 +
  watertight + manifold 4-조건, 본 ADR §1.2 특성 계층)
- **Reference (NEW)** — Construction line / Imported mesh / Point cloud
  (외부 / 작도, *수정 안 함*)

세 시민권은 **mutually exclusive geometry ownership** (mathematical
orthogonality, disjoint union). LOCKED #26 메타-원칙 #2 ("외부 참조는
형태/모양만") 의 architectural 정착.

세부: `docs/adr/095-reference-citizenship-introduction.md` 참조.

### Amendment 2 (2026-05-09) — Phase 5 sub-track 분리 (보고서 P2 High)

본 ADR §2.3 의 Phase 5 (자산 라이브러리 3계층 + Layered material) 가
ADR-098/099/100 **3 sub-track** 으로 분리:

- **Phase 5-A** (ADR-098) — Asset Library 3-Tier Material Scope
  (System / Project / User)
- **Phase 5-B** (ADR-099) — Layered Material (4-PBR Channels: albedo /
  normal / roughness / metallic)
- **Phase 5-C** (ADR-100) — Material Removal Recovery (auto-demote
  → fallback Concrete → escalate dialog)

번호 시퀀스 정정: 본 ADR §2.3 의 "Phase 5+: ADR-055+" 표기 → 실제
**ADR-098/099/100** (인접 ADR 충돌 회피). 모두 ✅ Closed (2026-05-09 ~
2026-05-10).

🎉 **LOCKED #26 Two-Layer Citizenship Model 5-Phase 완전 closure**
(2026-05-10) — CLAUDE.md LOCKED #39 참조.

### Amendment 3 (2026-05-21) — 4-조건 mathematical 정형화 (보고서 P5 High)

본 ADR §1.2 특성 계층의 4-조건 (material + volume > 0 + watertight +
manifold) 의 학술적 정형화:

```
Xia 승격 조건 (정형):
  (material assigned)
  ∧ (volume > ε_volume_floor  OR  cross_section_area_in_normal_plane > ε_section_floor)
  ∧ (∂M = ∅)                    // watertight = closed manifold without boundary
  ∧ (∀ edge e: |faces(e)| = 2)  // 2-manifold edge-side (ADR-051 P7-M1)
  ∧ (∀ vertex v: link(v) ≃ S¹)  // 2-manifold vertex-side (future P7-M4, 보고서 P7)
```

**조건별 정형 명시**:
- `material`: set membership (MaterialLibrary 에 등록된 비-FORM_MATERIAL)
- `volume > ε_volume_floor`: 3D solid 의 경우. ε_volume_floor 는 numerical
  underflow 방지 (1e-300 underflow 회피, ADR-007 winding 정합 검증)
- `cross_section_area > ε_section_floor`: Linear XIA (column / beam) 의
  경우. **기준 평면 = curve normal-plane** (boundary curve 의 local
  Frenet frame normal vector 직교 평면). 0-area degeneracy 방지.
- `watertight = ∂M = ∅`: closed manifold without boundary. Möbius / Klein
  bottle 은 boundary 없으나 비-orientable — orientable 추가 강제 가능
  (보고서 P7 vertex link circle invariant 와 함께)
- `manifold (edge-side)`: ADR-051 P-1 verify_p7_manifold P7-M1 invariant
  (모든 edge 가 정확히 2 face 공유). P7-M2 / P7-M3 도 함께 검증.
- **manifold (vertex-side)** — *현재 누락 invariant* (보고서 P7 Medium):
  vertex 주변 face fan 의 link circle 검사. ADR-022 P9 (1-vertex pinch
  auto-promote) 는 link circle 위배 케이스를 허용 — 학술적 strictness
  위해 별도 invariant (가칭 P7-M4) 추가 검토.

**watertight ⇒ manifold-without-boundary** 부분 동치이나 *완전 동치 아님*:
- watertight = closed (∂M = ∅) 만 의미
- manifold = local Euclidean structure (모든 점의 neighborhood 가 disk
  or half-disk 와 homeomorphic)
- 두 조건 모두 필요 — watertight 만 만족하고 non-manifold 인 mesh 가능
  (예: pinch vertex, edge-3-share 등)

### Amendment 4 (2026-05-21) — 학술적 정밀화 cross-link (보고서 §3 High)

본 ADR §1.2 "Form 0 차원" 진술의 학술적 분리 명시:
- **Face 두께 0** = embedding codimension 의미 (R³ embedded 2-manifold,
  topology dimension 은 여전히 2)
- **Vertex 0 차원** = intrinsic dimension 의미 (0-cell)
- 두 개념 (codim 0 vs intrinsic dim 0) 학술적 분리 — Form 의 정형 명시:
  *"Form 은 codim ≥ 1 entity 를 차원 invariant 위배 없이 표현"*

---

## 5. References

- ADR-048 (격차 진단 — supersede 됨, 이력 보존)
- AixxiA Design Specification v3.2 (`D:\1. 도구의시작\AixxiA_Design_Specification_v3.2.docx`)
- ADR-007 / ADR-019 / ADR-021 / ADR-025 — 모두 형태 계층의 정책으로 재분류
- ADR-046 P31 (Product Identity) — 두 계층 모두 P1+P3 페르소나 지원
- ADR-095 (Reference 시민권 introduction) — Amendment 1 source
- ADR-097 (Topology Damage Auto-Recovery) — Phase 4
- ADR-098 (Asset Library 3-Tier) — Phase 5-A
- ADR-099 (Layered Material 4-PBR) — Phase 5-B
- ADR-100 (Material Removal Recovery) — Phase 5-C
- ADR-050 / ADR-051 — Phase 1 (Shape/Xia type split + P7 strict reaffirmation)
- ADR-091 — Phase 2 (Material removal demote)
- ADR-139 — Boundary tool + Auto-cycle Deprecation (LOCKED #64 정합)
- 보고서: `reports/엔진_개념_이론_검토_보고서.html` §3 시민권 모델 학술적 완전성
- 어제 세션 (2026-05-02) commits: `52c42a0`, `1cb1827`, `fc3abe6`, `0c04ae1`,
  `0877913`, `8f0fe38`, `6f6cd3e` — 모두 **형태 계층 자체 invariant 강화**

---

## 6. Acceptance Criteria

- [x] 두 계층 모델 (형태 / 특성) 이 §1.2 에 명문화됨
- [x] v3.2 명제 ↔ 두 계층 매핑 표 (§2.2) 작성됨
- [x] ADR-048 Phase 1~5 의 좁아진 scope (§2.3) 정의됨
- [x] 어제 세션 fix 들이 형태 계층 invariant 임을 §2.4 에 명시
- [x] Open Questions 가 두 계층 모델로 재구성됨
- [x] ADR-048 amendment + supersede 표시 완료
- [x] CLAUDE.md LOCKED #26 ADR-049 로 운영 anchor 갱신
- [ ] **코드 변경 0** — 본 PR 은 문서만

---

*Author*: AXiA team (사용자 v3.2 spec + 형태/특성 reframe + Claude
synthesis) | *Status*: Phase 0 — accepted, no code change. **canonical
operating anchor**. Phase 1 ~ ADR-050 (예정)
