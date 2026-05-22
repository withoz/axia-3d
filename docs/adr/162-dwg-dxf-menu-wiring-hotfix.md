# ADR-162 — DWG/DXF Menu Wiring Hotfix (Path A 시각 only → Path B DCEL routing 정정)

**Status**: Accepted (α spec + β-1 closed — DXF dispatch routing 정정, 2026-05-22)
**Date**: 2026-05-22
**Author**: WYKO + Claude
**Track**: Track 2 (사용자 결재 다중 트랙 병행 진행, 2026-05-22 휴식 후)
**Trigger**: 사용자 요청 "DWG/DXF hotfix — menu wiring fix" + 본 세션
audit-first canonical 19번째 적용 (Track 2 audit).
**Sprint allocation**: 본 ADR 은 Sprint 1~6 plan 외 별도 트랙 — 회귀 +330
target 외 추가 hotfix (사용자 facing critical, defer 부적합).

## Canonical anchor (사용자 결재 + audit-first 19번째 finding)

> 사용자 결재 (2026-05-22 휴식 후 복귀):
> "ADR-162 α-1 spec 작성 (menu wiring fix). 사용자 결재 후 implementation."

→ **DWG/DXF 메뉴 클릭 시 *시각만 표시되고 편집 불가* — 사용자 facing
critical 회귀**. DxfImportHandler (engine DCEL path) 가 main 에 존재
하지만 메뉴에서 호출 안 됨.

## 1. Problem statement

### 1.1 두 import path 매트릭스 (audit-first 19번째 finding)

| Path | 진입 entry | Engine layer (Rust DCEL) | Three.js layer | 사용자 facing 결과 |
|---|---|---|---|---|
| **A (Three.js only)** | `MenuBar.ts:241` `import-dxf/dwg` → `FileImporter.openFileDialog('dxf'/'dwg')` → `FileImporter.importFile()` → `loadDXF/loadDWG` | ❌ skip (참조 메시로만 표시, `FileImporter.ts:9` 명시) | ✅ Three.js Group (`importedGroup`) | **편집 불가** — 단순 참조 표시 |
| **B (Engine DCEL)** | `DxfImportHandler.importDxfFile(deps)` → `bridge.importDxf(data)` → WASM Rust DCEL → `toolManager.syncMesh()` | ✅ WASM Rust DCEL 정상 통합 | ✅ syncMesh 자동 | **편집 가능** — 정상 AXiA face/edge entity |

### 1.2 현재 wiring (사용자 보고 trigger)

`web/src/ui/MenuBar.ts:224-245`:

```typescript
// ── 가져오기 (Import) ──
case 'import-all':
case 'import-obj':
case 'import-stl':
case 'import-gltf':
case 'import-dae':
case 'import-ply':
case 'import-3ds':
case 'import-dxf':       // ← Path A 로 라우팅 (❌ DCEL skip)
case 'import-dwg':       // ← Path A 로 라우팅 (❌ DCEL skip)
case 'import-skp':
case 'import-3dm':
case 'import-step':
case 'import-iges': {
  const format = act === 'import-all' ? undefined : act.replace('import-', '');
  getFileImporter().then(fi => fi.openFileDialog(format as ImportFormat | undefined))
    .catch((err: Error) => { console.error(...); });
  break;
}
```

→ DXF + DWG 가 **OBJ/STL/glTF 와 동일 group dispatch** (Three.js only).
의도: DXF/DWG 는 Path B (Engine DCEL) 분리 라우팅.

### 1.3 DxfImportHandler 의 architectural value (현재 unused)

`web/src/ui/DxfImportHandler.ts` 가 **이미 존재** + 완전 구현 + 회귀 자산:

```typescript
export function importDxfFile(deps: DxfImportDeps): void {
  // 1. file dialog (accept '.dxf')
  // 2. promptUnitScale (DXF $INSUNITS UX)
  // 3. file.arrayBuffer() → Uint8Array
  // 4. bridge.importDxf(data) — WASM Rust DCEL ✅
  // 5. bridge.normalizeForImport() — ADR-007 invariant 정합
  // 6. toolManager.syncMesh() — viewport sync
  // 7. Toast summary (line/polyline/circle/arc/3D면/solid/ellipse)
}
```

**현재 caller**: 메뉴 wiring 부재. 코드 dead path. 회귀 자산 (`DxfImportHandler.test.ts` 7+ tests) 도 dispatch 검증 안 됨.

### 1.4 DWG path 의 추가 복잡성

`FileImporter.loadDWG` (line 335 case 'dwg'):
- 입력: `.dwg` ArrayBuffer
- 1단계: `convertDwgToDxf(buffer)` (dwgdxf, MIT) → DXF Uint8Array
- 2단계: `parseDxf(dxfText)` → Three.js Group
- 출력: importedGroup 에 추가

DWG → DXF 변환 후 *DXF Uint8Array* 가 가용 → Path B (bridge.importDxf) 에
direct 주입 가능. 별도 DWGImportHandler 신설 또는 DxfImportHandler 확장.

## 2. Solution architecture

### 2.1 Phase 1 — DXF 메뉴 dispatch routing 정정

`MenuBar.ts:232` `case 'import-dxf'` 를 통합 case 에서 **분리** + `importDxfFile(deps)` 직접 호출:

```typescript
case 'import-dxf': {
  // ADR-162 β-1 — DCEL routing 정정 (Path A → Path B).
  // 사용자 facing: import 후 즉시 편집 가능 (단순 참조 표시 아님).
  const { importDxfFile } = await import('./DxfImportHandler');
  importDxfFile({ bridge, toolManager });
  break;
}
```

**불변**:
- Path A (FileImporter) 자체 보존 — `import-all` / 다른 mesh 포맷 (OBJ/STL/etc) 동일 사용
- Path B 진입 시 `bridge.importDxf` returns null 인 경우 (legacy/no-WASM env) graceful Err
- DxfImportHandler 의 unit scale UX (`promptUnitScale`) + normalizeForImport + Toast summary 자연 활성

### 2.2 Phase 2 — DWG 메뉴 dispatch routing 정정 (DWG → DXF → DCEL)

`MenuBar.ts:233` `case 'import-dwg'` 도 동일 패턴 분리 + 새 helper (DwgImportHandler.ts) 또는 DxfImportHandler 확장:

```typescript
case 'import-dwg': {
  // ADR-162 β-2 — DWG → DXF 변환 후 DCEL routing.
  const { importDwgFile } = await import('./DwgImportHandler');
  importDwgFile({ bridge, toolManager });
  break;
}
```

**DwgImportHandler 동작**:
1. file dialog (accept '.dwg')
2. `convertDwgToDxf(buffer)` (dwgdxf, FileImporter.ts 답습) → DXF Uint8Array
3. (이후 Path B 와 동일) `bridge.importDxf(dxfData)` → WASM DCEL
4. normalizeForImport + syncMesh + Toast summary

또는 **DxfImportHandler 확장** (단일 helper, 입력 format auto-detect):

```typescript
importDxfOrDwgFile({ bridge, toolManager, format: 'dxf' | 'dwg' });
```

→ Phase 2 의 architectural choice 별도 사용자 결재 (DwgImportHandler 신설 vs DxfImportHandler 확장).

### 2.3 회귀 자산 보강 — menu dispatch evidence

| 시나리오 | 추가 회귀 | 검증 항목 |
|---|---|---|
| MenuBar `import-dxf` click → DxfImportHandler 호출 | +1 | dispatch 정합 |
| MenuBar `import-dwg` click → DwgImportHandler (또는 extension) 호출 | +1 | dispatch 정합 |
| MenuBar `import-obj` (regression) → FileImporter Path A 유지 | +1 | regression guard |
| MenuBar `import-all` (regression) → FileImporter Path A 유지 | +1 | regression guard |
| bridge.importDxf null 시 (legacy/no-WASM) → graceful Err | +1 | failure mode |
| **합계** | **+5** | menu wiring 정합 강제 |

## 3. Sub-step plan (Path Z atomic, β~η)

| Sub-step | 의도 | 회귀 | 소요 |
|---|---|---|---|
| α (본 ADR) | spec only | +0 | (현재) |
| β-1 | DXF dispatch 정정 (Path B routing) + 회귀 +3 | +3 | 1~2시간 |
| β-2 | DWG dispatch 정정 (DwgImportHandler 또는 extension) + 회귀 +2 | +2 | 2~3시간 |
| γ | 사용자 시연 게이트 (ADR-087 K-ζ canonical) — 실제 DXF/DWG 파일 import + 편집 검증 | +0 | 1시간 |
| δ | closure docs + Acceptance log | +0 | 30분 |
| **합계** | **DXF/DWG menu routing 정합 강제** | **+5** | **3~6시간** |

각 sub-step 단일 atomic PR (LOCKED #44 정합).

## 4. Lock-ins

- **L-162-1** DXF/DWG 메뉴 dispatch = Path B (Engine DCEL) only. Path A (FileImporter Three.js only) 는 OBJ/STL/glTF/DAE/PLY/3DS/3DM 만.
- **L-162-2** DxfImportHandler.importDxfFile **재사용** — 신규 helper 0 (β-1 scope).
- **L-162-3** DWG path β-2 architectural choice 별도 사용자 결재 (DwgImportHandler 신설 vs DxfImportHandler 확장).
- **L-162-4** Path A 회귀 자산 보존 — `import-all` / 다른 mesh 포맷은 변경 0.
- **L-162-5** bridge.importDxf null fallback graceful — legacy/no-WASM env 에서도 alert 명시.
- **L-162-6** Unit scale UX (promptUnitScale) + normalizeForImport (ADR-007 invariant) 자연 활성.
- **L-162-7** ADR-046 P31 #4 additive only — MenuBar 외부 API + import 행위 자체 UNCHANGED, dispatch 만 정정.
- **L-162-8** 절대 #[ignore] 금지 5/5 강제.
- **L-162-9** LOCKED #44 (Complete Meaning per Merge) — β-1 + β-2 별도 atomic PR (각각 DXF / DWG 의 독립 의미 단위).
- **L-162-10** ADR-141~161 reserve 외 별도 트랙 — 회귀 +5 가 Sprint 1~6 +330 target 외 누적.

## 5. 사용자 facing 변화 매트릭스

| 시나리오 | Before β | After β |
|---|---|---|
| 메뉴 → DXF 가져오기 → DXF 파일 선택 | ✅ 시각 표시 / ❌ 편집 불가 (참조 메시) | ✅ 시각 표시 + ✅ 편집 가능 (Engine DCEL) |
| 메뉴 → DWG 가져오기 → DWG 파일 선택 | ✅ 시각 표시 / ❌ 편집 불가 | ✅ 시각 표시 + ✅ 편집 가능 (DWG→DXF→DCEL) |
| 메뉴 → OBJ/STL/glTF/etc 가져오기 (regression) | ✅ 시각 표시 (참조 메시) | ✅ 시각 표시 (보존) |
| 메뉴 → STEP/IGES 가져오기 (regression) | ✅ ADR-035 P20.7 dynamic loader | ✅ (보존) |
| DXF import 후 `move` / `push-pull` / `boolean` ops | ❌ Three.js Group 만, 도구 적용 불가 | ✅ 정상 작동 (Engine DCEL face/edge entity) |
| Unit scale UX (DXF $INSUNITS) | ❌ FileImporter Path A 미적용 | ✅ promptUnitScale 활성 |
| Normalize on import (ADR-007 invariant) | ❌ FileImporter Path A 미적용 | ✅ `bridge.normalizeForImport()` 활성 |

## 6. Cross-link

### LOCKED 정책 정합

- LOCKED #1 ADR-021 P7 (superseded by ADR-139) — DCEL face synthesis 정합
- LOCKED #7 ADR-026 P12 (Cardinal plane SSOT) — DXF/DWG 의 cardinal-aligned coords 정합
- LOCKED #15 P22.5 ADR-037 (owner-ID uniformity) — import 후 face/edge metadata 정합
- LOCKED #43 ADR-103 (Z-up) — DXF/DWG 좌표계 transform 정합
- LOCKED #44 (Complete Meaning per Merge) — β-1 + β-2 별도 atomic PR
- LOCKED #65 ADR-141 (Master Roadmap) — 본 ADR 은 reserve 외 트랙 (Sprint 1~6 +330 외 +5 추가)

### 메타-원칙

- 메타-원칙 #1 (기존 명령은 모두 그대로) — 메뉴 외부 API UNCHANGED
- 메타-원칙 #2 (외부 참조는 형태/모양만) — Path A 의 "참조 메시" 정의를 DXF/DWG 에서 강제 분리 (DCEL 으로 라우팅)
- 메타-원칙 #6 (Preventive over Curative) — dead code path (DxfImportHandler unused) 활성
- 메타-원칙 #9 (회귀 없음) — 절대 #[ignore] 금지 5/5
- 메타-원칙 #10 (ADR 불변) — 본 ADR + Amendment 절차

### Cross-ADR 답습

- ADR-007 Face Orientation Policy — `bridge.normalizeForImport()` invariant 정합 source
- ADR-026 P12 Cardinal plane SSOT — DXF 의 axis-aligned 좌표 자동 snap
- ADR-035 P20.7 STEP/IGES dynamic loader — Path A 내부 격리 패턴 답습 (DXF/DWG 도 Path B 분리)
- ADR-046 P31 #4 (additive only) — 메뉴 외부 API + 사용자 행동 UNCHANGED
- ADR-049 P-5e-α (default OFF + opt-in canonical) — 본 ADR scope 외 (DXF/DWG 은 사용자 명시 의도)
- ADR-103 (Z-up migration) — DXF/DWG 좌표계 transform 정합 (별도 ADR scope)
- ADR-141 (Master Roadmap) — 본 ADR 은 reserve 외 트랙

## 7. Out of scope (deferred)

본 ADR scope 외 (모두 별도 ADR 또는 future track):

- **3DM / SKP / IFC 등 다른 DCEL-capable 포맷의 동일 routing 정합** — 별도 ADR 또는 ADR-162 후속 amendment
- **DXF export** (Path A 의 inverse) — `DxfExporter.ts` 별도 dispatch, 본 ADR 은 import 만
- **DWG → DCEL direct conversion** (DXF 중간 변환 회피) — dwgdxf alternative 또는 OCCT.js confidence 후 future ADR
- **STEP/IGES 메뉴 dispatch 동일 패턴 정합** — ADR-035 P20.7 dynamic loader 가 *별개 architectural value path* — 별도 ADR scope
- **Sketch session 통합 시 import 결과의 sketch plane 자동 align** — ADR-049 sketch mode 별도 트랙
- **DXF entity 별 layer / color metadata 의 axia layer mapping** — `DxfSceneBuilder.ts` 별도 트랙

## 8. 변경 시 필수 절차 (메타-원칙 #10)

본 ADR 변경 시:
1. 사용자 **명시적 확인** 요청
2. 사용자 동의 시 진행
3. 변경 시 새 ADR 작성 (본 ADR 은 `Superseded by ADR-XXX` 표시)
4. ADR-162 자체는 ADR-141~161 reserve 외 트랙 — Master Roadmap LOCKED #65 매트릭스 영향 0
5. 변경 사유 + 영향 범위 commit message 명시

## 9. Acceptance Log

### α (spec only — 본 commit)

- **Trigger**: 사용자 결재 (2026-05-22 휴식 후) + audit-first canonical 19번째 적용
- **산출물**: 본 ADR doc (~250 lines)
- **회귀**: +0 (docs only)
- **다음 sub-step**: β-1 (DXF dispatch 정정) — 사용자 결재 후 진행

### β-1 (DXF dispatch routing — 본 commit, 2026-05-22)

- **Trigger**: ADR-162 α spec closure + 사용자 결재 "옵션 A 단독 진행"
- **변경 (3 files)**:
  - `web/src/ui/MenuBar.ts:230-261` — `case 'import-dxf'` 통합 case 에서 **분리** + `await import('./DxfImportHandler').then(...)` direct dispatch. DWG/OBJ/STL/glTF/etc Path A 보존 (regression guard).
  - `web/src/ui/MenuBar.test.ts` — ADR-162 β-1 회귀 자산 +4 (DXF Path B / OBJ Path A regression / DWG Path A regression / All Path A regression)
  - `docs/adr/162-dwg-dxf-menu-wiring-hotfix.md` — Status 갱신 + β-1 Acceptance entry
- **회귀**: web/vitest MenuBar.test **32 → 36** (+4, 절대 #[ignore] 금지 4/4 준수)
- **사용자 facing 변화**:
  - **Before**: 메뉴 → DXF 가져오기 → FileImporter Path A → Three.js Group "참조 메시" → **편집 불가**
  - **After**: 메뉴 → DXF 가져오기 → DxfImportHandler Path B → `bridge.importDxf()` → WASM Rust DCEL → `normalizeForImport()` (ADR-007 invariant) → `toolManager.syncMesh()` → **편집 가능** (axia Engine DCEL face/edge entity)
  - Unit scale UX (`promptUnitScale`) + Toast summary 자연 활성
- **불변 (regression guard 강제)**:
  - DWG case 'import-dwg' — Path A 임시 유지 (β-2 별도 atomic PR architectural choice 별도 결재)
  - OBJ/STL/glTF/DAE/PLY/3DS/SKP/3DM/STEP/IGES — Path A 보존 (mesh 포맷 참조 메시)
  - `import-all` — Path A 보존
- **다음 sub-step**: β-2 (DWG dispatch routing — DwgImportHandler 신설 vs DxfImportHandler 확장 architectural choice 별도 사용자 결재)

### β-2 ~ δ Acceptance (향후 작성)

각 sub-step 종료 시 본 §9 에 추가 entry 작성.

## 10. Lessons (audit-first canonical 19번째)

**L1 — dead code path 의 architectural risk**: DxfImportHandler 가 main
에 완전 구현되어 있지만 메뉴 wiring 부재로 dead path. 회귀 자산 (`Dxf
ImportHandler.test.ts`) 도 실제 메뉴 dispatch evidence 가 아닌 unit
contract 만 검증. → 향후 모든 import handler 신설 시 **메뉴 dispatch
회귀 자산 강제** (사용자 facing path 검증).

**L2 — Path A vs Path B 분리의 architectural value**: Path A (Three.js
only) 는 OBJ/STL/glTF 의 *참조 메시* 정의에 부합, Path B (Engine DCEL)
는 DXF/DWG/3DM 의 *편집 가능 entity* 정의에 부합. 두 path 명시 분리로
사용자 facing 의도 명확화.

**L3 — audit-first canonical 19번째 적용 evidence**: 사용자 hotfix
요청 → 즉시 menu dispatch + handler 두 layer cross-audit → dead path
finding. 향후 모든 hotfix 요청 시 **현재 code reality audit 우선**
(가정 회피).

**L4 — Sprint 외 트랙의 architectural cost**: 본 ADR (+5 회귀) 은
Sprint 1~6 +330 외 추가. 사용자 facing critical 한정으로 정당화 — 일반
feature 는 Sprint reserve 내 plan 강제.
