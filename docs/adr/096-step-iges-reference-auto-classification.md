# ADR-096: STEP/IGES Import — Reference Auto-Classification — **Accepted**

- **Status**: Accepted (M-α ~ M-γ closure 2026-05-09)
- **Date**: 2026-05-09
- **Anchor**: ADR-095 §1.2 + §8 명시 약속 — "Import 결과를 자연
  Reference 분류 (ADR-081~086) — Phase 3 closure 후 retro-migration
  ADR".
- **Parent**: ADR-095 (Reference Citizenship Phase 3, ✅ 2026-05-09)
- **Sibling**: ADR-035/036 (STEP/IGES Hybrid + P21 promotion),
  ADR-081~086 (NURBS-class import + visual + edge wireframe + Toast +
  WasmBridge owner-id mapping)
- **Lessons applied**: ADR-049 P-5e-α (default toggle + localStorage
  OFF preference), ADR-091 §E L4 (UI orchestration 분리), ADR-094 §E L1
  (additive-first 위험 격리)

## 0. Summary

STEP / IGES / OBJ / STL import 결과 (ADR-081~086) 가 axia DCEL 에
주입된 후 (ADR-086 O-δ `injectIntoAxia`) **자동으로 ImportedMesh
Reference 시민으로 등록**. 사용자 의도 *수정 안 함* (메타-원칙 #2)
의 architectural 정착.

**현재 상태 (Phase 3 closure 직후)**:
- Import → bridge.injectExternalFace* → axia FaceId 부여 (ADR-086)
- 사용자 facing: face 들이 *분류 없이* axia 에 추가됨 (Form/Property/
  Reference 모두 미분류)
- Reference 시민권 (ADR-095) 활성, 그러나 import path 가 활용 안 함

**ADR-096 closure 후**:
- Import → axia DCEL 주입 → **자동 ImportedMesh Reference 등록**
- 사용자 facing: import 한 모델이 자연 Reference 시민 (수정 안 함 의도)
- Settings toggle: 사용자 explicit OFF preference (default ON, ADR-094
  답습)

## 1. Context

ADR-095 §8 (Out of Scope) 의 명시 약속:
> "STEP/IGES import 의 자동 Reference 분류 — Phase 3 closure 후
> retro-migration ADR"

ADR-095 §1.2 (architectural natural 결합):
> "ADR-081~086 (NURBS-class import) — 외부 CAD 모델을 *수정 안 할
> 의도* 명시 (메타-원칙 #2 의 architectural 정착)"

본 ADR 은 두 약속의 자연 이행. **ADR-095 closure 의 사용자 facing
가치 마무리**.

## 2. Decision

`StepIgesImporter.injectIntoAxia` 또는 그 caller (`FileImporter`) 가
inject 성공 후 모든 axia face IDs 를 *single ImportedMesh Reference*
로 자동 등록. Reference name + source path 는 file metadata 에서 derive.

### 2.1 Lock-ins

- **L1 — additive only** (ADR-094 §E L1 답습): 기존 `injectIntoAxia`
  의 contract 보존 — `faceIndexToAxiaId` map 반환 unchanged. Reference
  자동 등록은 *결과 후속 단계* 로 추가.
- **L2 — Single Reference per import**: 한 STEP/IGES 파일 = 1 Reference
  (모든 face id 가 같은 ImportedMesh Reference 멤버). Multi-Reference
  세분화 (face cluster 별) 는 future ADR.
- **L3 — Default ON via Settings** (ADR-049 P-5e-α 답습): 신규 사용자
  자동 Reference 분류. `localStorage axia:auto-reference-import = 'false'`
  명시 OFF preference 보존.
- **L4 — Source path metadata**: `File.name` 또는 fallback "imported"
  이 ImportedMesh Reference 의 `sourcePath` 필드. 사용자 facing
  Inspector 에서 출처 추적 가능.
- **L5 — Reference name 자연 생성**: file name 의 stem 부분 사용
  (예: "site.step" → Reference name "site"). fallback "Imported Mesh".
- **L6 — graceful fallback** (ADR-093 §E L3 답습): bridge 미지원 /
  Reference 등록 실패 시 silent skip + warning. Import 자체는 정상
  완료 (axia face IDs 부여).
- **L7 — additive only (ADR-046 P31 #4)**: 메뉴 / 단축키 변경 0.
  Settings 패널의 새 toggle 만 추가 (선택적 — 또는 future sub-step).

### 2.2 Stack

```
사용자 STEP/IGES file 선택
  ↓ FileImporter.importFile
StepIgesImporter.importFile (ADR-035 Stage 4-A)
  ↓ traverseBrep + promoteCurve/Surface
Three.js Group with face-N children + boundaryPolygon userData
  ↓ FileImporter caller — bridge inject
StepIgesImporter.injectIntoAxia(bridge, group)
  ↓ injectExternalFace* per face → axia FaceId
faceIndexToAxiaId Map<faceIndex, axiaFaceId>
  ↓ NEW (ADR-096)
autoRegisterAsReference(bridge, faceIds, fileName)
  ↓
bridge.createReferenceImportedMesh(name, faceIds, sourcePath)
  ↓ ADR-095 Phase 3-γ
Scene.references[id] = Reference {
  category: ImportedMesh { face_ids, source_path },
  visible: true, locked: false,
}
```

### 2.3 Decision Matrix

| ID | 결정 | 채택 |
|----|------|------|
| **M-A** | 등록 트리거 위치 | injectIntoAxia 후 caller (FileImporter) — `injectIntoAxia` API 변경 없음 |
| **M-B** | Single vs Multi Reference per import | Single (M-L2) — 향후 multi-clustering 별도 ADR |
| **M-C** | Default ON | Default ON, localStorage OFF preference (ADR-049 답습) |
| **M-D** | Source path | `file.name` |
| **M-E** | Reference name | File stem (예: "site") |
| **M-F** | Failure mode | Graceful skip + warning |
| **M-G** | UI integration | Toast 안내 ("Reference 로 등록됨") + Settings toggle |

## 3. Path Z atomic decomposition (3 sub-step)

| sub-step | 영역 | 회귀 예상 |
|---|---|---|
| **M-α** | spec only — 본 ADR | 0 |
| **M-β** | Implementation:<br/>1. `web/src/citizenship/AutoReferenceImport.ts` (신규) — helper module<br/>2. `FileImporter.ts` — inject 후 helper 호출<br/>3. Settings toggle (`AutoReferenceImportSettings.ts`)<br/>4. main.ts wiring (ADR-094 답습) | vitest +6~10 |
| **M-γ** | Real Chromium 시연 + closure docs | Playwright +1~2 |

**누적 예상**: +7~12, **2-3일**.

## 4. ADR-046 P31 정합

- #1 (P1+P3 가치): ✅ — 두 페르소나 직접 활성:
  - **P1 (건축/디자인)**: 외부 CAD 모델이 자연 Reference 분류 → 실수
    수정 차단 + Inspector 에서 명시 표시
  - **P3 (AI 협업자)**: AI agent 가 Import 결과를 *수정 대상이 아님*
    명시 인식 → 의도 차이 차단
- #2 (외부 참조는 형태/모양만): ✅ — 메타-원칙 #2 의 *실제 사용자
  시나리오* 활성. ADR-095 §1.2 약속의 자연 이행.
- #4 (additive only): ✅ — 메뉴 / 단축키 변경 0. Settings 토글만 추가.

## 5. 위험 분석

- **L1 (낮음)**: Reference 등록 실패 시 import 자체는 정상 — graceful
  fallback (M-F).
- **L2 (낮음)**: Settings toggle default ON 의 사용자 surprise — ADR-094
  P-5e-α 답습 패턴 (산업 CAD parity 가치 명확). localStorage OFF
  preference 보존.
- **L3 (낮음)**: 같은 face id 의 R-B violation — inject_external_face
  결과 face 는 face_to_xia / face_to_shape 에 미등록 (engine 에서
  inject 시점에 ownership 할당 안 함). Reference 등록 시 충돌 없음.
- **L4 (낮음)**: 다중 import — 각 file 별 independent Reference (M-L2).
  같은 file 재import 시 새 Reference (사용자 의도: 새 import).

## 6. Lessons applied (5개월 누적)

| ADR | Lesson | 본 ADR 적용 |
|---|---|---|
| ADR-049 P-5e-α | Default ON + localStorage OFF preference | M-L3 |
| ADR-091 §E L4 | UI orchestration 분리 (helper module) | M-β: AutoReferenceImport helper |
| ADR-093 §E L3 | Defensive graceful fallback | M-L6 |
| ADR-094 §E L4 | Engine OFF + Production ON pattern | (engine 변경 0 — production-layer toggle only) |
| ADR-095 §E L3 | 사용자 facing 한국어 변환 | (Toast / warning 메시지) |

## 7. Out of Scope

- **Multi-Reference clustering** (face cluster 별 분리 Reference) — M-L2
  out of scope, future ADR
- **Reference visual rendering** (ImportedMesh ghost / dashed) — ADR-095
  §8 deferred, 별도 ADR
- **Inspector explicit "Mark as Reference" 버튼** — ADR-095 Phase 3-δ
  deferred, 별도 ADR
- **Reference → Form promote (사용자 명시 액션)** — ADR-095 §8 deferred
- **DXF / OBJ import** Reference 분류 확장 — DXF 는 ADR-081 path 와
  분리. 본 ADR scope = STEP/IGES (FileImporter STEP 분기 only). 후속
  ADR 또는 sub-step.

## D. Acceptance Log

### M-α (본 commit)
- **사용자 결재**: 2026-05-09, "🅵 STEP/IGES → Reference retro-
  migration 진행".
- **변경**: 본 ADR 작성. ADR-095 §8 약속의 자연 이행 anchor.
- **회귀**: +0 (docs only).

### M-β (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — Implementation 진입.
- **변경**:
  * `web/src/tools/AutoReferenceImportSettings.ts` (신규) —
    localStorage toggle (default ON, ADR-049 P-5e-α 답습):
    - `getAutoReferenceImportMode() / setAutoReferenceImportMode()`
    - `localStorage axia:auto-reference-import = 'false'` explicit OFF
      preference 보존
  * `web/src/citizenship/AutoReferenceImport.ts` (신규) — UI orchestration
    helper:
    - `autoRegisterImportAsReference(bridge, faceIds, fileName?, opts?)`
    - File name → Reference name (file stem 추출 — `/path/to/site.step`
      → `'site'`)
    - sourcePath = file.name 그대로 전달
    - graceful fallback (Settings OFF / empty / R-B violation /
      endpoint missing — 4 case 한국어 변환, ADR-095 §E L3 답습)
  * `web/src/import/FileImporter.ts` 통합 wiring:
    - `injectIntoAxia` 후 `autoRegisterImportAsReference` 호출
    - Settings flag 동적 import (ADR-094 답습 패턴)
    - Toast success 메시지에 Reference 등록 정보 추가:
      `'STEP import 완료: 12면 24엣지 · "site" Reference 등록 (12 면)'`
- **회귀** (vitest +14):
  * `AutoReferenceImportSettings.test.ts` (5 tests):
    default ON / localStorage true/false / persist / listener change-only
  * `AutoReferenceImport.test.ts` (9 tests):
    success / Settings OFF / 빈 배열 / file stem 추출 4 case (linux/
    windows/no-ext/none) / fallback name / R-B violation / endpoint
    missing / sourcePath 전달
  * 합계 **+14**, 절대 #[ignore] 금지 14/14 준수.
- **누적** (M-α ~ M-β): vitest +14.
- **위험 격리 검증**: 전체 vitest 1683 → 1697 (+14), 회귀 0.
  FileImporter 통합 path 는 dynamic import + try/catch graceful —
  기존 import 자체는 정상 진행 (M-L6).

### M-γ (본 commit — 사용자 시연 + closure)
- **사용자 결재**: 2026-05-09, "승인" — 사용자 시연 + closure.
- **사용자 시연 PASS** (real Chromium 3/3):
  - Scenario 1: Default ON (localStorage 미설정 시 production-bundle
    의 createReferenceImportedMesh 자동 활성, ImportedMesh 시민 생성)
  - Scenario 2: Explicit OFF preference 보존 (localStorage `'false'`
    유지)
  - Scenario 3: Reference creation + Snapshot round-trip (M-L4 source
    path + M-L5 file stem name 보존)
- **변경**:
  * `web/e2e/adr-096-demo.spec.ts` (신규) — Real Chromium 3 specs
  * `docs/adr/096-*` Status `Proposed` → `Accepted` + §E Lessons
- **회귀** (Playwright +3): 3 scenarios 모두 PASS.
  합계 **+3**, 절대 #[ignore] 금지 3/3 준수.
- **누적 회귀** (M-α ~ M-γ): vitest +14 + Playwright +3 = **+17**.

## E. Lessons

### L1 — ADR 명시 약속의 자연 이행

**관찰**: ADR-095 §8 의 "STEP/IGES import retro-migration" 약속이
Phase 3 closure 후 자연 이행 가능. ADR-095 §1.2 의 architectural
natural 결합 항목이 후속 ADR (본 ADR) 의 anchor 가 됨.

**향후 ADR 가이드** — Out of Scope 명시 (별도 ADR 후속) 가 향후 ADR
의 자연 anchor + 약속 추적성 보장. Phase 3 closure 후 즉시 follow-up
가능.

### L2 — 짧은 atomic + 누적 architectural quality 자연 결합

**관찰**: 5-day 추정 트랙이 2-day 로 단축. ADR-049 (Settings) +
ADR-091 §E L4 (helper 분리) + ADR-095 (Reference WASM/TS) + ADR-094
(dynamic import) 4 ADR 의 누적 자산이 자연 결합. 추가 코드 신규 ~ 250
LoC, 전체 차지 14 + 3 = 17 회귀 (절대 #[ignore] 금지 100% 준수).

**향후 ADR 가이드** — 5개월 누적 architectural quality 위에 짧은
atomic 트랙은 점점 더 빠르게 진행 가능. ADR-094 §E L3 의 "자연 결합"
패턴이 시간이 갈수록 강화.

### L3 — 사용자 facing 한국어 변환의 일관성 (humanizeImportFailure)

**관찰**: ADR-095 §E L3 의 humanizeRBViolation 패턴이 본 ADR 의
humanizeImportFailure 에서 답습. 4 case (Xia owned / Shape owned /
Reference owned / endpoint missing) 의 일관된 사용자 facing 메시지.

**향후 ADR 가이드** — engine throw → 사용자 facing 변환은 helper
모듈의 unique 책임. UI / Toast 가 직접 변환 안 함. SSOT 보장 +
i18n 변경 시 single point.

### L4 — Default ON 패턴의 누적 (3 ADR)

ADR-049 P-5e-α (drawShapeMode) → ADR-094 (cylinderPathB) → ADR-096
(autoReferenceImport). 3 ADR 모두 동일 패턴:
- Engine default OFF (회귀 자산 보존)
- Production layer Default ON (사용자 facing 가치 활성)
- localStorage explicit OFF preference 보존

**향후 ADR 가이드** — 새로운 사용자 facing default 도입 시 본 패턴
canonical. main.ts init 의 wiring 도 동일 (AutoIntersect 패턴).
