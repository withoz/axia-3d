# LOCKED #26 Two-Layer Citizenship Model — Closure Retrospective

- **Date**: 2026-05-10
- **Span**: 2026-05-03 (ADR-049 §4 Q5 lock) → 2026-05-10 (ADR-099 L-η)
- **Anchor**: ADR-049 (Two-Layer Citizenship Model) §4 Q1~Q5 final
  decisions, v3.2 §12-§13 main promises.
- **Author**: Claude Opus 4.7 (1M context) + 사용자 (위코)

---

## 1. Mission Recap

ADR-049 §2.2 mapped v3.2 spec §13 to a **두 계층 시민권 모델**:
- **Form citizen (`Shape`)** — material 무관, 0-차원 허용 (face 두께
  0, line 두께 0, point 0)
- **Property citizen (`Xia`)** — material + 부피/단면 + manifold +
  closed 4-조건 통과 시 첫 인정

LOCKED #26 의 5-Phase 로드맵은 위 모델의 점진 활성:

| Phase | ADR | 약속 |
|-------|-----|------|
| 1 | ADR-050 + ADR-051 | Shape/Xia type split + P7 strict |
| 2 | ADR-091 | Material removal demote (Xia → Shape) |
| 3 | ADR-095 + ADR-096 | Reference citizenship + retro-migration |
| 4 | ADR-097 | Topology damage auto-recovery (v3.2 §12.3) |
| 5-A | ADR-098 | Asset library 3-tier material scope (v3.2 §13) |
| 5-C | ADR-100 | Material removal recovery (v3.2 §12.3 material-layer) |
| 5-B | ADR-099 | Layered material 4-PBR channels (v3.2 §13 main) |

**본 retrospective 의 위상**: 7 ADRs / 누적 ~+440 회귀 / 5-Phase
완전 closure 의 canonical lessons 영구 capture.

---

## 2. 누적 Metrics

### 2.1 Regression Totals (절대 #[ignore] 금지 정책 100% 준수)

| ADR | axia-core | axia-geo | axia-wasm | vitest | Playwright | 합계 |
|-----|-----------|----------|-----------|--------|------------|------|
| 050+051 | +49 | +5 | +12 | +77 | +2 | +145 |
| 091 | +8 | 0 | +2 | +14 | +2 | +26 |
| 095+096 | +17 | 0 | +9 | +20 | +4 | +50 |
| 097 | +4 | +11 | 0 | +32 | +4 | +51 |
| 098 | +19 | 0 | +4 | +26 | +5 | +54 |
| 100 | +10 | 0 | +3 | +35 | +5 | +53 |
| 099 | +18 | 0 | +5 | +38 | +5 | +66 |
| **합계** | **+125** | **+16** | **+35** | **+242** | **+27** | **+445** |

### 2.2 Code surface 확장

- **axia-core**: 4 신규 type categories (Shape / Reference /
  MaterialTier / LayeredChannels) + 7 신규 Scene methods + 누적
  re-exports
- **axia-wasm**: 35+ 신규 endpoints (additive, ADR-076
  §C-amendment-1 baseline guard PASS throughout)
- **web/src**: 5 신규 UI modules (TopologyRecoveryDialog,
  TopologyRecoveryOrchestrator, AssetLibraryPanel,
  MaterialRemovalRecoveryDialog/Orchestrator, LayeredMaterialDialog,
  LayeredMaterialBinding)
- **Settings**: 4 신규 localStorage flags (`axia:auto-topology-
  recovery`, `axia:asset-library-user-tier`, `axia:auto-material-
  recovery`)
- **Snapshot**: section 9 (material_library 직렬화) — additive +
  `#[serde(default)]` legacy compat

---

## 3. Pattern Catalog (canonical)

### 3.1 Path Z Atomic Decomposition

모든 7 ADRs 가 **Path Z atomic** 패턴 답습. 일관 surface:
- α — spec only commit (사용자 결재 anchor)
- β — Rust core (engine truth)
- γ — Bridge / Snapshot (WASM + section 9)
- δ — UI / Render (TS layer)
- ε — Settings flag + main.ts wiring
- ζ — Real Chromium E2E + ADR closure

**ADR-099 만 7 sub-step** (L-α ~ L-η) — Render layer 가 6번째 분리
sub-step 으로 자연 진입.

### 3.2 Atomic Stack Patterns (5-layer vs 6-layer)

**5-layer Recovery pattern** (ADR-097, ADR-100):
```
Engine truth → Bridge → UI Dialog + Orchestrator → Settings flag → E2E
```
- ADR-097: 첫 정착
- ADR-100: ADR-097 1:1 mirror (canonical reproducibility 증명)

**6-layer Feature pattern** (ADR-099):
```
Engine → Snapshot → Bridge → Render → UI → Bridge TS + main.ts → E2E
```
- Render layer 의 자연 삽입은 5-layer 의 generalization
- 사용자 시연 visible 효과 (PBR rendering) 의 architectural reflection

**Pattern evolution proof**: 둘 다 reproducible. 향후 ADR 적합 패턴
선택 가능 (Recovery cascade vs Feature 추가).

### 3.3 사후 정정 정책 (audit > spec)

**Spec 의 lock-in 이 audit 결과 architectural truth 와 충돌 시 사후
정정**. ADR §D 에 정정 명시:
- ADR-098 S-α "Scene 3 maps" → audit `MaterialLibrary.tier_index`
  parallel Map (bincode drift 회피)
- ADR-098 S-γ HashMap → BTreeMap (snapshot byte-equality determinism)
- ADR-099 L-β/L-γ `skip_serializing_if` 박멸 (bincode positional EOF)

**향후 ADR 가이드**: 사용자 결재한 spec 보다 audit 결과가 architectural
truth 위에 있을 때 사후 정정. Lock-in 변경은 ADR §D 사후 정정 항목
명시 + regression guard test 추가.

### 3.4 ADR-091 §E L1 canonical: Mesh/Scene-level Map

bincode positional encoding 위험 회피 — 기존 struct 에 field 추가
금지, Mesh/Scene-level 별개 HashMap/BTreeMap 사용:
- ADR-091 D-ε: `Scene.xia_to_original_shape` Map (Xia struct UNCHANGED)
- ADR-093 D-β: `Mesh.face_to_surface_owner_id` Map
- ADR-094 B-γ-prep: `Mesh.face_to_boundary_loops` Map
- ADR-098 S-γ: `MaterialLibrary.tier_index` parallel Map
- ADR-099 L-β: `VisualProperties.layered: Option<LayeredChannels>` (struct
  field with `#[serde(default)]`)

**6번째 일관 적용**. 향후 모든 bincode struct 변경 시 canonical 답습.

### 3.5 ADR-091 §E L4 canonical: UI orchestration 분리

UI 의 view layer 와 logic 분리:
- ADR-091 §E L4 첫 정착 (Inspector ↔ MaterialRemovalDemote helper)
- ADR-097 T-δ: TopologyRecoveryDialog + Orchestrator
- ADR-100 R-δ: MaterialRemovalRecoveryDialog + Orchestrator (1:1)
- ADR-098 S-δ: AssetLibraryPanel (callback-based bridge wiring)
- ADR-099 L-ε/L-ζ: LayeredMaterialDialog + AssetLibraryPanel callback

**9번째 일관 적용** by L-ζ. 향후 UI 추가 시 callback-based wiring
canonical.

### 3.6 Settings module 5-함수 surface

localStorage-backed flag 모듈의 canonical shape:
```typescript
const STORAGE_KEY = 'axia:...';
let current = <default>;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === '<opt-in>') current = !default;
} catch { /* private mode */ }
const listeners = new Set<...>();

export function getMode(): boolean { return current; }
export function setMode(value: boolean): void { ... }
export function onModeChange(cb): () => void { ... }
```

**5번째 일관 적용**:
- ADR-094 CylinderPathBSettings
- ADR-096 AutoReferenceImportSettings
- ADR-097 AutoTopologyRecoverySettings
- ADR-098 AssetLibraryUserTierSettings
- ADR-100 AutoMaterialRecoverySettings

향후 신규 flag 추가 시 canonical 5-함수 답습.

### 3.7 Default ON/OFF 분기

- **Default ON** (메모리/시각 무관 변경, ADR-094 default ON 답습):
  ADR-094 (Cylinder Path B), ADR-096 (auto reference import). 사용자
  facing 변화 시각 불변.
- **Default OFF** (self-modifying op safety): ADR-097 (topology
  recovery), ADR-098 User tier (opt-in), ADR-100 (material recovery).
  사용자 facing 의미 가변/추가 surface.

향후 신규 flag 추가 시 본 분기 기준 명시.

### 3.8 RecoveryOutcome enum shape mirror (3-variant union)

ADR-097 정착, ADR-100 1:1 mirror:
```rust
enum RecoveryOutcome {
    NoOp,
    Recovered { ... },
    PartialFailure { ... },
}
```
JSON shape: `{"kind": "NoOp"}` / `{"kind": "Recovered", ...}` /
`{"kind": "PartialFailure", ...}`. Engine ↔ Bridge ↔ TS union 모두
동일 shape — AI agent / 사용자 패턴 학습 효율.

### 3.9 ok-envelope return type

```rust
"{\"ok\":true,\"<data>\":<...>}" | "{\"ok\":false,\"error\":\"<msg>\"}"
```
silent skip 차단. 사용자 facing error 명시. ADR-100 R-γ
`removeProjectMaterial` + ADR-099 layered binding result.

### 3.10 export_baseline.txt additive guard (ADR-076 §C-amendment-1)

모든 WASM endpoint 추가는 `tests/export_baseline.txt` 에 한 줄 추가.
`wasm_export_baseline_unchanged` test 가 baseline ⊆ source 검증 →
endpoint 삭제 사후 변경 차단.

LOCKED #26 7 ADRs 누적 — 35+ endpoints additive, drift 0.

---

## 4. Technical Debt Resolved

### 4.1 bincode `skip_serializing_if` 함정 영구 박멸

**문제**: `#[serde(default, skip_serializing_if = "Option::is_none")]`
를 bincode struct field 에 적용 → 직렬화에서 byte 생략 → 역직렬화에서
positional EOF (UnexpectedEof 또는 "tag for enum is not valid" 에러).

**근거**:
- bincode 1.x 는 positional/length-prefix 포맷 — self-describing 아님
- `skip_serializing_if` 는 JSON 같은 self-describing 포맷 가정
- legacy snapshot fallback 은 section-level (section 9 의 length
  prefix) 에서 처리, struct field level 에서는 불가

**해결**:
- ADR-099 L-β 사후 정정: `VisualProperties.layered` skip 제거
- ADR-099 L-γ 사후 정정: `LayeredChannels` 내부 4 채널 + `TextureChannel
  Info.rotation`/`label` skip 제거
- regression guard: `material_partial_layered_bincode_roundtrip` —
  bincode roundtrip direct test (Material struct 단위, fastest signal)

**향후 영향**: 모든 bincode struct Option 필드는 `#[serde(default)]`
only. `skip_serializing_if` 금지.

### 4.2 HashMap → BTreeMap canonical for snapshot determinism

**문제**: bincode HashMap 직렬화는 iteration order 비결정적 (Rust
HashMap 의 random seed). orphan_recovery 등 byte-equality 회귀 차단.

**해결**: ADR-098 S-γ 사후 정정 — `MaterialLibrary.materials` +
`tier_index` HashMap → BTreeMap. Snapshot byte-equality 결정성.

**향후 영향**: 모든 Scene-level Map (snapshot-eligible) BTreeMap
우선.

### 4.3 ServiceContainer storage 의 함정

**문제**: `container.register('key', () => async () => ...)` — factory
wrapper. `container.get('key')` 가 factory 자체 반환. `await get()`
은 Promise<asyncFn> 반환, 한번 더 호출 필요.

**해결**: ADR-097 T-ζ 사후 정정 — `register('topologyRecovery',
async () => ...)` 단일 instance. ADR-100 답습 + ADR-099 답습.

**향후 영향**: ServiceContainer 는 단순 storage. Factory pattern
필요 시 caller 가 직접 wrap.

---

## 5. Velocity Analysis

### 5.1 Multi-week atomic 의 단일 세션 closure 가능성

ADR-099 spec 명시: **multi-week strict** (6 sub-step × 평균 1 세션 =
6 세션). 실제로는 **단일 세션에서 L-α~L-η 모두 closure**.

**이유**:
- ADR-097/100 5-layer pattern 1:1 mirror 의 누적 효율 (새 패턴 0)
- canonical lessons (L1~L9) 의 점진 reusable
- Python regex sed 일괄 패치 (ADR-087 K-ζ 답습) 로 24+ struct
  literal 수정 자동화
- 사용자 사전 검토 + 즉시 결재 패턴 — 의사결정 지연 0

**향후 ADR 가이드**: multi-week 분류는 *최대 추정* — 실제 일정은
canonical pattern 활용도에 따라 단축 가능.

### 5.2 Pattern reuse 의 효과 정량화

- ADR-097 새 패턴: ~+15 unique lines of new design
- ADR-100 1:1 mirror: ~+5 unique lines (Material vs Topology naming)
- ADR-099 evolution: ~+8 unique lines (Render layer 추가)

새 ADR 의 unique design 가 점점 줄어들고 reusable pattern 의 점진
확장. 누적 9 canonical lessons 가 향후 ADR 의 사전 검토 효율 증대.

---

## 6. 향후 ADR 가이드 (LOCKED #26 closure 이후)

### 6.1 Pattern selection checklist

1. **Recovery cascade or Feature 추가?**
   - Recovery → 5-layer pattern (ADR-097/100 답습)
   - Feature → 6-layer pattern (ADR-099 답습) — Render layer 필요 시
2. **사용자 facing 의미 가변/추가?**
   - Yes → Default OFF (opt-in safety)
   - No (시각 불변) → Default ON 가능 (ADR-094 패턴)
3. **bincode struct 변경?**
   - Field 추가 → `#[serde(default)]` only (skip_serializing_if 금지)
   - 대량 변경 → Mesh/Scene-level Map 우선 (ADR-091 §E L1 답습)
4. **UI 추가?**
   - Pure view layer + callback wiring (ADR-091 §E L4 답습)
   - Dialog + Orchestrator 분리 (ADR-097/100 helpers 답습)
5. **WASM endpoint 추가?**
   - export_baseline.txt additive (ADR-076 §C-amendment-1)
   - JSON shape mirror engine enum (ADR-097 `RecoveryOutcome` 답습)
   - ok-envelope on convenience entries (silent skip 차단)

### 6.2 Path Z atomic checklist

- α: spec commit (사용자 결재 anchor, 코드 변경 0)
- β: Rust core + regression guard tests
- γ: Snapshot section + WASM bridge + step6_additive_only.rs wiring
- δ: TS bridge wrappers + UI (with callback hooks)
- ε: Settings module 5-함수 + main.ts wiring + SettingsPanel toggle
- ζ: Real Chromium Playwright + ADR §D closure + Status: Accepted

각 sub-step **standalone usable** invariant — 중단 risk mitigation.

### 6.3 사후 정정 surface

ADR §D Acceptance Log 에 항상 명시. 정정 reason + audit trail +
regression guard 명기. Lock-in spec 변경은 사용자 결재 없이도 audit
truth 우선 — 명시 trail 만 필요.

---

## 7. 사용자 facing 변화 요약 (LOCKED #26 사용자 visible 가치)

### 7.1 직접 사용 가능한 신규 기능

- **재질 시스템 3계층**: System (12 built-in) / Project / User 자산
  라이브러리
- **Layered material**: 4 PBR channels (albedo / normal / roughness /
  metallic) — Three.js MeshStandardMaterial 직접 활용
- **Material 삭제 자동 복구**: orphan Xia → FORM_MATERIAL 자동 강등
  (사용자 다이얼로그 escalation)
- **위상 손상 자동 복구**: Phase 4 dialog ([Undo] / [강등] / [수동수정])
- **Reference 시민권**: ConstructionLine / ImportedMesh / PointCloud
  (외부 import 자연 분류)

### 7.2 SettingsPanel 4 신규 토글 (모두 default OFF)

- "위상 손상 자동 복구 (실험)" (ADR-097)
- "User 라이브러리 활성화 (실험)" (ADR-098)
- "재질 삭제 자동 복구 (실험)" (ADR-100)
- (ADR-099 Layered material 은 Always available — opt-in flag 불필요)

### 7.3 외부 file 통합 자연 정합

- STEP/IGES import → ImportedMesh Reference 자동 분류 (ADR-096)
- .axia snapshot section 9 → material_library 자동 직렬화 (ADR-098)

---

## 8. Closing Reflection

LOCKED #26 closure 는 단순 ADR 7 묶음의 완성이 아닌 **architectural
truth 의 점진 정착** 의 증거. ADR-049 §4 Q1~Q5 가 사용자 결재 lock 한
canonical decisions 가 5-Phase 점진 실현되어 v3.2 spec §12-§13 main
promises 와 완전 정합.

특히 ADR-099 의 *multi-week strict* 가 단일 세션에서 closure 도달한
사실은 **canonical pattern 의 누적 reusability 가 multi-week → single-
session compression 으로 manifest** 한다는 강한 증거. 향후 모든 신규
ADR 은 본 retrospective 의 9 canonical lessons + 3 pattern catalogs
의 sediment 위에 builds.

**Two-Layer Citizenship Model 의 의미적 완성** — Form/Property/
Reference 3-계층 시민권 + 4-Phase Recovery + 2-Phase Asset Library
+ 1-Phase Layered Material 모두 production-active. LOCKED #26 의
약속 모든 closure.

---

## Cross-link

- **Canonical anchor**: ADR-049 §4 Q1~Q5 final, v3.2 §12-§13
- **7 ADRs**: 050+051 / 091 / 095+096 / 097 / 098 / 099 / 100
- **메타-원칙 #14**: "면은 닫힌 경계로부터 유도된다" — material 의
  property-citizen 한정과 자연 정합
- **CLAUDE.md LOCKED**: #26 (canonical anchor), #36 (ADR-097),
  #37 (ADR-098), #38 (ADR-100), #39 (ADR-099)
