# ADR-082 ~ ADR-086 Manual Verification Runbook

**작성일**: 2026-05-08
**대상**: AXiA STEP/IGES import 트랙 (LOCKED #29~#33) 의 사용자 직접 검증
**소요 시간**: 5~10분 (Drift #5 OCCT init 180s+ 흡수)

---

## 0. 목적

ADR-082 ~ ADR-086 의 5개 layer 통합 (architectural / visual / visual
quality / UX / engine state) 이 사용자 facing 경로에서 정상 동작하는지
*직접* 검증.

| Layer | ADR | LOCKED | 검증 포인트 |
|---|---|---|---|
| Architecture | ADR-082 | #29 | OCCT.js chunk 로드, libs init |
| Visual face | ADR-083 | #30 | viewport 에 face mesh 표시 |
| Visual edge | ADR-084 | #31 | face boundary 에 edge wireframe |
| UX progress | ADR-085 | #32 | wait 시 stage 별 Toast 안내 |
| **Engine state** | **ADR-086** | **#33** | **face 선택 + axia DCEL 통합** |

---

## 1. Pre-requisites

```bash
cd web
npm install   # opencascade.js (~250 MB unzipped) + 의존성
```

설치 확인:

```bash
ls -la node_modules/opencascade.js/dist/opencascade.wasm
# 5+ MB 파일 존재 확인
```

---

## 2. Path A — Slow Channel Automated Test (5분, 자동)

CI-적합 단일 ground truth 검증. opt-in 환경변수 활성:

```bash
AXIA_E2E_SLOW=1 npx playwright test e2e/occt-roundtrip.spec.ts
```

### 검증되는 invariants (T-δ + O-ε)

- ✅ `format === 'step'`
- ✅ `faceCount >= 1` (corpus single quad)
- ✅ `traversalFaceCount >= 1` (W-δ)
- ✅ `groupChildrenCount >= 1` (T-γ Three.js Group)
- ✅ `firstChildName` matches `/^face-/`
- ✅ **`bridgeAvailable === true`** (O-δ wiring)
- ✅ **`injectFaceMappingSize >= 1`** (O-δ injectIntoAxia)
- ✅ **`axiaFaceCount >= 1`** (axia engine `bridge.getStats().faces`)
- ✅ **`firstFaceAxiaId` is number** (`userData.axiaFaceId` set)

### 예상 출력

```
Running 1 test using 1 worker

  ok  1 [chromium] › e2e\occt-roundtrip.spec.ts:45:3 › ...
       minimal STEP corpus → traversal + group with face mesh (260.5s)

  1 passed (4.4m)
```

> **Note**: 첫 OCCT init 이 180s+ 소요 (Drift #5). timeout 300s 설정.
> CI default skip 이므로 manual 활성 시에만 실행.

---

## 3. Path B — Interactive Preview (~10분, 인터랙티브)

브라우저에서 직접 import + viewport 확인.

### 3.1 Preview 실행

```bash
cd web
npm run build  # WASM + Vite production build
npm run preview  # http://localhost:4173
```

### 3.2 STEP 파일 import

브라우저에서 `http://localhost:4173` 열기 → 메뉴 **File > Import** →
파일 선택:

- 옵션 1: `web/e2e/fixtures/corpus/test_part_1.step` (제공된 minimal corpus)
- 옵션 2: 사용자 자체 `.step` / `.iges` 파일

### 3.3 Layer 별 체크리스트

#### Layer 1 — Architecture (ADR-082)

- [ ] Toast.info "STEP/IGES 엔진 로딩 중..." 표시
- [ ] DevTools Network 탭에서 `opencascade-deps-{hash}.js` lazy chunk
      fetch (5.37 MB)
- [ ] DevTools Network 탭에서 `module.TK*.wasm` 파일들 fetch
- [ ] (~3분 wait 후) Toast.info "파일 분석 중..." 갱신

#### Layer 2 — Visual Face (ADR-083)

- [ ] (~5분 wait 후) viewport 에 face mesh 표시
- [ ] Front 면: 회색 (#e8e8e8) MeshStandardMaterial
- [ ] Back 면: 보랏빛 회색 (#9898b4) BackSide

#### Layer 3 — Visual Edge (ADR-084)

- [ ] face boundary 에 짙은 파란색 (#333366) line wireframe
- [ ] STEP corpus 의 4 edge 모두 표시 (사각형 경계)

#### Layer 4 — UX Progress (ADR-085)

- [ ] Toast 3 stages 모두 표시 (engine_load → parse → tessellate)
- [ ] 마지막에 Toast.success "STEP import 완료: N면 M엣지"

#### Layer 5 — Engine State (ADR-086) ⭐

- [ ] 사용자가 import 된 face 클릭 → 선택됨 (highlight 표시)
- [ ] DevTools Console 에서 `__axia.get('bridge').getStats()` 실행 →
      `faces >= 1` 확인 (axia DCEL 에 face 존재)
- [ ] DevTools Console 에서 import 된 group 의 face child 의
      `userData.axiaFaceId` 확인 (number, not undefined)
- [ ] (선택적) face 선택 후 Push/Pull 도구 → face normal 방향 extrude
      가능 (Plane variant 의 경우)

---

## 4. 알려진 한계 (현재 트랙 closure 후)

### 4.1 Surface variants 제약 (ADR-086 O-γ-MVP)

- **활성**: Plane / NoSurface (fallback)
- **deferred**: Cylinder / Sphere / Cone / Torus / Bezier / BSpline /
  NURBS — 모두 `injectExternalFaceNoSurface` 로 fallback
- **영향**: Plane 외 surface variants 는 face 선택은 가능하지만,
  curved surface 의 analytic 정보가 axia engine 에 없음 (DCEL boundary
  만)

### 4.2 Inner loops (holes) 미지원 (ADR-086 O-β MVP)

- 외부 boundary loop 만 inject. Hole 이 있는 face 는 `inner_loops_not_supported`
  warning 으로 inject 거부.
- **영향**: 구멍이 있는 STEP face → axia DCEL 통합 안 됨 (viewport
  표시는 정상).

### 4.3 Edge analytic curve attach 미구현

- BRep edge 의 analytic curve (Line / Arc / Circle / Bezier / NURBS)
  는 promote 되지만 axia EdgeId 에 attach 안 됨.
- **영향**: import 된 edge 선택은 Three.js 측만 (selection state),
  engine ops 의 curve-aware 동작 미실현 (e.g., offset along curve).

### 4.4 Drift #5 timing (ADR-082)

- Browser env OCCT init 180s+ 소요. WASM streaming compile / parallel
  libs / cache 등의 architectural 단축은 별도 ADR.
- **영향**: 첫 사용 시 5분 대기 — Toast progress (ADR-085) 가 흡수
  하지만 reload 마다 재발.

---

## 5. 다음 단계 (사용자 결재 후 진입 가능)

| 후보 ADR | 효과 |
|---|---|
| ADR-087 — Surface kinds 확장 | Cylinder/Sphere/NURBS 등 7 variants 활성 — Approach A 자연 완성 |
| Inner loops 지원 | Hole 있는 face import 가능 |
| Edge analytic curve attach | curve-aware engine ops 가능 |
| .axia persistence | Import 결과 저장 (ADR-078 패턴) |
| Drift #5 단축 | WASM streaming / parallel libs / cache (architectural) |

---

## 6. 트러블슈팅

### "STEP/IGES 엔진이 설치되지 않았습니다"

- `npm install` 재실행. `node_modules/opencascade.js/dist/opencascade.wasm`
  존재 확인.

### Toast 가 영구히 "엔진 로딩 중..." 에서 멈춤

- DevTools Network 탭 확인 — WASM 파일들 fetch 가 진행 중인지.
- 첫 init 은 180s+ 정상. 5분 이상 멈춤이면 DevTools Console 의 error
  확인.

### viewport 가 비어있음 (face mesh 안 보임)

- DevTools Console 에서 `__axia.get('bridge').getStats()` 실행 →
  `verts > 0` 인지 확인.
- `BRepMesh_IncrementalMesh` 가 실패 — corpus STEP 파일 형식 검증
  필요.

### face 클릭해도 선택 안 됨

- DevTools Console 에서 import 된 group 의 children 첫 번째 face
  의 `userData.axiaFaceId` 확인.
- `undefined` 면 ADR-086 O-δ wiring 실패 — `bridge.injectExternalFaceNoSurface`
  메서드 존재 확인.

---

## 7. 검증 결과 회고 (사용자 작성)

본 runbook 검증 후 다음 항목 회고 (선택적):

- [ ] Path A (slow channel) 통과? Yes / No
- [ ] Path B (interactive) 모든 layer 체크리스트 통과? Yes / No
- [ ] Demo readiness 평가 (0~100%)
- [ ] 발견된 issue / drift (있는 경우)
- [ ] 다음 ADR 우선순위 제안

검증 결과는 별도 commit 또는 issue 로 기록 가능.

---

*ADR-082 ~ ADR-086 트랙은 STEP/IGES import 의 완전한 layered architecture.
display layer (face/edge) + UX layer (progress) + engine state layer
(axia DCEL injection) 모두 통합. 사용자 facing **industry CAD parity**
첫 활성 (ADR-046 P31).*
