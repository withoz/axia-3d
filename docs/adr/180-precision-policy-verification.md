# ADR-180 — Engine Precision Policy Verification (mm/f64, EPS hierarchy)

**Status**: Accepted (2026-06-01 — 명시·검증 + 회귀 lock + stale 주석 정정)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 질문 (2026-06-01): "우리 엔진의 정밀도가 부족한 이유인가?
단위 + EPS mm/f64, EPS 1e-4mm (0.1μm) 명시·검증 해주세요".
**Anchor**: LOCKED #5 (엔진 허용오차 정책) + ADR-147 (Spatial-hash precision
strict) + ADR-167/168 (EPS_PLANE / PLANE_SNAP SSOT).

---

## 1. 결론 — 엔진 정밀도는 충분 (정밀도 부족이 아님)

사용자가 본 imprecision (RECT 미리보기 9893mm 폭발, 미리보기/외곽선 불일치)은
**엔진 정밀도 문제가 아님** — TS 레이어 (미리보기 quaternion 방향 + grazing
plane ray projection) 문제. 엔진은 mm/f64 로 정밀.

브라우저 ground-truth: 면 위 projection 측정 시 projected = rawPick 정확 일치
(0 오차).

---

## 2. 엔진 정밀도 정책 (canonical, 명시)

### 2.1 단위 + 자료형

| 항목 | 값 |
|---|---|
| **단위** | mm (millimeter) |
| **좌표 자료형** | `f64` (`glam::DVec3` = 3×f64 = 24 bytes) |

모든 mesh 좌표는 mm 단위 f64. f32 는 *렌더 버퍼* 에만 (WASM→Three.js export
시 변환) — DCEL 진실값은 f64.

### 2.2 EPS 계층 (tolerance hierarchy)

| 상수 | 값 (mm) | 의미 | 용도 |
|---|---|---|---|
| `VERTEX_TOLERANCE` | `1e-7` (0.0001μm) | 정밀 coincidence | `Vertex::coincident` |
| **`SPATIAL_HASH_CELL`** | **`1e-4` (0.1μm)** | 공간 해시 grid cell | dedup 후보 수집 |
| **dedup tolerance** | **`1.5e-4` (0.15μm)** | vertex dedup 임계 (cell × 1.5) | `add_vertex` / `find_existing_vertex` |
| `EPSILON_LENGTH` | `1e-6` (0.001μm) | 1D 실효 길이 하한 | degenerate 판정 |
| `EPS_PLANE_OFFSET` (ADR-167) | `1.5e-3` (1.5μm) | plane 동일성 판정 | `same_plane` |
| `PLANE_SNAP_OFFSET` (ADR-168) | `1e-4` (0.1μm) | plane drift snap | face plane 보정 |

**사용자의 "EPS 1e-4mm (0.1μm)"** = `SPATIAL_HASH_CELL` ✓ (정합).
dedup 임계는 cell × 1.5 = 0.15μm (cell 경계 f32 drift 흡수 위해 1.5×).

### 2.3 ADR-147 Scenario B1 amendment (2026-05-27) 정합

ADR-147 이 `SPATIAL_HASH_CELL` 을 `1e-3` (1μm) → `1e-4` (0.1μm) 로 **10×
강화**. 따라서 dedup 도 1.5μm → **0.15μm**. 산업 표준 mm 3-4 decimal place 정합.

---

## 3. 발견한 drift — stale 주석 (코드 정확, 주석 옛 값)

코드는 `dedup_tol = SPATIAL_HASH_CELL × 1.5 = 0.15μm` 으로 **정확**. 그러나
mesh.rs 주석 11곳이 ADR-147 *이전* 값 "1.5μm"/"3μm" 를 그대로 둠 (드리프트):

| 위치 | 옛 (drift) | 정정 |
|---|---|---|
| mesh.rs:505 | "3 셀(=3μm)" | "3 셀(= 0.3μm)" |
| mesh.rs:506 | "× 1.5 (1.5μm)" | "× 1.5 = 1.5e-4 mm (0.15μm)" |
| mesh.rs:638 | "= 1.5μm" | "= 1.5e-4 mm = 0.15μm" |
| 테스트 주석 (10860+) | "1.5μm" | "0.15μm" |

→ canonical dedup 주석 정정. (CLAUDE.md / 기타 cross-link 의 "1.5μm" 광범위
sweep 은 별도 follow-up — LOCKED #5 본문은 이미 0.15μm 로 정확.)

---

## 4. 회귀 자산 (명시·검증, 절대 #[ignore] 금지)

axia-geo mesh::tests (+2):
- `adr180_precision_policy_units_mm_f64_eps` — VERTEX_TOLERANCE = 1e-7,
  `size_of::<DVec3>() == 24` (3×f64)
- `adr180_precision_policy_dedup_tolerance_is_015um` — **bracket 검증**:
  0.14μm (1.4e-4 mm) 떨어진 점 → dedup (same VertId), 0.16μm (1.6e-4 mm)
  → distinct. dedup tolerance 를 정확히 0.15μm 로 고정.

→ 정밀도 정책이 코드로 lock — 값이 바뀌면 즉시 fail.

---

## 5. UI imprecision 은 별개 (TS-layer, 후속)

| 증상 | 원인 | 트랙 |
|---|---|---|
| RECT 미리보기 9893mm 폭발 | grazing plane ray projection (TS, 면 밖 cursor) | 후속 |
| 미리보기 채움/외곽선 불일치 | updatePreview quaternion 방향 ≠ right/up basis | 후속 |
| 뒷면 안 그려짐 | 가려진 face raycast 불가 (orbit 필요) | 정상 동작 |

이들은 엔진 f64/EPS 와 무관. 별도 TS 수정 (preview makeBasis orientation +
second-corner face-pick precision).

---

## 6. Lock-ins

- **L-180-1** 단위 = mm, 좌표 = f64 (DVec3)
- **L-180-2** SPATIAL_HASH_CELL = 1e-4 mm (0.1μm), dedup = 0.15μm (ADR-147)
- **L-180-3** VERTEX_TOLERANCE = 1e-7 mm
- **L-180-4** EPS 계층 명시 (§2.2) — 새 tolerance 추가 시 본 표 갱신
- **L-180-5** 정밀도 회귀 lock (bracket test) — 절대 #[ignore] 금지
- **L-180-6** stale 주석 정정 (코드 정확성과 주석 일치)
- **L-180-7** UI imprecision 은 TS-layer 별개 (엔진 정밀도 무관)

---

## 7. Cross-link

- **LOCKED #5** (엔진 허용오차 정책 — 본 ADR 이 명시·검증)
- **ADR-147** (Spatial-hash precision strict, Scenario B1 — SPATIAL_HASH_CELL 1e-4)
- **ADR-167** (EPS_PLANE SSOT) / **ADR-168** (PLANE_SNAP)
- **메타-원칙 #4** SSOT / **#6** Preventive (회귀 lock) / **#9** 회귀 없음
- **ADR-178/179** (DrawRect face-aware — UI imprecision 은 별개 TS 트랙)
