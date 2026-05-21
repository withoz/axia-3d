# K3 사용자 시연 plan — Cylinder 측면 group full-selection (Push/Pull 후 split 정합)

**Date**: 2026-05-23
**Trigger**: K3 시나리오 3 hotfix (PR #140) 후 사용자 facing 효과 검증
**ADR-087 K-ζ canonical 답습**: 사용자 시연 게이트의 architectural 가치
**Path Z position**: K3 implementation (PR #140) → **본 demo plan + E2E** → 사용자 manual 시연

## 1. 목적

K3 hotfix 의 사용자 facing 효과를 *명시 측정* 하여 다음 활동의 anchor
설정:
- K3 가 cylinder Push/Pull → split → group selection 정합 회복 했는지
- ADR-093 D-δ (cylinder side face owner-id grouping) 의 K3 직접 영향
- 향후 K1 hotfix (시나리오 1) implementation 진입 anchor

## 2. 시연 전 baseline (PR #140 이전 동작 — drift 회귀)

### Before K3 (시나리오 3, demo-breaking 회귀)

```
1. 사용자: DrawCircle 그리기 (segments 16+)
2. 사용자: 원 위에 Push/Pull → cylinder 생성 (N side faces, 동일 owner_id)
3. 사용자: 측면 face 위에 DrawLine 으로 split 시도
4. 엔진: split 발생 → 2 sub-face 생성
   ⚠️ sub-face 의 face_to_surface_owner_id 는 None (propagation 누락)
5. 사용자: 측면 face 클릭 → 측면 group full-selection 기대
6. 엔진: walk_face_owner_siblings → 원본 측면 face N-2 + (split 안 된 것)
   만 반환 — sub-face 둘은 owner_id 없어서 walk 누락
7. 사용자 결과: N-2 face 만 선택 ⚠ (의도와 다른 결과)
```

## 3. K3 hotfix 후 시연 (PR #140 적용)

### 시나리오 A — Path B cylinder + split

```
1. 사용자: 메뉴에서 DrawCircle 도구 선택 (단축키 C)
2. 사용자: viewport 클릭 → 원 중심 + 두 번째 클릭 → 원 그리기
   * Path B kernel-native 자동 (segments >= 12)
3. 사용자: Push/Pull 도구 선택 (단축키 P)
4. 사용자: 원 face 클릭 + 위로 드래그 → cylinder 생성
   * Path B cylinder = 2 face (base + top) + 1 annulus side face
5. 사용자: 측면 (annulus) face 위에 DrawLine 도구 (단축키 L)
6. 사용자: 측면 위 두 점 그리기 → split 발생
   * Split 후: annulus 가 2 sub-face 로 분할
   * K3 propagation: 두 sub-face 모두 parent owner_id inherit ✅
7. 사용자: 측면 sub-face 클릭 → group selection 활성
8. 엔진: walk_face_owner_siblings → 모든 sub-face 포함
9. ✅ 사용자 결과: 분할된 모든 sub-face 가 선택됨
```

### 시나리오 B — Path A cylinder + split (legacy)

```
1. localStorage 'axia:cylinder-path-b-mode' = 'false' 명시 (legacy Path A)
2. 사용자: DrawCircle 도구 (segments 16 default)
3. 사용자: Push/Pull → cylinder (16 side faces, 동일 owner_id)
4. 사용자: 측면 face 1개 위에 DrawLine split
   * K3 propagation: 2 sub-face 모두 parent owner_id inherit ✅
5. 사용자: 측면 sub-face 클릭 → group selection
6. ✅ 사용자 결과: **17 face 선택** (15 unsplit + 2 sub-faces, 모두 동일 owner_id)
```

### 시나리오 C — Boolean split (Sphere × Cylinder)

```
1. 사용자: Sphere 생성 (Path B, owner_id_A 부여)
2. 사용자: Cylinder 생성 (Path B, owner_id_B 부여) — sphere 와 교차
3. 사용자: Boolean Intersect / Union / Subtract 도구
4. 엔진: split_faces_by_intersections 호출 → sphere/cylinder face 모두 split
   * K3 propagation: split 결과 sub-face 모두 parent owner_id inherit ✅
5. 사용자: Sphere 의 sub-face 클릭 → group selection
6. ✅ 사용자 결과: sphere 의 모든 sub-face (split 결과 포함) 선택
   * Cylinder sub-faces 는 별개 owner_id (B) → 별도 group
```

## 4. Expected results 매트릭스

### 시나리오 A — Path B cylinder + split

| 측정 항목 | Expected | K3 효과 |
|---|---|---|
| 시연 1 (Path B 측면 split) sub-face 의 owner_id | == annulus parent owner_id | K3 inherit ✅ |
| 측면 sub-face 클릭 → siblings 수 | 모든 sub-face (2+) | K3 정합 ✅ |
| Manifold invariant (split 후) | violations 0 | LOCKED #1 P7 보존 ✅ |

### 시나리오 B — Path A cylinder + split

| 측정 항목 | Expected | K3 효과 |
|---|---|---|
| cylinder N side faces 생성 후 owner_id | 모두 동일 (ADR-093 D-δ) | 기존 ✅ |
| split 후 측면 face 클릭 → siblings 수 | **N+1** (N-1 unsplit + 2 split) | K3 정합 ✅ |
| split sub-face 의 owner_id | == parent N face owner_id | K3 inherit ✅ |

### 시나리오 C — Boolean split

| 측정 항목 | Expected | K3 효과 |
|---|---|---|
| Sphere sub-face 의 owner_id (split 후) | == sphere parent owner_id | K3 inherit ✅ |
| Cylinder sub-face 의 owner_id (split 후) | == cylinder parent owner_id | K3 inherit ✅ |
| Sphere sub-face 클릭 → siblings 수 | 모든 sphere sub-face | K3 정합 ✅ |
| Sphere group ↔ Cylinder group 분리 | 별개 group | ✅ (ADR-093 group identity) |

## 5. 사용자 manual 시연 절차

### Step 1 — dev server 시작

```powershell
cd "E:\AXiA 3D\.claude\worktrees\nervous-bose-14363c\web"
npm run dev
```

브라우저: `http://localhost:5173/` 자동 열림.

### Step 2 — 시연 시나리오 A 진행

1. **C** 키 → DrawCircle 도구 활성
2. 뷰포트 클릭 (원 중심) → 마우스 이동 → 두 번째 클릭 (반경 결정)
3. **P** 키 → Push/Pull 도구 활성
4. 원 face 클릭 → 마우스 위로 드래그 → 클릭 (cylinder 높이 결정)
5. **L** 키 → DrawLine 도구 활성
6. 측면 (annulus) face 위에 두 점 클릭 → DrawLine 으로 split
7. **V** 키 → Select 도구 활성
8. Split 결과 측면 sub-face 클릭 → group selection 활성 확인
9. **모든 sub-face 가 highlight 되는지 확인** ✅

### Step 3 — 시나리오 B (Path A) 사전 setup

브라우저 console:
```javascript
localStorage.setItem('axia:cylinder-path-b-mode', 'false');
location.reload();
```

이후 시나리오 A 동일 절차 → **N+1 face 선택 확인**.

### Step 4 — 시나리오 C (Boolean) 진행

1. **H** 키 → Sphere 도구 → sphere 생성
2. **Y** 키 → Cylinder 도구 → cylinder 생성 (sphere 와 교차 위치)
3. 메뉴: Boolean → Intersect (또는 Subtract / Union)
4. **V** 키 → Select 도구
5. Sphere sub-face 클릭 → sphere group 만 선택 (cylinder 분리)

## 6. 자동화 verification (Playwright E2E)

본 docs 와 함께 추가된 E2E spec:
- `web/e2e/k3-cylinder-side-group-selection.spec.ts` (3 scenarios)

각 scenario 가 사용자 manual 시연의 *bridge-level mirror* — page click
대신 `bridge.drawCircleAsCurve` + `bridge.createSolidExtrude` +
`bridge.splitFaceByLine` (또는 equivalents) 직접 호출 후
`bridge.walkFaceOwnerSiblings` 결과 검증.

## 7. Lock-ins

- **L-Demo-1** K3 hotfix (PR #140) 후 cylinder 측면 group full-selection
  정합 회복 — 사용자 시연 baseline 확립
- **L-Demo-2** ADR-087 K-ζ canonical 답습 — 사용자 시연 게이트 가치
- **L-Demo-3** 3 시나리오 (A/B/C) 매트릭스 — Path B + Path A + Boolean
- **L-Demo-4** Playwright E2E spec 추가 — manual + automated dual track
- **L-Demo-5** K1 hotfix (시나리오 1) 진입 anchor — 본 시연 통과 후 자연 next
- **L-Demo-6** 절대 #[ignore] 금지

## 8. Cross-link

- K3 hotfix: PR #140 (6 split sites propagation)
- audit: `docs/audits/2026-05-22-scenario-1-3-current-status-audit.md` (PR #139)
- 보고서: `reports/입력보정파이프라인_적용계획.html` Phase 0 K3
- ADR-087 K-ζ canonical (사용자 시연 게이트 패턴)
- ADR-093 D-δ (cylinder side face owner-id grouping)
- ADR-089 A-χ-β (parent surface propagation 패턴)
- LOCKED #1 / #41 (split site invariant 보존)
- 메타-원칙 #14 (WHAT 결과 invariant)

## 9. Acceptance Log

- **2026-05-23 demo plan** (본 commit) — K3 사용자 시연 plan + 3 scenarios
  (A/B/C) + 자동화 verification E2E spec.
- **(다음 단계)** — 사용자 manual 시연 (위 절차) + Playwright E2E
  실행 (`AXIA_E2E_SLOW=1 npx playwright test k3-cylinder-side-group-
  selection`).
- **(시연 후)** — K1 hotfix (시나리오 1) 진입 결재 또는 다음 트랙.
