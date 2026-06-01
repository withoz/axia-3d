# ADR-175 — Face-Hit Drawing Plane (LOCKED #63 amendment)

**Status**: Accepted (demo-verified 2026-06-01 — get3DPoint face-aware, LOCKED #63 amendment)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 시연 (2026-06-01): "박스 만들고 → 윗면에 선 → 면 분할은
안됨", "입체면에 도형그리기가 전혀 안됨".
**사용자 결재 (2026-06-01)**: "LOCKED #63 개정 — 직접 그리기".
**Direct precursors**:
- LOCKED #63 (PR #101, 2026-05-18) — z=0 invariant (face hit 우회) — 본 ADR 이 amendment
- ADR-170/171 (Phase 1/2 absorb, LOCKED #71/72) — drift 해소 인프라
- ADR-140 (surface-aware getDrawPlane) — face-aware 패턴 reference
- ADR-168 (face plane drift snap, LOCKED #69) — drift 흡수

---

## 1. Problem statement

### 1.1 사용자 시연 evidence (2026-06-01)

ADR-172/173 의 "입체면 split" 은 *bridge 직접 호출* (z=200 명시) 로
demo-verified 됐으나, **실제 UI 마우스 경로** 로는 작동 안 함:
- 박스 윗면 클릭 → 선이 z=0 ground 에 그려짐 (면 위 아님) → 면 분할 0
- "입체면에 도형그리기가 전혀 안됨"

### 1.2 Root cause — LOCKED #63 z=0 강제

`ToolManager.get3DPoint` (모든 Draw 도구의 마우스→3D 변환) 이 LOCKED #63
(사용자 결재 2026-05-18 "무조건 z=0") 에 따라:
- **face hit 우회** (viewport.pick 결과 무시)
- **cardinal axis = 0 강제** (3d/top/bottom → z=0)

→ 입체면(z=200) 클릭해도 z=0 으로 강제. 면 위에 안 그려짐.

### 1.3 LOCKED #63 의 원래 motivation (이제 해소됨)

LOCKED #63 의 z=0 강제는 *drift 방지* 목적:
> "viewport.pick(face hit) → 다른 face 의 z 좌표 사용 → drift 전파"

당시(2026-05-18)는 face hit 좌표의 drift 가 split 실패를 유발했음. **그러나
ADR-170/171 absorb 파이프라인** (face plane projection + ADR-168 drift snap)
이 *바로 그 drift* 를 해결 → 입체면 직접 그리기를 안전하게 재활성화 가능.

### 1.4 불일치 — getDrawPlane vs get3DPoint

| 함수 | face-aware? | 사용 도구 |
|---|---|---|
| `getDrawPlane` (ADR-140) | ✅ face hit → 면 plane | DrawRect / DrawCircle |
| `get3DPoint` (LOCKED #63) | ❌ z=0 강제 | DrawLine |

→ get3DPoint 를 getDrawPlane 와 *동일하게* face-aware 로 만들면 일치.

---

## 2. Solution — get3DPoint face-aware (LOCKED #63 amendment)

### 2.1 새 routine

```typescript
private get3DPoint(e: MouseEvent): THREE.Vector3 | null {
  // Sketch mode → sketch plane (보존)
  if (this._sketch) { ... }

  // ─── ADR-175: Face-hit drawing plane (LOCKED #63 amendment) ───
  const faceHit = this.viewport.pick(e.clientX, e.clientY);
  if (faceHit && faceHit.faceIndex != null && faceHit.point) {
    const fid = this.getFaceId(faceHit.faceIndex);
    if (fid >= 0) {
      const [nx, ny, nz] = this.bridge.getFaceNormal(fid);
      // ... face normal 유효성 검사
      const facePlane = setFromNormalAndCoplanarPoint(faceNormal, faceHit.point);
      const facePt = ray.intersectPlane(facePlane);
      if (facePt && finite) return facePt;       // 면 위 점
      return faceHit.point.clone();              // fallback (NaN ray)
    }
  }

  // ─── No face hit → z=0 ground 강제 (LOCKED #63 보존) ───
  // ... cardinal axis = 0 force
}
```

### 2.2 동작 매트릭스

| Cursor 위치 | get3DPoint 결과 |
|---|---|
| **면(solid face) 위** | 그 면 plane 위 점 (z=200 등) — NEW |
| **빈 공간** | z=0 ground 강제 (LOCKED #63 보존) |
| **sketch mode** | sketch plane (보존) |

### 2.3 안전성 (drift 해소)

face hit 좌표의 drift 는 downstream 에서 흡수:
- ADR-170 normalizeDrawInput Step 2 (face plane projection)
- ADR-171 absorb_boundary_input Step 1 (drift projection)
- ADR-168 face plane drift snap (PLANE_SNAP_OFFSET)

→ LOCKED #63 의 원래 우려(drift 전파) 가 absorb 인프라로 해소되어,
face hit 좌표를 안전하게 사용 가능.

---

## 3. Lock-ins

- **L-175-1** get3DPoint face-aware (face hit → 면 plane, no hit → z=0)
- **L-175-2** getDrawPlane (ADR-140) 과 일치 — 두 함수 모두 face-aware
- **L-175-3** LOCKED #63 z=0 강제는 *빈 공간* 에서만 보존 (face hit 시 우회 폐기)
- **L-175-4** Sketch mode 보존 (변경 0)
- **L-175-5** drift 안전성 = ADR-170/171/168 absorb 인프라 의존
- **L-175-6** finite 검증 (degenerate ray → hit point fallback)
- **L-175-7** Engine 변경 0 (TS only)
- **L-175-8** 메타-원칙 #4 (SSOT) + #5 (명확한 의도 자동 — 면 클릭=면 위 그리기)
- **L-175-9** 절대 #[ignore] 금지

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01)

실제 UI 마우스 시뮬레이션 (3D→화면 좌표 투영 + 실제 MouseEvent dispatch):

| 검증 | 결과 |
|---|---|
| pick 박스 윗면 (z=200) | ✅ HIT (point.z=200) |
| line 도구로 박스 윗면 가로선 | ✅ faces **6 → 7** (분할!) |
| 빈 공간 선 (박스 밖) | ✅ 새 vertex z=0 (LOCKED #63 보존) |

→ **사용자 원래 pain point ("입체면에 도형그리기 안됨") 완전 해소.**

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

ToolManagerRefactored.test.ts (+3):
- `face hit → draws on face plane (consults getFaceNormal, NOT z=0 ground)`
  — face 경로 진입 behavioral guard
- `no face hit → z=0 ground force preserved (LOCKED #63)` — 빈 공간 z=0 보존
- `face hit with degenerate normal → falls back to ground (no crash)`

vitest: 131 → 134 (+3, 0 regression).

---

## 6. LOCKED #63 amendment (canonical)

> **LOCKED #63 amendment (ADR-175, 사용자 결재 2026-06-01)**
>
> LOCKED #63 의 "무조건 z=0 강제 + face hit 우회" 는 *빈 공간* 에서만 보존.
> **면(solid face) 위 클릭 시 그 면 plane 에 직접 그려짐** (get3DPoint
> face-aware). drift 안전성은 ADR-170/171/168 absorb 인프라가 보장.
> get3DPoint 가 getDrawPlane (ADR-140) 와 동일하게 face-aware.

---

## 7. Out of scope (future)

- 곡면(curved surface) 위 직접 그리기 — ADR-140 surface-aware getDrawPlane
  은 곡면 tangent plane 제공하나, get3DPoint 는 현재 chord plane (DCEL
  normal). 곡면 위 정밀 그리기는 future (ADR-174 curve-edge 와 별개)
- 2nd+ click 의 면 plane lock (선이 면 밖으로 나가면 z=0 fallback) — 현재
  MVP 는 매 click 마다 면 hit 재판정. 면 plane 고정은 ADR-166 plane lock
  활용 가능 (future)

---

## 8. Cross-link

- **LOCKED #63** PR #101 (z=0 invariant — 본 ADR 이 amendment)
- **LOCKED #69** ADR-168 face plane drift snap (drift 흡수)
- **LOCKED #71/72** ADR-170/171 absorb (drift 해소 인프라)
- **ADR-140** surface-aware getDrawPlane (face-aware 패턴 reference)
- **ADR-166** plane lock (2nd+ click future)
- **ADR-172/173** 입체면 split (bridge-level demo, 본 ADR 이 UI 경로 활성)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical (demo-verified)
- **메타-원칙 #4** SSOT / **#5** 사용자 편의 / **#10** ADR 불변 (LOCKED #63
  amendment via 사용자 결재)
