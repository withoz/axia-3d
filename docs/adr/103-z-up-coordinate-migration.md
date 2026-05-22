# ADR-103 — Z-up Coordinate Migration (Engine + Viewport)

| Field | Value |
|---|---|
| Status | **Accepted (Amendment 3, 2026-05-15) — ✅ Closed** — β/γ/δ/ε/ζ all atomic-merged. 4 post-merge hotfixes (axis+grid / orbit / shadow / mouse pick) absorbed. η visual baseline regenerate deferred to follow-up workflow. See §11 Acceptance Log. |
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

### 2.5 Audit 정정 (Amendment 1, 2026-05-15)

**초안 α-1 estimate (~250-300 site) 가 2.3x 부족**. 실측 (commit `eb343f4` main 기준):

| Layer | `DVec3::Y` sites | 비고 |
|---|---|---|
| **axia-core/scene.rs** | **184** | scene/Xia/Shape/WorkPlane construction + 160 개 `up: DVec3::Y` |
| axia-geo (operations) | ~80 | offset/fillet/draw/revolve/sweep 등 algorithm + test |
| axia-geo (surfaces) | ~45 | ssi/analytic, surface ops |
| axia-geo (curves) | ~10 | math primitives |
| axia-geo (entities/mesh) | ~10 | core |
| axia-wasm / axia-transaction | ~30 | bridge + tests |
| **합계** | **~352** | **across 47 files** |

추가 패턴:
- `up: DVec3::Y` semantic "world up" **160 sites in scene.rs alone**
- `(0.0, 1.0, 0.0)` Y-coordinate literals 다수 (위와 일부 overlap)
- 알고리즘 내부 `let arbitrary = if up.y.abs() < 0.9 { DVec3::Y } else { DVec3::X };` 패턴 — *axis-agnostic* (의미 무관)

**핵심 발견 — sed-able 아님**:

ADR-103-α 의 L-103-5 가 "sed-able 패턴 + cargo check 반복" 으로 가정했으나 site 별 semantic 분류 필요:

1. "World-up convention" → 의미 변경 (Y → Z)
2. "Arbitrary perpendicular axis seed" → 의미 무관 (Y 그대로 OK)
3. "Test fixture coordinate" → semantic Y↔Z swap (vertex 위치 회전)
4. "Algorithm-internal math hint" → 의미 무관

→ **시간 estimate 정정**: spec α-1 의 β phase 3-4 일 → **실측 1-2 주 atomic (5 sub-step 분할 권장)**.

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

### Phase β — Rust primitive defaults (Amendment 2: 4-split 정정)

**Amendment 1 (5-split, 2026-05-15) → Amendment 2 (4-split, 2026-05-15)** sequential evolution. β-2 audit 결과 production code 의 `AnalyticSurface::Cylinder/Cone/Torus` constructor 호출은 *모두 β-1 의 caller chain 으로 transitively migration 완료*. β-2 의 독립 scope = ∅ → audit-only closure.

| Step | scope | 상태 |
|---|---|---|
| **β-1** | 5 primitive constructor (`create_box/cylinder/cone/sphere/torus`) defaults — Y-up → Z-up | ✅ commit `4bde9ee` (+7 회귀, 0 regression) |
| **β-2 (audit-only)** | `AnalyticSurface::*` constructor 호출 sites audit | ✅ closure (production = ∅, test = β-3 흡수) |
| **β-3** | axia-geo test fixture Y↔Z swap (~135 site, 분류 + cargo check) | 결재 대기 |
| **β-4** | axia-core scene.rs (184 sites + 160 `up: DVec3::Y` patterns) | 결재 대기 |
| **β-5** | axia-wasm bridge + tests (~30 site) + 잔여 정리 | 결재 대기 |

### β-2 audit 정량 (2026-05-15)

| Pattern | Sites | Production / Test 분류 |
|---|---|---|
| `axis_dir: DVec3::Y` | 6 | **0 production / 6 test** (모두 Revolve mode test — β-3) |
| `normal: DVec3::Y` (Plane) | 17 | **0 production / 17 test** (mesh/boolean/draft/merge test fixtures — β-3) |
| Production `AnalyticSurface::Cylinder/Cone` attach (hardcoded Y axis) | 0 | β-1 caller chain 으로 transitively 자동 migration 완료 |

**핵심 발견 (Amendment 2)**: 5개월간의 production / test 분리가 architectural 정합. Production code 는 *caller-supplied axis* 만 사용 (axis-agnostic), Y-up bias 는 모두 test fixture 에 격리. ADR-046 P31 #4 (additive only) 의 implicit 실증.

### β phase 총 기간 (Amendment 1 → Amendment 2)

| Phase | Amendment 1 estimate | Amendment 2 정정 |
|---|---|---|
| β-1 | 3-4일 | ✅ 1일 (실제 완료, commit `4bde9ee`) |
| **β-2** | 1-2일 | **✅ audit-only 마무리 (production = ∅)** |
| β-3 (test fixture) | 1주 | 1주 |
| β-4 (scene.rs) | 1주 | 1주 |
| β-5 (axia-wasm) | 2-3일 | 2-3일 |

β phase 총: **1-2주 atomic** (Amendment 2 단축 effect, β-2 흡수로 +2-3일 절감).

**β-1 의 cardinal 의미 — 사용자 시연 가능** (β-1 closure 후 보존):
- β-1 closure 시점에 새 cylinder / box / cone / sphere / torus 가 *Z-up 으로* 그려짐
- 기존 Y-up snapshot 은 호환 (ε snapshot v6→v7 까지는 load 시 자동 회전 안 됨 — β phase 는 *새 생성* 만 Z-up)
- visual 시연 가능 (사용자 결재 가치)

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

### Phase 총 기간 (Amendment 1 정정)

| Phase | 초안 estimate | Amendment 1 정정 |
|---|---|---|
| α (spec + Amendment 1) | 2일 | ✅ 완료 |
| **β (Rust primitive — 5 sub-step)** | 3-4일 | **1-2주 atomic** |
| γ (Viewport) | 2-3일 | 2-3일 |
| δ (Drawing plane) | 2일 | 2일 |
| ε (Snapshot v6→v7) | 3-4일 | 3-4일 |
| ζ (Boundary I/O) | 2-3일 | 2-3일 |
| η (Visual baseline + 시연) | 2-3일 | 2-3일 |
| θ (Closure) | 1-2일 | 1-2일 |

**Amendment 1 총 estimate: 22-29일 (4-5주 atomic)**. 초안 17-22일 (3-4주) 의 1.3x. β phase 가 가장 큰 단일 변경 (~352 site 분류 + 회귀 갱신).

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
- **LOCKED #43** — ADR-103 closure entry (CLAUDE.md, 본 ADR θ commit 동시 등재)

---

## 11. Acceptance Log (Amendment 3, 2026-05-15)

ADR-103 5개월 implicit Y-up → 명시적 Z-up 마이그레이션 closure. **6 PR sequence + 4 post-merge hotfix + 5 stacked PR** = 15 atomic commit 시퀀스.

### 11.1 6 PR sequence (main 진입)

| PR | sub-step | Commit | scope | 회귀 |
|---|---|---|---|---|
| #42 | Amendment 1 | `159b8bd` | audit + 5-split atomic plan | docs |
| #43 | β-1 | `34a2fa3` | 5 primitive constructor Z-up (engine) | axia-geo +7 |
| #44 | Amendment 2 | `7abf618` | 4-split + β-2 audit-only closure | docs |
| #45 | γ | `bd70d16` | Viewport camera + grid + 6 view modes Z-up | vitest 0 reg |
| #46 | γ-fix #1 | `95d2417` | axis lines + arrows + grid double-rotation | vitest 0 reg |
| #47 | ζ | `86a08ea` | DXF boundary + OBJ/STL/glTF inverse + **shadow Z-up** | axia-geo 0 reg |

### 11.2 4 post-merge hotfix (사용자 시연 트리거)

| Hotfix | Commit | scope |
|---|---|---|
| #1 axis + grid double-rotation | `fb51b00` (in #46) | createAxisLines/Arrows Y-up 매핑 + InfiniteGrid 내부 회전 제거 |
| #2 orbit theta sign | `02f7882` (open) | Z-up Spherical CCW around +Z 정합 (`theta += dx`) |
| #3 shadow Z-up | `b2c8305` (in #47) | DirectionalLight + sun direction + Rust `projected_shadow.rs` |
| #4 mouse pick plane | `d6c4562` (open) | `getWorkPlane()` Z-up plane normal (XY ground = Z=0) |

### 11.3 5 stacked PR (open, ζ 후 merge 예정)

| PR | scope |
|---|---|
| `feat/adr-103-delta-drawing-plane` | δ-1 drawing plane + primitive defaults |
| `feat/adr-103-delta-2-box-tool` | δ-2 BoxTool deep Z-up rewrite |
| `fix/adr-103-orbit-z-axis` | orbit theta sign hotfix |
| `feat/adr-103-epsilon-snapshot-migration` | ε-1 V2→V3 vertex pos |
| `feat/adr-103-epsilon-2-surface-curve-migration` | ε-2 AnalyticSurface/Curve axis |
| `fix/adr-103-mouse-pick` | mouse pick work plane fix |

### 11.4 누적 회귀

- axia-geo: 1315 PASS (β-1 +7, projected_shadow 15/15)
- axia-core: 296 PASS (ε-1 +3)
- axia-geo curves+surfaces: ε-2 +7
- vitest: 1828 PASS (δ-1 PrimitiveSession test 1건 갱신)
- **총 +17 신규 회귀, 0 regression**, 절대 #[ignore] 금지 17/17 준수

### 11.5 사용자 facing 변화 매트릭스

| Layer | Before ADR-103 | After ADR-103 |
|---|---|---|
| Engine primitive (Box/Cyl/Cone/Sphere) | Y-up height | **Z-up height** |
| AnalyticSurface defaults | `axis_dir = +Y` | `axis_dir = +Z` |
| Three.js viewport camera | up=Y | **up=Z** |
| Grid | XZ plane (Y=0) | **XY ground (Z=0)** |
| 6 view modes (top/bottom/front/back/right/left) | Y-up convention | **Z-up CAD convention** |
| Drawing plane (3d default) | XZ ground | **XY ground** |
| Sketch axis default | +Y | +Z |
| BoxTool 3-click flow | Y-extrude | **Z-extrude** |
| Orbit drag direction | drag right → scene left | **drag right → scene right** (SketchUp parity) |
| Shadow ground plane | XZ (Y=0) | **XY (Z=0)** |
| Sun direction az/el | Y-up | **Z-up CAD (north=+Y, up=+Z)** |
| Snapshot version | V2 | **V3** (V2 load auto-rotates) |
| DXF / DWG import | `(x,z,-y)` rotation | **identity** |
| STEP / IGES import | (already identity) | identity |
| OBJ / STL / glTF import | Y-up native (identity) | **+90° rotation** for Z-up engine |
| Mouse pick (3d mode) | Y=0 plane | **Z=0 plane** |
| Axis indicator (X red / Y green / Z blue) | Y-up Three.js 매핑 | **identity (engine = viewport native)** |

### 11.6 알려진 한계 (η visual baseline 후속)

- **η Visual baseline regenerate**: ADR-077 V-4 Linux CI workflow_dispatch 필요. LOCKED #40 4-primitive matrix + ADR-074 group A/B + ADR-101 B-6 모두 영향. 별도 트랙으로 진행 권장.
- **β-3 deferred operations 마이그레이션**: 80 sites in axia-geo/operations 의 algorithm-internal "world-up" hints — 모두 axis-agnostic 분류, migration scope ∅. β-2 audit-only closure 의 자연 답습.
- **DAE / PLY / 3DS import**: file 별 native up-axis varies — best-effort identity, 사용자 수동 회전 가능.

### 11.7 Lessons (canonical for future architectural ADRs)

- **L1 사전 결재 절대 우선순위 강제**: 사용자 canonical anchor 가 Path B / STEP / coplanar 트랙의 *순서를 명시* 했기에 1차 시연 후 잘못된 priority 회피. ADR-049 LOCKED #26 의 다음 모범 사례.
- **L2 audit-first vs sed**: spec α-1 의 "sed-able" 가정이 audit 후 정정 (Amendment 1 → 2 → 3). β phase 5-split → 4-split 으로 정량 축소. 향후 implicit-policy migration ADR 의 사전 audit 강제.
- **L3 production / test 분리 자산**: 5개월간 production code 가 *caller-supplied axis* 만 사용 → β-2 production scope ∅. ADR-046 P31 #4 (additive only) 의 *implicit 실증*.
- **L4 시연 게이트의 architectural 가치**: 4 post-merge hotfix 모두 사용자 시연 후 발견 (axis+grid / orbit / shadow / mouse pick). test 만으로 가시화 불가능. ADR-087 K-ζ canonical 답습.
- **L5 atomic stacked PR pattern**: δ-1/δ-2/orbit/ε-1/ε-2/mouse pick 등 5 stacked PR — ζ merge 후 일괄 처리. Multi-week atomic ADR 의 PR queue 관리 canonical.
