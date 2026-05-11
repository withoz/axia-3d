# ADR-060 — Phase O: Tools NURBS-aware (Migration Phase)

**Status**: Accepted (사용자 사전 검토 + 6 lock-in fix 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase O, 8주, 위험: **매우 고**)
**Parent**: ADR-052 §2.3 Phase O
**Prerequisites**: Phase H/I/J/K/L/M/N 모두 완료 (각각 ADR-053~059)
**Related**: ADR-019 (Line is Truth), ADR-027 (NURBS Kernel),
ADR-061 (Phase P Tessellation Cache — 후속)

---

## 0. Summary (4 lines)

> Phase N 이 데이터 layer 를 준비. Phase O 는 도구가 그 데이터를 실제로
> 사용 — translate/Push-Pull/Boolean/Fillet 가 NURBS-aware 로 마이그레이션.
> 6-step incremental + 6 영구 lock-in (Partial-move drop / WASM additive
> / Boolean dispatch / Tool 순서 / Performance budget / 8주 분할) 강제.

---

## 1. Context — "The Migration Phase"

### 1.1 본질 정의

```
Phase N: 데이터가 준비됨           ← 모든 edge.curve / face.surface 보장
Phase O: 도구가 그 데이터를 사용  ← translate / push-pull / boolean / fillet
Phase P: 성능/캐시 최적화          ← Lazy tessellation
```

Phase O 는 "기능 구현" 이 아니라 **"이행(Migration)"**. 이 관점이 모든 위험
인식의 anchor.

### 1.2 Phase N 의 Migration safety net 활용

Phase N 의 `migrate_v3_to_v4_with_sanity()` (drift > LOCKED #5 → Line 강등)
이 Phase O 의 stale state 도 catch. 단:
- 도구 호출 직후 즉시 stale 가능 → 매 도구가 자체적으로 처리해야 함
- migration 은 load 시점 only — 런타임 stale 차단은 도구 책임

---

## 2. Decision — 6 step + 6 영구 lock-in

### 2.1 §A — 6-step 분할 (8주, Big-bang 금지)

| Step | 영역 | 기간 | 회귀 | 위험 |
|---|---|---|---|---|
| 1 | `translate_verts` curve transform | 1주 | 6 | 중 |
| 2 | `rotate_verts` / `scale_verts` | 1.5주 | 8 | 중 |
| 3 | `push_pull` BRep extrusion | 1.5주 | 8 | 중 |
| 4 | `Boolean` dispatch (NURBS default + mesh fallback) | 2주 | 14 | **매우 고** |
| 5 | Fillet / Chamfer production migration | 1주 | 10 | 고 |
| 6 | WASM bridge additive-only API | 1주 | 6 | 중 |
| **합계** | — | **8주** | **52** | — |

각 step:
- 사전 회귀 측정
- 단일 목적 commit
- 사용자 사인-오프 후 다음 step 진입

### 2.2 §B — Drop-in alongside pattern (Phase M/N 검증)

```
production code path UNCHANGED at first
새 NURBS path 가 옆에 alongside (Step 1-5)
debug_assert! 로 두 path agreement 검증
사용자 사인-오프 후 default path 전환
```

### 2.3 §C — Performance budget

```
Hot path (Move tool 1000-vert drag):
  Phase N baseline: ≤ 0.1ms / frame
  Phase O target:   ≤ 0.15ms / frame (+50% for curve transform)

Cold path (Boolean 1000 face mesh):
  Phase N baseline: 50-200ms
  Phase O target:   ≤ 250ms (+25%)

회귀 추가 (각 step 별):
  bench_translate_verts_with_curves
  bench_push_pull_with_surface
  bench_boolean_dispatch_overhead
```

### 2.4 §D — WASM additive only (TS/JS 호환성)

```
✅ 기존 export 시그니처 UNCHANGED:
   getMeshBuffers / getXiaInfo / getDeltaBuffers / etc.
✅ 신규 endpoint 추가만 (opt-in):
   getEdgeCurveJson(eid) → JSON | null
   getFaceSurfaceJson(fid) → JSON | null
   migrateCurveSurfaceMandatory() → migration report JSON
❌ 기존 export 변경 / 추가 필드 / serialization 변형 금지
```

TS/JS 측 100% 호환. 새 기능 채택은 사용자 코드 변경 시.

### 2.5 §E — Partial-move 정책 (drop to Line)

가장 critical 결정:
```rust
// translate_verts(verts, delta):
let moved_set: HashSet<VertId> = verts.iter().copied().collect();
for vid in verts { mesh.verts[vid].pos += delta; }

for eid in affected_edges {
    let edge = &mesh.edges[eid];
    let v_small_moved = moved_set.contains(&edge.v_small);
    let v_large_moved = moved_set.contains(&edge.v_large);

    match (v_small_moved, v_large_moved) {
        (true, true)   => apply_curve_transform(eid, delta),
        (false, false) => /* no-op */,
        _              => mesh.edges[eid].set_curve(None),  // safe Line fallback
    }
}
```

**근거**: 곡선 보존 시도 = drift = 잘못된 결과. Line fallback = 안전한 열화.

### 2.6 §F — Boolean dispatch enum

```rust
pub enum BooleanPath {
    Mesh,                      // current default
    Nurbs,                     // both faces have surface
    NurbsWithMeshFallback,     // NURBS attempted, fell back
}

pub struct BooleanResult {
    pub result: Mesh,
    pub path_used: BooleanPath,
    pub fallback_reason: Option<NurbsBooleanFailReason>,
}
```

silent fallback 절대 금지. Phase J §7.5 패턴 완전 적용.

### 2.7 §X.5 — 6 영구 Lock-in

```
1. Partial-move → drop to Line  (가장 중요)
   변경 시 새 amendment + drift sanity 재검증

2. WASM additive only (기존 export 0 변경)
   변경 시 새 amendment + TS/JS 호환성 검증

3. Boolean dispatch 결과 명시 (BooleanPath enum)
   silent fallback 금지 — Phase J §7.5 패턴

4. Tool migration 순서 강제
   translate → rotate/scale → push-pull → boolean → fillet → wasm
   순서 위반 시 cascade stale state 발생

5. Performance budget (≤+50% hot / ≤+25% cold)
   bench 회귀 + 매 step 측정

6. 6-step incremental (8주 분할)
   Big-bang 금지, 각 step 별 사인-오프 prerequisite
```

---

## 3. Acceptance + 위험 완화

### 3.1 Step 1 (translate_verts) Acceptance

- [ ] Per-edge classification (both/none/partial) 작동
- [ ] Both case: curve.transform(translation) 호출, kind 보존
- [ ] Partial case: set_curve(None), drift sanity 통합
- [ ] None case: no-op
- [ ] Per-face surface classification (전 outer verts 이동 / 부분)
- [ ] 851 + 6 = 857 회귀 통과
- [ ] bench_translate_verts_with_curves ≤ 0.15ms/frame

### 3.2 위험 완화 매트릭스

| 위험 | 완화 |
|---|---|
| Partial-move drift | §E 정책 — drop to Line |
| WASM 호환성 깨짐 | §D additive only |
| Boolean silent fallback | §F enum + Phase J §7.5 |
| Tool 의존성 cascade stale | §A migration 순서 강제 |
| Performance 회귀 | §C bench + 매 step 측정 |
| 8주 timeline 슬립 | §X.5 #6 6-step 분할 + 사인-오프 |

---

## 4. References

- ADR-052 master roadmap §2.3 Phase O
- ADR-059 Phase N (prerequisite — data layer)
- 사용자 사전 검토 2026-05-04 (Phase O 6 lock-in)
- 사용자 승인 2026-05-04 ("이 검토를 ADR-060 으로 고정")
- ADR-053~058 (모든 Phase H/I/J/K/L/M prerequisite)
- Phase J §7.5 (silent wrong-result 차단 lock-in 패턴)
- Phase M/N drop-in alongside pattern

---

*Author*: AXiA team (사용자 사전 검토 + 6 lock-in fix 2026-05-04)
*Status*: Phase O spec accepted — Step 1 부터 incremental 구현
