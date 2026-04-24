# ADR-009: Orphan Face Recovery Policy

**Status**: Proposed (2026-04-24)
**Supersedes**: —
**Related**: ADR-008 (Face Operation Axioms), Save/Load V2 (commit 9e2631d)

---

## Context

2026-04-24 디버그 체크 중 발견: 한 프로젝트 scene에 **활성 face 2924개 중 1612개 (55%)가 `face_to_xia` 역인덱스에 없음**. 이 face들은 렌더링은 되지만 XIA 기반 연산(선택·이동·그룹화·재질 할당)이 모두 실패.

### Phase 0 진단 데이터 (실측)

| 항목 | 값 |
|-----|----|
| 활성 face | 2924 |
| XIA 할당 face | 1312 (45%) |
| Orphan face | **1612 (55%)** |
| Connected component 수 | **8** |
| Vertex count 분포 | 삼각 272 / 사각 1340 |
| Category 분포 | **C1(순수 orphan) 100%**, C2/C3 0 |

### 원인 추적

Commit `9e2631d` 이전의 `.axia` 파일 포맷(V1)은 `Scene::export_versioned_snapshot`이 `self.mesh`만 직렬화하고 `self.xias` / `self.groups` / `self.face_to_xia`를 저장하지 않았음. Save/Load 라운드트립에서 XIA 전체 손실. 반면 Undo/Redo용 `scene_snapshot` 경로는 전체 상태를 직렬화했기 때문에 세션 내에서만 문제가 감춰져 있었음.

사용자가 보고한 scene이 이 경로를 탄 것으로 추정:
1. 사용자가 강아지 + 고양이 + 박스 + 원통 + 구를 생성·import → XIA 5+ 개 등록
2. `.axia`로 저장 → mesh만 저장됨
3. 다음 세션 로드 → mesh 복원, XIA 0개
4. 사용자가 계속 작업 → 새 XIA 5개 등록 (현재 보이는 XIA 1~5)
5. 원본 5개 prefab의 8 component는 **영구 orphan**

Commit `9e2631d`로 V2 포맷을 도입해 앞으로는 방지되지만, **현재 scene 및 과거 V1 파일의 기존 orphan은 여전히 남음**. 본 ADR은 이 orphan을 복구하는 정책을 정의.

---

## Decision

### 1. Orphan 분류 (Classification)

Phase 0 진단에서 **C1 단일 케이스**만 확인됐지만, 향후 다른 경로에서 다른 케이스가 발견될 수 있으므로 분류는 미리 정의.

| Category | 정의 | 기본 정책 |
|----------|-----|----------|
| **C1 Pure** | Orphan component가 기존 XIA와 DCEL edge 공유 없음 | **Component 단위로 신규 "Recovered" XIA 생성** |
| **C2 XIA-Neighbor** | Orphan component가 정확히 1개 XIA와 edge 공유 | 해당 XIA에 흡수 |
| **C3 Bridge** | Orphan component가 2+ XIA와 edge 공유 | **사용자 수동 결정 필요** (interactive dialog) |

### 2. Component 결정

* **Connected component**: `Mesh::get_connected_faces(seed)` — DCEL radial edge 기반. 기하 거리 아님.
* **최소 크기 threshold**: **1 face부터 복구** (threshold 없음). 사용자가 원하면 `min_size` 파라미터로 필터 가능.

### 3. XIA 명명 규칙

기본: `"Recovered @ ({x:.0}, {y:.0}, {z:.0}) · {N}개"`
예: `"Recovered @ (-1500, 1200, 0) · 180개"`

* 위치 좌표: AABB center (component 전체를 둘러싼 box의 중심)
* Face 수: component 내 face 개수

사용자가 ComponentPanel에서 rename 가능. 향후 interactive 라벨링 옵션 추가 가능.

### 4. Position 기준

XIA의 `position` 필드 = **component의 AABB center**.

* 이유: 결정적(deterministic) · 계산 쉬움 · 사용자가 Outliner에서 component를 위치 기반으로 식별 용이
* 대안(centroid average · face 하나의 centroid)은 복잡하거나 편향 가능

### 5. Material 상속

각 face의 **기존 material을 그대로 유지** (XIA는 material을 소유하지 않고 face가 소유). XIA 레벨 material이 없는 현재 구조에서는 자동 달성됨.

### 6. UI 노출 방식

**수동 명령만 허용. 자동 실행 금지.**

* 메뉴: `정리 → Orphan 복구...`
* 커맨드 창: `orphan-diagnose` (진단 · 읽기 전용), `orphan-recover [--preview | --apply]`
* V1 파일 load 시: 경고 Toast만 표시, 자동 실행 ❌

### 7. Invariants (실행 전후 유지해야 할 성질)

Recovery 전후 다음 성질이 모두 성립:

1. **`mesh.face_count()` 불변** — face 추가·삭제 없음
2. **전체 face 영역 합 불변** — 기하는 건드리지 않음
3. **ADR-007 Face Orientation Invariants 모두 통과**
4. **모든 face가 정확히 1개 XIA에 속함** (`face_to_xia.len() == mesh.face_count()`)
5. **기존 XIA의 face_ids는 불변** (C2 흡수 케이스 제외)
6. **단일 undo frame으로 되돌릴 수 있음**

### 8. Dry-run vs Apply 분리

두 단계 필수:

```
orphan-diagnose → OrphanReport (readonly, &self)
  ↓ 사용자 검토
orphan-recover --preview → RecoveryResult (mutation + rollback, &mut self)
  ↓ 사용자 승인
orphan-recover --apply → RecoveryResult (mutation + commit, &mut self)
```

* Diagnose: 분류 결과 + 샘플 face 표시. 어떤 mutation도 없음.
* Preview: 실제 recovery 시뮬레이션 → 결과 통계 반환 → **rollback** (scene_snapshot + restore)
* Apply: 실제 mutation → 단일 undo frame commit

### 9. V1 파일 자동 복구 여부

**자동 실행 금지.** V1 load 시:
1. `import_versioned_snapshot`은 V1 경로에서 XIA 명시적 초기화
2. 콘솔 경고 로그 출력
3. UI 측에서 Toast로 사용자에게 알림: "레거시 파일입니다. '정리 → Orphan 복구' 메뉴로 XIA를 재구성할 수 있습니다."
4. 사용자가 명시적으로 recovery 명령 실행해야 mutation 발생

---

## Consequences

### 긍정적
* 기존 V1 파일을 열어도 명시적 복구 경로 제공
* 1612개 orphan 중 결정 가능한 것(C1) 자동 복구로 즉시 선택/편집 가능
* Invariant 검증이 복구 연산 검증의 표준이 됨
* Preview 단계로 사용자 실수 가능성 최소화

### 부정적
* XIA 목록 증가 (최대 N개 component × 1 XIA = 현재 scene에선 8개 추가)
* 사용자가 "Recovered" 이름을 보고 혼란 가능 (향후 rename 필요)
* C3(Bridge) 케이스는 interactive 필요 → 구현 복잡도 증가

### 위험 완화
* Invariant 검사 실패 시 자동 rollback
* Face count 불변 assertion (panic on mismatch — 근본적 topology 손상 감지)
* 실행 직전 자동 snapshot 저장 (`scene.autosave-before-recovery.axia.bak`)

---

## Implementation Phases

| Phase | 세션 | Status | 범위 |
|-------|-----|--------|-----|
| 1 | 세션 1 (오늘) | ✅ 완료 | ADR-009 문서 확정 |
| 2 | 세션 2 | 🟡 다음 | Rust `classify_orphans` (readonly) + TS `orphan-diagnose` |
| 3 | 세션 3 후반 | 🔵 대기 | `apply_orphan_recovery` with Preview mode |
| 4 | 별도 | 🔵 대기 | UI 세부 튜닝 (Component panel integration, rename etc.) |

---

## Alternatives Considered

### A. 자동 실행 on file load
V1 파일 load 시 자동 recovery 실행.
**거부**: 사용자 의도 없이 XIA 증가. 디버깅 어려움. 명시적 승인 없이 mesh에 semantic 층 변경은 위험.

### B. Orphan을 완전 무시 (렌더만)
Render에만 나타나고 XIA 연산 안 됨을 그대로 유지.
**거부**: 사용자가 "뭔가 이상하다" 인지하면서도 해결 방법 없음. 안정성보다 사용성 문제.

### C. Per-face auto-XIA
각 orphan face당 1 XIA 생성.
**거부**: 1612 face × 1 XIA = 1612 XIA. ComponentPanel이 불가용해짐.

### D. "Lost & Found" 단일 XIA
모든 orphan을 하나의 XIA에 묶음.
**거부**: 여러 component(강아지/고양이/...)가 한 XIA로 섞임. 개별 조작 불가.

---

## Decision Record

### 확정 (2026-04-24)
* 분류: C1/C2/C3 (현재 scene은 C1 100%)
* 복구 단위: connected component 1개 = XIA 1개
* 명명: `"Recovered @ (x,y,z) · N개"`
* 실행: 수동 명령만, Preview + Apply 2단계
* 역호환: V1 load는 XIA 초기화 + 경고, 자동 복구 없음

### 미결정 (향후 추가 세션)
* C3(Bridge) interactive UI 설계
* ComponentPanel의 "Recovered" 그룹 시각적 구분 (테두리 색 등)
* V1 load 경고 Toast 문구 UX 튜닝
* `orphan-diagnose` 출력 형식 (콘솔 logging vs modal)

---

*Author*: AXiA development + Claude 협의 (2026-04-24)
*Review*: 세션 2 구현 착수 시 재검토
