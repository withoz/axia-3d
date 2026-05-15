# ADR-103 — Z-up Coordinate Migration (Engine + Viewport)

| Field | Value |
|---|---|
| Status | **Proposed** (α — spec only, β-η implementation gated by ADR-102 ε closure) |
| Date | 2026-05-15 |
| Supersedes | — (5개월 누적 implicit Y-up 정책의 명시 결재) |
| Related | ADR-021 P7, ADR-026 P12, ADR-035 P20 (STEP/IGES), ADR-036 P21 (round-trip 1e-3 mm), ADR-046 P31, ADR-049 P-5e-α (default-OFF flip pattern), ADR-077 V-4 (visual baseline regen), ADR-081 W-η (STEP/IGES import boundary), ADR-091 §E L1 (snapshot schema canonical), LOCKED #5 (1.5μm spatial-hash), LOCKED #7 (cardinal plane SSOT), LOCKED #41 (ADR-101 closure), LOCKED #26 (Two-Layer Citizenship Phase 1) |

---

## 1. Canonical Anchor (사용자 결재 2026-05-15)

> **"지금 문제는 기능 부족이 아니라 '틀린 좌표계 위에서 CAD 커널이 돌아가고 있는 문제' 이며, 이를 해결하려면 반드시 엔진 Z-up (B) 전환이 선행되어야 한다."**

ADR-049 LOCKED #26 의 *5개월 implicit → explicit* 결재 패턴 답습. AxiA 가 *5개월간 암묵적으로 inherit* 한 Three.js default Y-up 정책을 **명시적 Z-up** 으로 마이그레이션. 모든 후속 architectural ADR (Path B 확장 / STEP timing / NURBS coplanar 등) 의 **선행 조건**.

### 1.1 절대 우선순위 (사용자 결재)

```
1. ADR-102 γ → δ → ε  (현재)
2. ADR-103 Z-up        (ε closure 즉시)
3. Path B (Sphere/Cone/Torus 확장)
4. STEP timing 단축
5. NURBS-aware coplanar intersect
```

**Path B 를 Z-up 보다 먼저 진행하면 *틀린 좌표계 위에서 확장* → bug 증폭**. 이 인과는 다음 ADR / commit 어디서도 변경 불가.

---

## 2. 현재 상태 (audit, 2026-05-15)

### 2.1 Engine layer (Rust core)

| 항목 | 현재 | 출처 |
|---|---|---|
| `Mesh::create_box` height 방향 | **Y** | `primitives.rs:135` (`hy`) |
| `Mesh::create_cylinder` axis | **`DVec3::Y`** | `primitives.rs:21` |
| `Mesh::create_cone` axis | **`DVec3::Y`** | `primitives.rs:234` |
| `Mesh::create_sphere` latitude axis | **Y** | `primitives.rs:327` |
| `Mesh::create_torus` axis (NEW, LOCKED #40 follow-up) | 호출자 결정 | 현재 caller 는 `DVec3::Y` |
| Box face order | Bottom -Y / Top +Y / Front +Z / Back -Z / Right +X / Left -X | `primitives.rs:170-182` |

### 2.2 Viewport layer (Three.js)

| 항목 | 현재 |
|---|---|
| Camera default `up` | `(0, 1, 0)` Three.js default |
| `Viewport.ts:885` 주석 | "기본 그리드: XZ 평면 (Y=0)" |
| `top` view mode | camera y+, up `(0, 0, -1)` |
| `front` view mode | camera z+, up `(0, 1, 0)` |
| `right` view mode | camera x+, up `(0, 1, 0)` |
| Default drawing plane (3d/top/bottom) | XZ ground (Y=0), normal `(0,1,0)` |
| Default drawing plane (front/back) | XY wall (Z=0), normal `(0,0,1)` |
| `InfiniteGrid` 기본 평면 | XZ |

### 2.3 Boundary I/O

| Format | 표준 | 현재 boundary 처리 |
|---|---|---|
| STEP AP203/AP242 | Z-up | `(x, z, -y)` 회전 (Z-up → Y-up) |
| IGES | Z-up | 동일 회전 |
| DXF / DWG | Z-up | 동일 회전 |
| SKP | Z-up | 동일 회전 |
| 3DM (Rhino) | Z-up | 동일 회전 |
| GLTF / OBJ / STL | Y-up | identity (현재 매칭) |

→ **5 / 6 CAD 표준 format 이 매번 회전 적용**. 누적 epsilon ~ N × 1e-15.

### 2.4 Snapshot

| 항목 | 현재 |
|---|---|
| `Scene::export_versioned_snapshot` magic + v6 | Y-up 좌표 그대로 직렬화 |
| `Mesh.verts[i].pos: DVec3` | Y-up 좌표 |
| `AnalyticSurface::Cylinder { axis_dir }` | 일반적으로 `DVec3::Y` (caller 결정) |

### 2.5 Test fixture (정량)

- axia-geo: ~150 site 에 hardcoded `DVec3::Y` / `(0.0, 1.0, 0.0)` 등 Y-up 좌표
- axia-core: ~50 site
- axia-wasm: ~20 site
- web vitest: ~30 site
- Playwright visual baselines: 4 (LOCKED #40 matrix) + ADR-074 group A/B + Torus 추가

**총 ~250-300 fixture site 갱신 필요**. sed-able 패턴 + cargo check 가이드.

---

## 3. 문제 — *kernel-inconsistency*

### 3.1 매 STEP import 시 회전 누적

```
STEP file (Z-up)
  ↓ boundary rotation (x, z, -y)
Engine (Y-up)
  ↓ AnalyticSurface attach (axis_dir = Y)
Kernel ops (Boolean / offset / Push/Pull)
  ↓ inverse rotation
STEP export
```

각 회전 ≈ `f64 ε ~1e-15`. ADR-036 P21.6 round-trip tolerance 1e-3 mm 와 거리 ~10¹² 배 — *단발성 안전*. 하지만 deep workflow:

- AI agent (P3 페르소나, MCP capability) 가 op chain 50+ 호출 → epsilon 누적
- Boolean SSI (ADR-064) + offset (ADR-080) + Push/Pull (ADR-079) 체인 시 누적 epsilon 이 ADR-036 P21.6 tolerance 경계 근접
- Path X (rational NURBS surface SSI) 도래 시 numerical conditioning 더 민감

### 3.2 Primitive default 와 import 좌표 불일치

```
사용자가 STEP file 의 cylinder (axis +Z) 를 import
  → engine 에서 axis_dir = +Y 로 변환됨
  → 시각: Y-up 으로 표시
사용자가 새 cylinder 생성 (Default)
  → engine 에서 axis_dir = +Y (DVec3::Y)
  → 시각: Y-up 으로 표시
```

겉으로는 *정합* 처럼 보이지만:
- Import 한 cylinder 의 metadata 가 실제로는 "원본 +Z" 였다는 history 가 boundary rotation 에 묻힘
- Round-trip export 시 axis_dir 역회전 → +Z 복원, 하지만 *중간 op* 가 axis_dir 을 mutate 한 경우 (예: offset 후 cylinder 가 새 axis_dir = `(0, 1, 0.0001)` 같은 epsilon-perturbed value) 역회전 결과가 `(0.0001, 0, 1)` 같은 *시각상 동일하지만 numerically off* state

### 3.3 사용자 facing 문제 (P1 페르소나)

- SketchUp / Fusion / SolidWorks 출신 사용자: "X 우측, Z 위" muscle memory
- AxiA 첫 사용 시 cognitive 부담: "왜 height 가 Y?"
- 도구 hotkey (Numpad 7 = top view 가 -Y 방향 down) 가 SketchUp 의 -Z 와 반대 매핑

### 3.4 5개월 누적 implicit 정책의 명시화

LOCKED 정책 / ADR 어디에도 Y-up vs Z-up 결정이 *명시적으로 정당화* 안 됨. 이는 **결정을 미루어둔 default** 의 첫 명시 결재. ADR-049 LOCKED #26 (Two-Layer Citizenship) 의 5개월 implicit → explicit 마이그레이션 패턴 답습.

---

## 4. 제안 작업 (atomic sub-step, ADR-102 ε closure 이후 진입)

### Phase α — Spec only (본 문서)

| Step | 작업 | 상태 |
|---|---|---|
| α-1 | spec ADR (본 PR) — 7-layer roadmap + lock-in | 작성 중 |
| α-2 | 사용자 결재 확인 + LOCKED #43 prep | spec PR merge 시 |

### Phase β — Rust primitive defaults

| Step | 작업 |
|---|---|
| β-1 | `Mesh::create_box`: `hy` semantic 보존 (height=Z), face order Bottom -Z / Top +Z / Front -Y / Back +Y / Right +X / Left -X |
| β-2 | `Mesh::create_cylinder/cone/sphere/torus`: default `up = DVec3::Z` |
| β-3 | `AnalyticSurface::Plane/Cylinder/Cone/Torus` constructor 호출 sites — caller 가 `DVec3::Y` 넘기는 곳 일괄 변경 |
| β-4 | axia-geo / axia-core / axia-wasm 회귀 자산 갱신 (~200 site, sed + cargo check) |

### Phase γ — Viewport (Three.js)

| Step | 작업 |
|---|---|
| γ-1 | `Viewport.ts` camera default `up = (0, 0, 1)` |
| γ-2 | 6 view mode (top/bottom/front/back/right/left) 의 camera position + up vector 재매핑 |
| γ-3 | `InfiniteGrid` 기본 XY 평면 (Z=0) — 90° 회전 |
| γ-4 | `Spherical` 카메라 phi/theta 의미 변경 — Z 가 polar axis |

### Phase δ — Drawing plane + tool defaults

| Step | 작업 |
|---|---|
| δ-1 | `ToolManagerRefactored.getDrawPlane` view-mode-adaptive 매핑 갱신 |
| δ-2 | 3d/top/bottom default plane = XY (Z=0), normal `(0,0,1)`, up `(0,1,0)` |
| δ-3 | front/back default plane = XZ (Y=0) |
| δ-4 | right/left default plane = YZ (X=0) |
| δ-5 | Sketch session normal/up/right 정합 |

### Phase ε — Snapshot v6 → v7 migration

| Step | 작업 |
|---|---|
| ε-1 | `Scene::export_versioned_snapshot` SNAPSHOT_VERSION = 6 → 7 |
| ε-2 | `Scene::import_versioned_snapshot` v6 detect → load-time auto-rotate (Y↔Z swap on coords + axis_dir) |
| ε-3 | `AnalyticSurface::Cylinder/Cone/Torus` 의 `axis_dir` migration |
| ε-4 | Legacy V2/v6 회귀 (ADR-091 §E L1 패턴 답습) — v6 load roundtrip PASS |
| ε-5 | New v7 → v7 roundtrip identity (rotation 0) |

### Phase ζ — Boundary I/O identity

| Step | 작업 |
|---|---|
| ζ-1 | DXF import: 회전 제거 (Z-up direct) |
| ζ-2 | DWG import: 동일 |
| ζ-3 | STEP / IGES import (`occtCurvePromote` / `occtSurfacePromote` / `tessellateShape` / `tessellateEdges`): boundary rotation 제거 |
| ζ-4 | SKP / 3DM: 동일 |
| ζ-5 | GLTF / OBJ / STL: *역방향 회전 추가* (Y-up → Z-up engine) — 또는 import-time identity (사용자 의도에 따라 결정, 별도 sub-step) |

### Phase η — Visual baseline + Real Chromium

| Step | 작업 |
|---|---|
| η-1 | ADR-077 V-4 가이드로 visual baseline 전부 regenerate (Linux CI) |
| η-2 | LOCKED #40 4-primitive matrix (Box/Cylinder/Sphere/Cone/Torus) baseline 갱신 |
| η-3 | ADR-074 group A/B outline baseline 갱신 |
| η-4 | Real Chromium E2E (Playwright slow channel) 시연 PASS |
| η-5 | 사용자 facing 시연 결재 (LOCKED 정책 답습) |

### Phase θ — Closure

| Step | 작업 |
|---|---|
| θ-1 | ADR-103 Amendment 1 — Phase β-η commit log + 회귀 누적 매트릭스 |
| θ-2 | LOCKED #43 — Z-up engine canonical statement + ADR-103 closure |
| θ-3 | CLAUDE.md 의 implicit Y-up 잔존 참조 갱신 |
| θ-4 | 다음 ADR 가이드 — primitive constructor 작성 시 default `DVec3::Z` 답습 강제 |

### Phase 총 기간

| Phase | 기간 |
|---|---|
| α (spec) | 2일 |
| β (Rust primitive) | 3-4일 |
| γ (Viewport) | 2-3일 |
| δ (Drawing plane) | 2일 |
| ε (Snapshot) | 3-4일 |
| ζ (Boundary I/O) | 2-3일 |
| η (Visual baseline + 시연) | 2-3일 |
| θ (Closure) | 1-2일 |

**총 17-22일 (3-4주 atomic)**. ADR-049 LOCKED #26 5-Phase closure (7 ADRs / 14주) 와 비교 시 단일 ADR 의 multi-week atomic.

---

## 5. 제외 (out of scope)

- **Y-up legacy file 영구 변환** — load-time auto-rotate 만, 저장 시 새 v7 schema (사용자 facing 0 영향)
- **GLTF / OBJ / STL 의 web-Y-up 변환 정책** — Phase ζ-5 별도 sub-step. P1 페르소나 가치 비중 낮음, 우선순위 ★★
- **DXF export 의 boundary rotation 제거** — Phase ζ 의 export path 는 import 와 대칭이므로 자동 정합
- **사용자 preference toggle** — ADR-049 P-5e-α 의 default-OFF flag 패턴 *답습 안 함*. 본 마이그레이션은 *결정* 이지 *옵션* 아님. 단, *legacy V1/v6 snapshot* 의 load-time 처리는 보존
- **Three.js Object3D.DEFAULT_UP 변경** — 전역 영향 클 가능성. 본 ADR 은 `camera.up` 만 명시 설정. 후속 ADR 에서 검토 가능

---

## 6. Lock-ins (canonical for ADR-103)

- **L-103-1 절대 우선순위**: ADR-102 ε closure → ADR-103 β 즉시 진입. Path B / STEP timing / NURBS coplanar 는 ADR-103 θ closure 이후. **순서 변경 불가**.
- **L-103-2 Engine + Viewport 동시 flip**: 옵션 A (viewport-only) 명시 거부. 옵션 C (hybrid) 명시 거부. Option B (full) 만 채택.
- **L-103-3 Snapshot v6 → v7 load-time auto-rotate**: 사용자 facing 0 영향. 저장 시 새 v7 schema, load 시 v6 detect → Y↔Z swap 적용. ADR-091 §E L1 canonical guidance 답습 (Scene-level migration code, struct field 추가 0).
- **L-103-4 Boundary I/O identity**: STEP/IGES/DXF/DWG/SKP/3DM 의 boundary rotation 제거. boundary tax (~1e-15 ε per round-trip) 영구 종료.
- **L-103-5 Fixture 일괄 갱신**: sed `(0.0, 1.0, 0.0)` → `(0.0, 0.0, 1.0)` + cargo check 반복. semantic 동등 변환 (rotation 90° around X). 절대 #[ignore] 금지 유지.
- **L-103-6 Visual baseline regenerate**: ADR-077 V-4 가이드 답습. Linux CI baseline 첫 fail → README procedure → 갱신 commit.
- **L-103-7 사용자 시연 게이트**: Phase η 의 real Chromium 시연 PASS 필수. ADR-087 K-ζ canonical 답습 — test 자산만으로 architectural 회귀 보장 불가.
- **L-103-8 ADR-026 P12 SSOT 보존**: Bridge cardinal plane snap 정책 (LOCKED #7) 의 의미 정합 — `cardinal axis = {X, Y, Z}` 의 absolute value 비교는 좌표계 무관, 자동 정합.
- **L-103-9 ADR-046 P31 #4 (additive only) 의미적 정합**: 메뉴/단축키/툴바 외부 ID UNCHANGED. 좌표계 변경 = *internal representation* 변경이지 *사용자 facing API* 변경 아님. muscle memory (Numpad 7 = top) 보존 — 단 top view 의 의미가 "위에서 내려다봄 (Z+ → Z-)" 로 *명확화*.
- **L-103-10 절대 #[ignore] 금지**: Phase β-η 의 ~250+ fixture 갱신 + 신규 회귀 (Z-up 정합 검증) 모두 PASS 유지. semantic equivalence 보존.

---

## 7. SketchUp / Fusion / SolidWorks 와의 비교

| 측면 | SketchUp | Fusion 360 | SolidWorks | AxiA 3D (제안 후) |
|---|---|---|---|---|
| Internal up | Z | Z | Z | **Z** ✅ |
| Camera default up | Z | Z | Z | Z |
| Default ground plane | XY | XY | XY | **XY** ✅ |
| STEP/IGES import | identity | identity | identity | **identity** ✅ |
| Top view = | XY 평면 보기 (Z-) | 동일 | 동일 | **동일** |
| Height of box | Z | Z | Z | **Z** |

→ 모든 CAD parity 도달. P1 페르소나 (건축/디자인) muscle memory 정합.

---

## 8. 회귀 영향 예측

- **기존 회귀 자산**: ~250-300 site 갱신 (semantic 동등, sed-able)
- **신규 회귀 자산**: +20~30 (Z-up 정합 검증 — primitive axis default / snapshot v6 migration / boundary identity)
- **Visual baseline**: 전부 regenerate (1회성, Linux CI 가이드)
- **사용자 facing**:
  - 새 cylinder/cone/box default = Z-axis (이전 Y-axis) → 자연스러운 "위로 솟음"
  - Top view = XY 평면 위에서 내려다봄 (CAD 표준)
  - STEP file import 시 *회전 0* → 원본 자세 유지
  - 기존 .axia 파일 load 시 *자동 회전* → 시각 자세 유지

---

## 9. 사용자 결재 트리거 + 사전 결재 (2026-05-15)

본 ADR 은 *β-η 진입 전* 사용자 명시 결재 + LOCKED 정책 (`docs/adr/README.md` 메타-원칙 #10) 답습. 사전 결재 완료 항목:

- ✅ **ADR-103-α spec 병렬 작성** (본 PR, γ 와 독립)
- ✅ **Z-up 진행 결재 (canonical)** — "γ/δ/ε 전 실제 migration ❌, spec + prep 까지만 ✅"
- ✅ **절대 우선순위 (Z-up → Path B → STEP → coplanar)** — Path B 먼저 제안은 사용자 정정으로 거부

본 spec PR merge 후 ADR-102 ε closure 시점에 β 진입.

---

## 10. Cross-link

- **ADR-049 LOCKED #26** — 5개월 implicit → explicit 마이그레이션 패턴 (Two-Layer Citizenship Phase 1) 답습 anchor
- **ADR-091 §E L1** — Snapshot schema migration canonical (Scene-level map, struct field 0)
- **ADR-077 V-4** — Visual baseline regenerate procedure
- **ADR-046 P31 #4** — Additive only (사용자 facing API 변경 0)
- **ADR-026 P12 (LOCKED #7)** — Cardinal plane SSOT, 좌표계 무관 자동 정합
- **ADR-036 P21.6** — STEP round-trip 1e-3 mm, boundary rotation 0 → tolerance 여유 확대
- **ADR-035 P20.A** — STEP AP242 primary, AP203 secondary — Z-up 표준 직접 매핑
- **ADR-081 W-η** — STEP/IGES import boundary 의 rotation 제거 site
- **ADR-079** — `create_solid` primitive 의 axis_dir default 갱신
- **ADR-080** — Offset dimension-aware 의 surface axis_dir 정합
- **ADR-049 P-5e-α** — default-OFF flag pattern *답습 안 함* (본 마이그레이션은 결정, 옵션 아님)
- **LOCKED #1 ADR-021 P7** — Manifold rule 의 좌표계 무관성 (정합 자동)
- **LOCKED #5** — 1.5μm spatial-hash, 좌표계 무관
- **LOCKED #7 ADR-026 P12** — Cardinal plane snap, 좌표계 무관
- **LOCKED #40** — Render chord_tol, 4-primitive visual baseline matrix (Phase η 시 regenerate)
- **LOCKED #41** — ADR-101 closure entry
- **LOCKED #42 (예상)** — ADR-102 closure entry (선행 조건)
- **LOCKED #43 (예상)** — ADR-103 closure entry (본 ADR θ-2)
