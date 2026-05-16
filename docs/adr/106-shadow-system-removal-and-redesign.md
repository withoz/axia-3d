# ADR-106 — Shadow System Removal + Future Redesign (Placeholder)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-16)** — Removal complete. Redesign deferred to future ADR amendment. |
| Date | 2026-05-16 |
| Supersedes | LOCKED #43 #3 (Shadow direction, ADR-103-ζ shadow), Amendment 3 의 ζ-shadow section, `_sunTravel` post-merge hotfix (commit `0f993f6`), ADR-060 §D additive-only baseline (single export deletion 예외 — ADR-076 §C-amendment-1 답습) |
| Related | ADR-103 (Z-up Migration), LOCKED #43, ADR-018 (Uniform Surface Render), ADR-007 (Face Orientation), ADR-060 §D, ADR-076 §C-amendment-1 |

## §C-amendment-1 — ADR-060 additive-only baseline 예외 (2026-05-16)

본 ADR 은 ADR-076 §C-amendment-1 의 cleanup deletion 패턴 답습 — ADR-060 §D "additive-only baseline" 정책의 **두 번째 deletion 예외**.

- 제거된 export: `computeGroundProjectedShadows` (1건)
- 근거: shadow system 의 fundamental misfit 판정 (canonical user 결재). 재구성 시 새 endpoint name 으로 진입 권장 (legacy name 재사용 금지)
- `crates/axia-wasm/tests/export_baseline.txt` 에서 해당 line 제거
- 향후 cleanup ADR 동일 policy 적용 — 명시적 예외 + baseline update 필수

---

## 1. Canonical Anchor (사용자 결재 2026-05-16)

> "우리 엔진과 **맞지 않아** 나중에 안정되면 **새롭게 구성**해서 만드는것이 좋겠습니다"

ADR-103-ζ shadow + 4 post-merge hotfix (sun-travel-sign, axis-grid, shadow location, mouse pick) 누적 후 **fundamental misfit** 으로 판정. 현재 그림자 시스템 전체 제거 → 향후 별도 ADR (본 ADR 또는 amendment) 에서 새로 재구성.

## 2. 제거 scope (atomic 단일 PR)

### 2.1 Engine layer (axia-geo + axia-wasm)
- `crates/axia-geo/src/operations/projected_shadow.rs` (838 LoC) — 파일 삭제
- `crates/axia-geo/src/operations/mod.rs` — `pub mod projected_shadow` 제거
- `crates/axia-wasm/src/lib.rs` — `computeGroundProjectedShadows` WASM export 제거
- `crates/axia-geo/tests/practicality_edge_cases.rs` — shadow 관련 3 회귀 제거
- `crates/axia-geo/benches/practicality_bench.rs` — shadow bench 제거

### 2.2 Viewport layer
- `web/src/viewport/Viewport.ts`:
  - `_projectedShadow`, `_projectedShadowEnabled` field
  - `_sunTravel`, `_dirLight`, `_dynamicShadowFit` field
  - `renderer.shadowMap.enabled = true` + `VSMShadowMap` setup
  - `dirLight.castShadow + shadow.mapSize/camera/bias/normalBias/radius/blurSamples` config
  - `frontMesh.castShadow / receiveShadow`, wall-shadow-caster invisible mesh
  - `setProjectedShadowEnabled / isProjectedShadowEnabled / updateProjectedShadow`
  - `getSunTravelDirection / setSunDirection / getSunAzimuthElevation`
  - `setDynamicShadowFit / _updateDynamicShadowFrustum`

### 2.3 UI layer
- `web/src/ui/SunPanel.ts` (408 LoC) — 파일 삭제
- `web/src/viewport/SolarHeatmap.ts` — 파일 삭제 (shadow 종속)
- `web/src/ui/MenuBar.ts` — `view-shadow-pro` + `solar-heatmap` + `solar-heatmap-off` case 제거
- `web/src/main.ts` — `SunPanel` import + init + `Shift+U` 단축키 제거 + display toggle `shadow` 제거

### 2.4 Tools / Bridge / Telemetry
- `web/src/bridge/WasmBridge.ts` — `computeGroundProjectedShadows` 메서드 + interface 제거
- `web/src/tools/ToolManagerRefactored.ts` — `syncMesh.shadow` block 제거
- `web/src/tools/ToolManagerRefactored.test.ts` — shadow mock 제거
- `web/src/tools/ClashDetection.ts` — `projected-shadow / solar-heatmap` name skip 제거
- `web/src/core/telemetry.ts` — `syncMesh.shadow` budget enum 제거

### 2.5 ADR / LOCKED 정책
- 본 ADR (ADR-106) placeholder 작성
- CLAUDE.md LOCKED #43 #3 의 ζ shadow lock-in 폐기 표시 (이미 *Superseded by ADR-106* 명시)

## 3. 보존된 부분

- AmbientLight + DirectionalLight (조명만, no castShadow) + HemisphereLight + IBL (RoomEnvironment) — **shading 만 담당**
- ACESFilmic toneMapping, exposure 1.0 — visual quality 보존
- Z-up canonical (LOCKED #43) — 좌표계 정합 그대로

## 4. 향후 새 그림자 시스템 진입 시 가이드 (deferred)

본 ADR 의 amendment 또는 후속 ADR 에서 진입 시 검토 항목:

- **Single path strategy**: VSM + Projected shadow 이중 구조 폐기. 단일 path 선택 (e.g., contact shadow only, or analytic ground shadow only)
- **Z-up canonical 처음부터 적용**: ADR-103-ζ hotfix 누적 없이 깨끗하게
- **Sun direction definition 통일**: dirLight.position ↔ sun_travel 이중 표현 폐기
- **Castshadow flag 단순화**: front/back/wall-only 분리 메커니즘 재평가
- **사용자 시연 게이트 강화**: Z-up + view mode + orbit + 그림자 위치 동시 검증
- **Real-runtime baseline**: Playwright visual regression (ADR-077) 가 첫 baseline 만들기

## 5. 회귀 영향

- axia-geo: 1333 → **1318** (-15: 8 internal projected_shadow tests + 3 practicality + 4 보조)
- axia-core: **296 PASS** (unchanged)
- vitest: **1828 PASS** (unchanged)
- 절대 #[ignore] 금지 정책: 0 위반
- 사용자 facing: 그림자 사라짐 (의도된 명확한 상태)

## 6. Initial bundle 영향

`index-*.js`: **749.76 → 732.26 kB (-17.50 kB, -2.3%)**

Shadow 관련 코드 제거로 메인 번들 절감. opencascade-deps (5.37 MB lazy) 무영향.

## 7. Cross-link

- LOCKED #43 ADR-103 (Z-up Migration) — ζ shadow section *superseded by ADR-106*
- ADR-018 (Uniform Surface Render Policy) — shading 정책 보존
- ADR-007 (Face Orientation) — winding 정책 보존
- ADR-077 (Visual Regression Infrastructure) — 향후 새 shadow 시스템의 baseline 인프라
- 메타-원칙 #10 (ADR 불변) — ADR-103 amendment 가 아닌 별도 ADR (ADR-106) 로 처리 — superseded 명시
