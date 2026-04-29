# ADR-026: Cardinal Plane Single Source of Truth (SSOT) — P12

**Status**: **Accepted** (2026-04-29) — Strict invariant + SSOT enforcement
**Strengthens**: LOCKED #7 (cardinal plane snap)
**Related**: ADR-019 ("Line is Truth"), ADR-021 P7, ADR-025 P11, 메타-원칙 #4 (SSOT)

## Context

LOCKED #7 (2026-04-28): "바닥면 좌표 정확성 — DrawRectTool / DrawCircleTool /
DrawLineTool 의 cardinal plane snap." 정책은 **각 도구가 개별적으로**
첫 클릭 좌표를 normal-axis = 0 으로 snap 했다. 이는:

- ❌ 도구별 산발적 구현 — 새 도구 (DrawArc, DrawPolygon, DrawFreehand 등) 추가 시 누락 위험
- ❌ Mouse picking 의 두 번째 클릭 / projection 결과는 ε 오차 잔존
- ❌ Bridge / 외부 API 직접 호출 (test, automation, scripting) 우회 가능
- ❌ 메타-원칙 #4 (SSOT) 위반

사용자 강조 (2026-04-29): "원칙을 강력하게 해주세요."

## Decision

### P12 — 새 원칙

> **Bridge 계층 (`WasmBridge.draw*`) 이 Cardinal Plane Snap 의 단일 진실 원천이다.**
> **모든 draw API 호출의 좌표는 normal 이 cardinal axis 일 때 자동으로 axis-0 으로**
> **snap 된다 (ε ≤ 1e-3 = 1μm 미만 시). 도구 / 테스트 / 스크립트 모든 경로에**
> **동일하게 적용된다.**

### P12 세부 규칙

**P12.1 — SSOT 위치**
- `web/src/bridge/WasmBridge.ts` 의 `drawRect / drawLine / drawCircle / drawPolyline`
- 4 개 helper: `cardinalAxis`, `snapCardinalCenter`, `snapCoplanarCardinal6`,
  `snapPolylineCardinal`

**P12.2 — Snap 조건**
- Normal 이 cardinal: `|nx|>0.999` OR `|ny|>0.999` OR `|nz|>0.999`
- Coord 가 sub-tol: `|coord| < 1e-3` (1μm — engine LOCKED #5 의 1.5μm 미만)
- 두 조건 모두 충족 시 → 정확히 0 으로 강제

**P12.3 — 적용 대상**
- `drawRect(cx, cy, cz, nx, ny, nz, ...)` — center 의 normal-axis 좌표
- `drawCircle(cx, cy, cz, nx, ny, nz, ...)` — center 의 normal-axis 좌표
- `drawLine(x0,y0,z0, x1,y1,z1, ...)` — 양 endpoint 가 같은 axis≈0 면 둘 다 0
- `drawPolyline(points)` — 모든 point 가 같은 axis≈0 면 모두 0

**P12.4 — Defense in Depth**
- LOCKED #7 의 도구별 snap 은 **유지** (UI 단계 첫 방어선)
- Bridge SSOT 는 **마지막 방어선** (모든 호출 경로 보호)
- 두 계층 모두 idempotent — 이미 snap 된 좌표는 변화 없음

**P12.5 — Engine Tolerance 정책 호환**
- Snap tol = 1e-3 (1μm) ≤ LOCKED #5 spatial-hash dedup 1.5μm
- → snap 결과가 spatial-hash 결과를 변경하지 않음 (안전)
- mm 단위 fuzzy snap 정책 위반 아님 (μm 단위 정밀도 보장만)

**P12.6 — 회귀 방지 의무**
- Bridge SSOT 동작은 회귀 테스트 (`describe('ADR-026 P12 cardinal plane SSOT')`)
- 8 개 회귀 테스트 (절대 #[ignore] 금지):
  - drawRect snap (y, z axes)
  - drawRect non-cardinal preserve
  - drawRect above-tolerance preserve
  - drawCircle snap
  - drawLine coplanar snap
  - drawLine non-coplanar preserve
  - drawPolyline all-points snap

## Implementation

### 변경 파일
- `web/src/bridge/WasmBridge.ts`:
  - 새 helper: `cardinalAxis`, `snapCardinalCenter`, `snapCoplanarCardinal6`,
    `snapPolylineCardinal`
  - `drawRect / drawCircle / drawLine / drawPolyline` 진입부에 snap 호출
- `web/src/bridge/WasmBridge.test.ts`:
  - `describe('ADR-026 P12 cardinal plane SSOT')` 8 tests

### 보존된 기존 코드
- `web/src/tools/DrawRectTool.ts`: 첫 클릭 + `getPointOnDrawPlane` snap (defense)
- `web/src/tools/DrawCircleTool.ts`: 첫 클릭 + `getPointOnDrawPlane` snap (defense)
- `web/src/tools/DrawLineTool.ts`: 첫 클릭 + `projectOntoDrawingPlane` snap (defense)

## Trade-offs

### 채택 이유
- ✅ 메타-원칙 #4 (SSOT) 충족 — 단일 정책 enforcement
- ✅ 새 도구 추가 시 자동 보호 (수정 불필요)
- ✅ Test / scripting 경로도 동일 보장
- ✅ Defense in depth — UI 단계 + Bridge 단계 두 방어선
- ✅ idempotent — 기존 snap 코드와 충돌 없음

### 인지된 비용
- ⚠ 미세한 호출 오버헤드 (cardinal axis check + 좌표 비교) — 무시 가능 수준
- ⚠ 중복 snap (UI + Bridge) — 의도된 redundancy

### 기각된 대안
- **Tools snap 만 (현 LOCKED #7)**: 누락 위험. 사용자 요청 "강력하게" 미충족.
- **Engine 단계 snap**: Rust 측 변경 필요, 검증 비용 증가. Bridge 가 더 적절.
- **Tools snap 제거**: UI 즉각 피드백 (preview, dim label) 정확성 위해 유지.

## Migration

### 적용 영향
- LOCKED #7 → "도구 단계 + Bridge 단계 모두 snap" 으로 격상
- CLAUDE.md LOCKED #13 신설 (cardinal SSOT 정책)
- 기존 도구 코드 변경 없음 — backward compatible

### 향후 확장
- Engine 측 검증 (`exportSnapshotStrict` 에 cardinal-coord assertion 추가) — 필요 시
- 사용자 정의 work plane (cardinal 아닌 임의 plane) snap — 별도 ADR
