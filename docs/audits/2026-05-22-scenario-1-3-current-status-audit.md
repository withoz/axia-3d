# 시나리오 1/3 Current Status Audit (보고서 적용 사전 검토)

**Date**: 2026-05-22
**Author**: WYKO + Claude
**Trigger**: `reports/입력보정파이프라인_적용계획.html` §4 Phase 0
  K3/K1 hotfix 권장의 *현재 demo-breaking 여부* 검증
**Source 보고서**: `reports/면생성_보고서.html`
**Path Z position**: ADR-139 B-γ MVP closure (PR #138) → **본 audit** →
  hotfix 진행 여부 결재

## 1. 목적

보고서 (`입력보정파이프라인_적용계획.html`) 가 Phase 0 K1/K3 hotfix 로
권장한 시나리오 1 + 3 이 **현재 main 에서 여전히 demo-breaking** 인지
audit. ADR-107/110 자연 해소 가능성도 동시 검증.

## 2. 시나리오 1 — Circle 위 Line 면 분할 (CRITICAL)

### 2.1 보고서 finding

보고서 (`면생성_보고서.html`) §시나리오 1:
> 5 함수가 polygon ≥3 verts 가정 — Path B closed-curve face (1 anchor +
> 1 self-loop edge) 통과 시 silent functional failure.

명시된 5 함수:
- `face_split.rs:332-364`
- `mesh.rs:1570-1574`
- `mesh.rs:3775-3900`
- `face_split.rs:60-101`

### 2.2 ADR-107 자연 해소 가능성 audit

**ADR-107 (`*AsShape` → Path B canonical, ζ-β engine dispatch)**:
- 사용자 통찰: "메시 곡면과 기하 원의 곡면이 동시에 작용"
- ζ-β engine dispatch (threshold POLYGON_THRESHOLD=12):
  - segments >= 12 → **Path B 자동 변환** (Circle approximation)
  - < 12 → legacy polygon (DrawPolygon use case 보존)

**자연 해소 분석**:
- Circle (segments 기본 32+) → Path B 자동 변환
- Path B Circle = 1 anchor + 1 self-loop edge with AnalyticCurve::Circle
- **Line 그리기 시 Path B circle 의 self-loop edge 와 교차** → split 함수
  진입
- 5 함수가 polygon ≥3 verts 가정 → **silent failure 여전히 발생** ⚠

**결론**: ADR-107 의 *Layer Separation Policy* 가 자연 *완화* 했지만
**근본 해소 안 됨**. Path B circle (segments=1, self-loop) 이 split 입력
으로 들어오면 여전히 5 함수의 polygon 가정 break.

### 2.3 현재 status

- `tessellate_closed_curve_face_in_place` 등 dispatch helper 가 ADR-105
  (가칭, 본 세션 ADR-106) 에서 추가되었지만, **split 5 함수 자체의
  polygon 가정** 은 그대로
- **시나리오 1 여전히 demo-breaking** 확정 ⚠

## 3. 시나리오 3 — Push/Pull 후 owner-ID 손실 (HIGH)

### 3.1 보고서 finding

보고서 §시나리오 3:
> 6 split sites 에서 `face_to_surface_owner_id` propagation 부재 (1-liner ×6).
> Push/Pull 결과 cylinder 측면 group 클릭 시 N-1 face 만 선택.

명시된 6 사이트:
- `split_face_by_chain` — `face_split.rs:717-729`
- `case_b` — `face_split.rs:1034-1045`
- `case_c` — `face_split.rs:1271-1277`
- `case_d` — `face_split.rs:1472-1478`
- `split_face` — `mesh.rs:4088-4170`
- `split_faces_by_intersections` — `boolean.rs:522-551`

### 3.2 현재 status audit

**main 검증 결과**:
```bash
grep -rn "face_to_surface_owner_id" crates/axia-geo/src/operations/
# → face_split.rs: 0 매치
# → mesh.rs: storage + accessor (mesh_owner_ids.rs:130-156)
# → create_solid.rs: 5 매치 (Path B annulus 할당 only)
```

**핵심 finding**: split sites (face_split.rs / mesh.rs split_face /
boolean.rs split_faces_by_intersections) 모두 **`face_to_surface_owner_id`
propagation 부재** — 보고서 정확.

ADR-110 (Provenance) 가 CommandId propagation 은 추가했지만 *surface
owner_id* 는 별개 자료. Provenance 와 surface owner_id 가 다른 layer.

**시나리오 3 여전히 demo-breaking** 확정 ⚠

### 3.3 fix scope (1-liner × 6)

각 split site 에서 parent face 의 `face_surface_owner_id(face_id)` 조회 →
새 sub-face 에 `set_face_surface_owner_id` 호출:

```rust
// face_split.rs:717-729 (split_face_by_chain) 예시
let parent_owner = mesh.face_surface_owner_id(face_id);  // NEW
// ... existing soft_remove + add_face_with_holes
if let Some(owner) = parent_owner {
    mesh.set_face_surface_owner_id(fa, Some(owner));  // NEW
    mesh.set_face_surface_owner_id(fb, Some(owner));  // NEW
}
```

ADR-089 A-χ-β (parent surface propagation) 패턴 답습. 각 사이트 ~3 lines.

## 4. ADR-107/110 영향 분석

### 4.1 ADR-107 (Layer Separation Policy)

| 영향 영역 | 보고서 권장 | 자연 해소? |
|---|---|---|
| 시나리오 1 (Circle+Line split) | 5 함수 polygon 가정 해소 | ❌ ADR-107 *완화* 하나 *근본 해소 안 됨* |
| 시나리오 3 (owner-ID 손실) | 6-site propagation | ❌ ADR-107 영향 없음 (별개 layer) |

### 4.2 ADR-110 (Provenance)

| 영향 영역 | 보고서 권장 | 자연 해소? |
|---|---|---|
| 시나리오 1 | polygon 가정 해소 | ❌ ADR-110 영향 없음 (CommandId vs polygon) |
| 시나리오 3 | owner-ID propagation | ⚠ ADR-110 가 CommandId propagation 추가, 하지만 `face_to_surface_owner_id` 는 별개 자료 |

### 4.3 결론

**시나리오 1 + 3 모두 현재 main 에 hotfix 미적용 — 여전히 demo-breaking**.
ADR-107/110 의 자연 해소 효과는 *부분적* — 시나리오 1 은 완화, 시나리오
3 은 영향 없음.

## 5. 권장 plan

### 5.1 시나리오 3 hotfix (K3, 보고서 권장)

**난이도**: 낮음 (1-liner × 6)
**가치**: 큰 (Path A cylinder UX, 메뉴 클릭 cylinder 측면 group 전체 선택)
**위험**: 낮음 (additive only, ADR-089 A-χ-β 패턴 답습)

**Plan**:
- 6 split sites 에 `face_to_surface_owner_id` propagation 추가
- 각 사이트 1-3 lines (parent 조회 + 자식 set)
- 회귀 추가: cylinder 측면 group full-selection test
- ~2-3시간 atomic

### 5.2 시나리오 1 hotfix (K1, 보고서 권장)

**난이도**: 중간 (5 함수 polygon 가정 분기 추가)
**가치**: 매우 큰 (demo-breaking 해소)
**위험**: 중간 (5 함수 cross-cut, 회귀 자산 영향 audit 필요)

**Plan**:
- ADR-140 (가칭, 보고서의 ADR-101 → 번호 정정) spec 작성
- 5 함수에 Path B closed-curve face 분기 추가:
  - `face_id` 가 `is_closed_curve_face(mesh, face_id)` ✓ → tessellate
    helper 호출 → polygon mode 재진입
- 회귀 추가: Circle (Path B) × Line split tests
- ~1-2일 atomic

### 5.3 ADR 번호 정정

보고서 §6 K1/K2 의 ADR 번호 (ADR-101/102) 가 **이미 main 에 사용 중**.
신설 ADR 은 ADR-140+ 부터:

| 보고서 | 정정 |
|---|---|
| ADR-101 (closed-curve split) | **ADR-140** (가칭) |
| ADR-102 (4단계 anchor) | **ADR-141** (가칭) |
| ADR-103 (T-junction) | **ADR-142** (가칭) |
| ADR-104 (auto coplanar) | **ADR-143** (가칭) |
| ADR-105 (P7-M4/M5 + Euler) | **ADR-144** (가칭) |
| ADR-106 (best-fit plane) | **ADR-145** (가칭) |
| ADR-107 (Mesh::heal) | **ADR-146** (가칭) |
| ADR-108 (Scenario B1) | **ADR-147** (가칭) |

## 6. Audit Conclusion + 다음 trigger

### 6.1 핵심 결론

- **시나리오 1 + 3 모두 현재 demo-breaking 확정** (main 에 hotfix 미적용)
- **ADR-107/110 자연 해소 효과 부분적** — 시나리오 1 완화 / 시나리오 3 영향 0
- **K3 (시나리오 3 hotfix) 1-liner × 6** — 가장 저비용 고가치, **즉시
  진행 가능**
- **K1 (시나리오 1 hotfix) ~1-2일** — ADR-140 spec 작성 후 진행

### 6.2 권장 진행 순서 (LOCKED #44 정합)

1. **K3 시나리오 3 hotfix** — 6 split sites propagation (1 atomic PR, ~2-3시간)
2. **K1 시나리오 1 hotfix** — 5 함수 Path B 분기 (1 ADR + 1 PR, ~1-2일)
3. **ADR 번호 정정** — 보고서의 ADR-101~108 → ADR-140~147 재명명 docs (1 PR)

### 6.3 보고서 plan 의 valid 가치 (재확인)

| 항목 | Status |
|---|---|
| 4단계 파이프라인 architectural anchor | ✅ Valid (ADR-141 가칭) |
| Step 4 P7-M4/M5 + Euler/Genus | ✅ Valid (ADR-049 Amendment 3 정합) |
| Step 4 Mesh::heal 통합 entry | ✅ Valid (ADR-097 5-layer mirror) |
| Step 4 best-fit plane SVD | ✅ Valid (import 정합) |
| Step 2 B1 spatial-hash 1μm→0.1μm | ✅ Valid (정밀도 10×) |
| ADR-139 시너지 vision | ✅ Valid ("Boundary tool 호출 시 4단계 자동 적용") |

## 7. Lock-ins (audit 정책)

- **L-Audit-1** 시나리오 1 + 3 모두 현재 demo-breaking 확정 (main hotfix
  미적용)
- **L-Audit-2** ADR-107/110 자연 해소 효과 부분적 (시나리오 1 완화 /
  시나리오 3 영향 0)
- **L-Audit-3** K3 (시나리오 3 hotfix) 가장 저비용 고가치 — 즉시 진행 가능
- **L-Audit-4** ADR 번호 정정 강제 (보고서의 ADR-101~108 → ADR-140~147)
- **L-Audit-5** Audit-first canonical 11번째 후 본 12번째 적용
- **L-Audit-6** 절대 #[ignore] 금지

## 8. Cross-link

- 보고서: `reports/면생성_보고서.html` (시나리오 1/3 source)
- 보고서: `reports/입력보정파이프라인_적용계획.html` (Phase 0 K1/K3 권장)
- ADR-139 (Boundary tool — LOCKED #64)
- ADR-107 (Layer Separation Policy)
- ADR-110 (Provenance)
- ADR-089 A-χ-β (parent surface propagation 패턴 답습)
- 메타-원칙 #14 (WHAT 결과) / #16 (WHEN trigger)

## 9. Acceptance Log

- **2026-05-22 audit** (본 commit) — 시나리오 1 + 3 의 current status
  audit. ADR-107/110 자연 해소 가능성 검증 → 부분적 (시나리오 1 완화 /
  시나리오 3 영향 0). K3 hotfix 즉시 진행 가능, K1 hotfix ADR 작성 후
  ~1-2일.
- **(다음 단계)** — K3 시나리오 3 hotfix 진행 또는 세션 저장.
