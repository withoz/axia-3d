# ADR-066 — Multi-face NURBS Boolean Dispatch (Path Y)

**Status**: Y-1 진입 (Path Y atomic, 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-064 §E.2 (Multi-face Boolean — 별도 ADR 미착수 항목)
**Parent**: ADR-064 Path Z 전 stack 완료 (`03fb6e8`)
**Prerequisites**: `Mesh::boolean_dispatch_dcel` (single-face × single-face,
ADR-064 Step 5), `Mesh::nurbs_boolean_to_dcel` (Step 4).

---

## 0. Summary (4 lines)

> ADR-064 의 single-face dispatcher 위에 multi-face × multi-face
> dispatch 를 쌓는 트랙. Y-G=(a) cartesian 단순 조합 + Y-H=(c)
> skip-and-warn + Y-I=(b) per-pair safe-only removal 의미론. Y-1 =
> Rust API 골격 atomic. Y-2~Y-6 별도 sub-step.

---

## 1. Context

ADR-064 Path Z 가 single-face × single-face 만 처리. 사용자 multi-face
selection 시 `BooleanHandler` 가 selection 을 반/반 split → 기존 mesh
boolean 호출. NURBS-aware multi-face dispatch 미존재.

### 1.1 ADR-064 §E.2 의 미해결 항목

> `boolean_dispatch_dcel` 의 Path Z 는 single-face × single-face 만
> 처리. multi-face operand 는 `eligibility = MultipleFacesNotSupported`
> 로 `pathUsed = Mesh` 반환.

### 1.2 사용자 가치

- **P1 (사용자)**: 여러 면 선택 → NURBS Boolean 직접 동작.
- **P3 (AI agent)**: multi-face Boolean API 사용 가능.
- **Press-Pull (ADR-067)**: 다면 extrude + Boolean 결합 시 직접 dispatch.

---

## 2. Decision — Y-총체 scope + 9개 Y + 4 Lock-in

### 2.1 §A — Y-1 scope

**채택 (Y-1 atomic)**:
- `Mesh::boolean_dispatch_dcel_multi(facesA, facesB, op, tol)` Rust API
- Cartesian pair iteration (Y-G=(a))
- Eligibility 검사 = 모든 face 가 `surface_to_bspline` 통과 (Y-E=(a))
- Per-pair Err → warning 누적 + skip (Y-H=(c))
- Per-pair Ok → `removed_faces` / `new_faces` 누적 (Y-I=(b))
- Single-face × single-face degenerate → Path Z `boolean_dispatch_dcel`
  delegation
- `BooleanDispatchDcelMultiResult` 신규 result type
- 기존 `boolean_dispatch_dcel` UNCHANGED (D-P / Y-D 일관)

**제외 (Y-2~Y-6 별도 sub-step)**:
- Y-2: WASM bridge (multi JSON export)
- Y-3: TS bridge typed wrapper
- Y-4: BooleanHandler.ts UI 통합 (selection split 정책 변경)
- Y-5: Undo cross-method 계약 검증
- Y-6: 회고 / docs

### 2.2 §B — 9개 Y 결정

| Y | 결정 | 비고 |
|---|------|------|
| **Y-A** | ADR-066: Multi-face NURBS Boolean Dispatch | 자연 번호 |
| **Y-B** | (b) Y-1 only (atomic Path Z 답습) | sub-step 분할 |
| **Y-C** | (a) 새 method `boolean_dispatch_dcel_multi` | drop-in alongside |
| **Y-D** | 기존 Path Z method UNCHANGED | 회귀 0 |
| **Y-E** | (a) 모든 face NURBS 부착 (strict) | 의미론 명확 |
| **Y-F** | (a) caller 명시 (`facesA: &[FaceId]`, `facesB: &[FaceId]`) | 기존 시그니처 정합 |
| **Y-G** | (a) Cartesian (N×M pairs) | atomic 단순 형태, (b)/(c) 별도 ADR |
| **Y-H** | (c) skip-and-warn | per-pair Err → 보존 + 누적 |
| **Y-I** | (b) per-pair safe-only removal | 성공 pair 의 face 만 제거 |

### 2.3 §C — 4 Lock-in

```
1. Y-1 = Rust API only. WASM/UI/Undo (Y-2~Y-5) 별도 sub-step.

2. Drop-in alongside — 기존 boolean_dispatch_dcel UNCHANGED.
   Path Z 자산 (Step 5) 보존.

3. Cascade 시맨틱 (자연스러운 결과):
   Subtract(a, b1) 가 a 제거 → 후속 (a, b2) 는 InactiveFace Err
   → Y-H=(c) warning 으로 captured. Y-3/Y-4 에서 재논의 가능.

4. Single-face × single-face degenerate → Path Z method 직접 위임
   (per_pair[0] 만 채워짐). 이중 진입점 회피.
```

---

## 3. Acceptance — Y-1

### 3.1 Y-1 scope

```rust
pub struct PerPairDcelOutcome {
    pub face_a: FaceId,
    pub face_b: FaceId,
    pub result: Result<NurbsBooleanDcelResult, String>,  // Err = warning
}

pub struct BooleanDispatchDcelMultiResult {
    pub path_used: BooleanPath,
    pub fallback_reason: Option<NurbsBooleanFailReason>,
    pub per_pair: Vec<PerPairDcelOutcome>,
    pub all_new_faces: Vec<FaceId>,        // aggregate (deduped)
    pub all_removed_faces: Vec<FaceId>,    // aggregate (deduped)
    pub warnings: Vec<String>,
}

impl Mesh {
    pub fn boolean_dispatch_dcel_multi(
        &mut self,
        faces_a: &[FaceId],
        faces_b: &[FaceId],
        op: BoolOp,
        tol: BooleanTolerance,
    ) -> Result<BooleanDispatchDcelMultiResult>;
}
```

### 3.2 Y-1 회귀 (5, 절대 #[ignore] 금지)

1. `multi_face_dispatch_eligible_2x2_subtract_succeeds` — 정상 cartesian
2. `multi_face_dispatch_one_missing_surface_routes_mesh_path` — Y-E strict
3. `multi_face_dispatch_single_face_fallback_to_path_z` — degenerate 1×1
4. `multi_face_dispatch_per_pair_safe_only_preserves_when_all_disjoint` —
   Y-H/Y-I, 모두 disjoint → 보존
5. `multi_face_dispatch_drop_in_alongside_path_z_unchanged` — Y-D 회귀

---

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 회귀 (예상) |
|----------|------|------------|
| Y-1 | Rust API 골격 + cartesian dispatch | 5 |
| Y-2 | WASM bridge (`booleanDispatchDcelMultiJson`) | 4 |
| Y-3 | TS bridge typed wrapper | 5 |
| Y-4 | BooleanHandler.ts UI 통합 | 5 |
| Y-5 | Undo cross-method 계약 (multi) | 4 |
| Y-6 | 회고 / docs | 0 |
| **합계 (예상)** | — | **~23** |

---

## 5. References

- ADR-064 Path Z 전 stack 완료 (`03fb6e8`)
- ADR-064 §E.2 Multi-face Boolean (Path Y 별도 ADR — 본 ADR-066)
- `Mesh::boolean_dispatch_dcel` (ADR-064 Step 5)
- `Mesh::nurbs_boolean_to_dcel` (ADR-064 Step 4)

---

*Author*: AXiA team (Path Y 사용자 결정 2026-05-04)
*Status*: Y-1 implementation 진행 중
