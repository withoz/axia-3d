# Auto Plane Detection Precheck Audit — 같은 평면 그리기 확률 개선

**Date**: 2026-05-27
**Trigger**: 사용자 요청 (2026-05-27)
> "기본 각 평면에 도형을 그릴때 같은 면에 그려질수 있도록 해야 합니다.
> 자동 평면 감지 기능이 있나요? 사전검토해주세요. 최대한 같은 평면에
> 그려질수 있도록 구현해주세요. 같은 plane에 그릴 확률을 높이는 방향으로
> 개선합니다. 다음세션 진입전에 먼저 체크 바랍니다."

**Purpose**: 자동 평면 감지 자산 inventory + 현재 동작 매트릭스 + 개선
path 후보 + 다음 세션 결재 anchor.

**Outcome**: 자동 평면 감지 *부분 존재* (Sketch mode 의 lastPlane only).
*Non-sketch Draw 도구* 의 *sticky last plane* 미구현. 4 옵션 매트릭스
제시, 다음 세션 결재 후 implementation 진입.

## 1. 사용자 요청 정확 해석

### 1.1 의도

사용자가 도형 도구 (Rect / Circle / Line / Arc / Bezier / Freehand) 로
*첫 도형* 을 그린 후 → *두 번째 도형* 그릴 때 같은 평면 에 그려지길
원함.

**시나리오 예시**:
- top view 에서 RECT × 2 그리기 → 두 번째 RECT cursor 가 첫 RECT 위가
  아니라 빈 공간이어도 같은 XY ground plane 에 그려져야 (현재 OK)
- 3d view 에서 *경사 surface* 위 RECT 그린 후 → 두 번째 RECT cursor 가
  surface 위 아니면 → **현재: XY ground plane** ⚠ (사용자 의도 미스)
- Box 의 측면에 RECT 그린 후 → 두 번째 RECT → **현재: face 미히트 시
  reset** ⚠

### 1.2 핵심 원칙

> "같은 plane에 그릴 확률을 높이는 방향" — 100% guarantee 아닌 확률
> 향상

→ 보수적 (안전) approach 가능. 명시 호출은 별도로 (ContextMenu / panel),
*default 동작* 만 개선.

## 2. 현재 자산 inventory

### 2.1 `getDrawPlane(e: MouseEvent)` — ToolManager core dispatch

**위치**: `web/src/tools/ToolManagerRefactored.ts:2703`

**현재 우선순위 매트릭스**:

| 우선순위 | 조건 | 결과 | 출처 |
|---|---|---|---|
| **1** | Sketch mode (`_sketch`) 활성 | Sketch plane lock-in | 사용자 명시 (sketch 진입) |
| **2** | Cursor 가 face 위 + face hit success | Face normal 기반 plane (ADR-140 surface-aware) | Cursor hit (LIVE) |
| **3** | View-mode default | XY ground / XZ wall / YZ wall (view-mode 별) | View mode (passive) |

**문제점**:
- 우선순위 2 (face hit) → 3 (view-mode) 사이에 *"last drawn plane" / "last touched plane"* 자리 없음
- Cursor 가 약간 face 밖이면 즉시 reset

### 2.2 Sketch mode 의 `lastPlane` (부분 자산)

**위치**: `web/src/tools/ToolManagerRefactored.ts:1083` (`sketch-resume-last` action)

**현재 동작**:
- Sketch mode 종료 시 localStorage `axia.sketch.lastPlane` 에 저장
  (label / origin / normal / up)
- "이전 스케치 재개" 액션 (메뉴) 으로 사용자 명시 호출 시 복원
- Draw 도구 (non-sketch) 에는 *적용 안 됨*

**Gap**:
- Draw 도구의 자동 활용 0
- 명시 호출만 필요 (사용자 부담)
- Session 만 (현재 localStorage 는 cross-session 복원이지만 자동 미활용)

### 2.3 DrawPlaneInfo schema (인터페이스)

**Field**:
- `normal: THREE.Vector3` — plane 법선
- `up: THREE.Vector3` — plane 위 방향
- `right: THREE.Vector3` — plane 오른쪽 방향
- `onFace: boolean` — face hit 결과인지 flag
- `origin?: THREE.Vector3` — (ADR-140 δ) surface-aware origin
- `surfaceKind?: number` — (ADR-140 δ) surface kind metadata

→ Schema 변경 0 으로도 모든 option 지원 가능 (additive only).

### 2.4 cross-cut audit — 다른 자산

| 자산 | 위치 | 평면 감지 관련 |
|---|---|---|
| `viewport.pick(x, y)` | Viewport.ts | face hit detection (uses BVH + raycaster) |
| `SnapManager.findSnap` | SnapManager.ts | endpoint / midpoint / face snap |
| `BoundaryTool` | BoundaryTool.ts | 클릭 점 근처 plane infer (CAD BPOLY pattern) |
| `selectedFaces` | SelectionManager.ts | 사용자 명시 선택 (현재 plane source 미사용) |

→ 활용 가능 source 다수.

## 3. 4 옵션 매트릭스 (개선 path 후보)

### Option A — "Sticky last drawn plane" ⭐ 단순/신속/정확

**원리**: ToolManager 에 `_lastDrawnPlane?: DrawPlaneInfo` 멤버 추가.
Draw 도구가 face 합성 후 자동 저장. `getDrawPlane(e)` 우선순위 #3
(view-mode default) 앞에 `_lastDrawnPlane` 삽입.

**우선순위 매트릭스 (개선)**:

| 우선순위 | 조건 | 결과 |
|---|---|---|
| 1 | Sketch mode | Sketch plane (현재 유지) |
| 2 | Cursor on face | Face hit plane (현재 유지) |
| **3 (NEW)** | **`_lastDrawnPlane` 존재 + face hit miss** | **Last drawn plane (sticky)** |
| 4 | (otherwise) | View-mode default (현재 유지) |

**Lock-ins**:
- Session 만 (localStorage 미사용, 메모리만)
- View mode 변경 시 자동 reset (사용자 의도 변경 신호)
- `clearLastDrawnPlane` API (Sketch mode 종료 시 + view-mode change 시
  자동 호출)
- 명시 reset (ContextMenu "기본 평면으로" 또는 Esc)

**LoC**: ~50-80 (ToolManager 멤버 + 4-5 Draw 도구 hook)
**회귀 자산**: +5 (sticky after first draw / cleared on view change /
cleared on sketch exit / persists across multi-draw / Esc reset)
**예상 시간**: 1주 (multi-week atomic 가능성 *낮음*)
**위험**: 사용자가 의도 미스 시 *잘못된 plane* 에 그려짐 (확률 향상이라
allow)
**메타-원칙 #5 정합**: 사용자 편의 (명확하면 자동 — 마지막 그린 평면이
자연 default)

### Option B — "Recent face plane match" (proximity-based)

**원리**: Cursor hit miss 시 *근처 face* (예: 50-100px 반경) 의 plane
사용. BVH proximity query.

**Lock-ins**:
- pixel threshold 설정 (50-100px)
- 가까운 face 가 여러 개면 *가장 가까운 face* 선택
- Tolerance 명시 (cursor hit과 proximity 분리)

**LoC**: ~80-120
**회귀 자산**: +6 (canonical / multi-face select nearest / threshold
boundary / no nearby face / face inactive / perf)
**예상 시간**: 1주
**위험**: 의도 ambiguous (어느 face?)
**메타-원칙 #5 정합**: 약함 (모호 — 사용자 명시 우선)

### Option C — "Selection-driven plane" (메타-원칙 #16 strict)

**원리**: 사용자가 face 선택 후 그리면 그 face plane lock-in. ContextMenu
"이 평면에 그리기 (lock)" 명시 trigger.

**우선순위 매트릭스**:

| 우선순위 | 조건 | 결과 |
|---|---|---|
| 1 | Sketch mode | Sketch plane |
| **1.5 (NEW)** | **Selection plane lock** | **Selected face plane** |
| 2 | Cursor on face | Face hit plane |
| 3 | View-mode default |

**Lock-ins**:
- 사용자 명시 trigger only (메타-원칙 #16 정합)
- ContextMenu "🎯 이 평면에 그리기 (lock)"
- Lock 해제: 명시 메뉴 또는 다른 face 선택 시
- Session 만 (localStorage 미사용)

**LoC**: ~70-100
**회귀 자산**: +5 (lock canonical / clear on different face / persists
across draws / shortcut to clear / status display)
**예상 시간**: 1주
**위험**: 사용자 부담 (선택 + 메뉴 클릭 단계 필요)
**메타-원칙 #16 정합**: 강함 (명시 trigger)

### Option D — Layered (A + B + C, full UX)

**원리**: 모든 option 활성, layered priority.

**우선순위 매트릭스**:

| 우선순위 | 조건 |
|---|---|
| 1 | Sketch mode |
| 2 | Selection plane lock (Option C) |
| 3 | Cursor on face |
| 4 | Last drawn plane sticky (Option A) |
| 5 | Recent face proximity (Option B) |
| 6 | View-mode default |

**LoC**: ~200-250
**회귀 자산**: +15
**예상 시간**: 2주 multi-week atomic
**위험**: 복잡 — 의도 ambiguous case 다수
**메타-원칙 #5 + #16 정합**: 둘 다 강함

### Option E — Status display only (보존적, 코드 변경 최소)

**원리**: 동작 변경 0. StatusBar 에 "현재 그리기 평면" 표시. 사용자가
미스 인지 → 명시 액션 가능.

**Lock-ins**:
- 동작 변경 0 (priority 매트릭스 unchanged)
- StatusBar "📐 그리기 평면: XY (Z=0)" / "📐 그리기 평면: 면 #42 (Z 법선)"
- 시각 정보 강화만

**LoC**: ~30-40
**회귀 자산**: +2 (display canonical / status update on plane change)
**예상 시간**: 2-3일
**위험**: 0 (display only)
**메타-원칙 #5 정합**: 강함 (사용자 인지 강화)
**한계**: 자동 평면 감지 미해결 (사용자 요청 미완)

## 4. 사용자 요청 vs 옵션 정합 분석

| 사용자 요청 측면 | A (sticky) | B (proximity) | C (selection lock) | D (layered) | E (status) |
|---|---|---|---|---|---|
| "같은 plane에 그릴 확률" 향상 | ✅ 강 | ✅ 중 | ✅ 강 (명시) | ✅ 최강 | ❌ 0 |
| "기본 default 개선" | ✅ | ✅ | ❌ (명시 trigger) | ✅ | ❌ |
| 사용자 부담 최소 | ✅ | ✅ | ❌ | ⚠ | ✅ |
| 단순/신속 (1주) | ✅ | ✅ | ✅ | ❌ (2주) | ✅✅ |
| 메타-원칙 #5 정합 | ✅ | ⚠ | ✅ | ✅ | ✅ |
| 메타-원칙 #16 정합 | ⚠ (자동) | ⚠ (자동) | ✅ (명시) | ⚠ | ✅ |
| 기존 회귀 영향 | 0 | 0 | 0 | 0 | 0 |

## 5. 추천 default

### **(a) Option A (Sticky last drawn plane)** ⭐ 단독 추천

**근거**:
- 사용자 요청 "기본 default 개선" + "확률 향상" 가장 직접 충족
- 단순/신속 (1주, 50-80 LoC)
- 메타-원칙 #5 정합 (명확하면 자동 — 마지막 그린 평면은 자연 default)
- 메타-원칙 #16 약점 보완: view-mode 변경 / Sketch 진입/종료 / Esc 시
  명시 reset path 제공
- 기존 회귀 자산 변경 0

**부가 추천**: Option E (Status display) 를 *β-extension* 으로 동시 진행
가능 — 사용자 인지 강화 (Option A의 의도 미스 시 진단 지원).

### 대안 — **(c) Option D + Status display**

만약 사용자가 "최대화" 우선시 → Option D layered (2주 multi-week atomic)
+ Status display 결합. ADR-141 §3 Sprint 3 (또는 Sprint 4 진입) 시점
가능. ADR 신설 필요.

### 비추천 — **Option C 단독**

사용자 요청 "기본 default 개선" 과 정합 약함 (명시 trigger). 단 향후
명시 lock 기능 추가 시 별도 ADR 가능.

## 6. 다음 세션 결재 매트릭스

### Q1 — Option 선택

- **(a) Option A (Sticky last drawn plane)** ⭐ 추천 — 단순/신속/정확
- (b) Option D (Layered, A+B+C) — 2주 multi-week atomic
- (c) Option E (Status only) — 코드 변경 최소 + Option A 별도 ADR
- (d) Option B (Proximity) — 메타-원칙 #5 약함
- (e) Option C 단독 — 사용자 요청 정합 약함

### Q2 — Reset trigger 정책 (Option A 선택 시)

- **(a) 자동 reset 시점**: view mode change / sketch enter+exit / Esc ⭐ 추천
- (b) 자동 reset 시점: view mode change / sketch only (Esc 미포함)
- (c) 자동 reset 없음 — 사용자 명시 만 (ContextMenu "기본 평면으로")

### Q3 — Status display 동시 진행 여부

- **(a) Yes — Option A + Status display 묶음 ADR** ⭐ 추천 (사용자 인지
  강화)
- (b) No — Option A 만 (Status display 별도 ADR)

### Q4 — ADR 작성 vs spec-less

- **(a) 신규 ADR 작성** ⭐ 추천 — `ADR-XXX (가칭) Auto Plane Detection`
  + Path Z atomic 6-step template (ADR-149/150/151 답습)
- (b) Spec-less canonical fix (사용자 결재 "spec없이") — ADR 생략 시
  evidence 보존 약함

### Q5 — Sprint 3 / Sprint 4 진입 시점

- (a) Sprint 3 (현재) 안에 진입 — ADR-151 + 신규 ADR 동시 진행 (병렬
  가능, 서로 무관)
- **(b) ADR-151 closure 후 진입** ⭐ 추천 — 순차 안전
- (c) Sprint 4 (Healing Pipeline) 시점 — multi-week defer

## 7. Audit 결과 요약 (한 줄)

> 자동 평면 감지 자산 *부분 존재* (Sketch lastPlane only) — Draw 도구
> non-sketch mode 에 *sticky last drawn plane* (Option A) 신설이 사용자
> 요청 가장 직접 충족 + 1주 single-week 가능.

## 8. Cross-link

- `web/src/tools/ToolManagerRefactored.ts:2703` (`getDrawPlane` core
  dispatch)
- `web/src/tools/ToolManagerRefactored.ts:1083` (Sketch lastPlane)
- ADR-140 (Surface-Aware getDrawPlane — 우선순위 #2 의 면 hit 영역
  확장)
- ADR-103 (Z-up + view-mode default plane)
- ADR-026 P12 (Cardinal snap SSOT)
- LOCKED #7 / #43 / #44 / #63 / #65 / #66
- 메타-원칙 #5 (사용자 편의 — 명확하면 자동)
- 메타-원칙 #16 (자동화 antipattern — 명시 trigger 보완)

## 9. 다음 세션 진입 anchor

**우선순위**:
1. **ADR-151 진행 중** — β-1 (Engine enforce_p7_canonical) 결재 후 진입 (1주)
2. **본 audit 결재** — ADR-151 closure 후 (또는 병렬) 진입
3. ADR 신설: `ADR-XXX (가칭) Auto Plane Detection — Sticky Last Drawn`
   + 5 Q 결재 + Path Z atomic 6-step

**예상 timeline**:
- 본 audit 결재 (Q1=a / Q2=a / Q3=a / Q4=a / Q5=b) — 5분
- ADR-XXX α spec — 1일
- β-1~γ — 4-5일
- **합계 1주 single-week**
