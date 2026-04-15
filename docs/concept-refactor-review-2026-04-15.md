# AXiA 3D - 논리 개념 재구조화 검토 보고서

**작성일**: 2026-04-15  
**대상 버전**: dce2a52 (S1+S2 XIA 승격 완료)  
**목적**: Geometry Layer / Semantic Layer 분리 제안의 타당성 검토

---

## 1. 제안 개요

### 1.1 리팩토링 이전 구조 (단일 계층, 6단계 상태 머신)

```
[이전] Dissolved ←→ Point ←→ Line ←→ Face ←→ Volume ←→ Xia
         (-1D)       (0D)     (1D)    (2D)     (3D)    (3D+M)
```

- 기하와 의미가 하나의 상태 체인에 혼재
- Material 할당이 상태 전이를 유발 (Volume→Xia)
- Material 해제가 상태 강등을 유발 (Xia→Volume)
- "XIA"가 최종 상태이자 프로젝트 이름이자 엔티티 타입 — 의미 과적

### 1.2 확정된 구조 (2계층 분리, 2026-04-15 구현 완료)

```
Geometry Layer (기하 계층):
  Point(0D) → Edge(1D) → Face(2D) → Volume(3D)

Semantic Layer (의미 계층):
  Object(=XIA) = 기하를 소유하고, 속성/성질을 부여
  Material     = Object의 property (상태 전이 유발 안 함)
  Group        = UI 전용 선택 집합 (소유가 아닌 참조)
```

Volume ≠ Object. Object는 Semantic Layer에만 존재한다.

---

## 2. 현재 구조와 제안 구조의 비교

### 2.1 상태 정의 비교

| 현재 (XiaState) | 차원 | 제안 (Geometry Layer) | 변화 |
|-----------------|------|----------------------|------|
| Dissolved | -1 | (삭제 플래그로 분리) | 상태에서 제거 |
| Point | 0D | Point | 유지 |
| Line | 1D | **Edge** | 명칭 변경 |
| Face | 2D | Face | 유지 |
| Volume | 3D | **Volume = Object** | 의미 확장 |
| Xia | 3D+M | (Semantic Layer로 이동) | 상태에서 제거 |

### 2.2 계층 분리 개념도

```
┌─────────────────────────────────────────────────┐
│              Geometry Layer                      │
│                                                  │
│   Point ────→ Edge ────→ Face ────→ Volume       │
│   (0D)        (1D)       (2D)      (3D=Object)  │
│                                                  │
│   DCEL 엔티티와의 대응:                           │
│   Vertex      Edge       Face      닫힌 Shell    │
│                                                  │
│   규칙: 차원이 올라갈수록 기하가 완성됨            │
│         Volume = 기하의 완성 = Object              │
└───────────────────┬─────────────────────────────┘
                    │
                    │ Volume이 되면 속성 부여 가능
                    ▼
┌─────────────────────────────────────────────────┐
│              Semantic Layer                      │
│                                                  │
│   XIA (기하 + 속성의 결합체)                      │
│   ├── Material: Option<MaterialId>  ← property   │
│   ├── Name: String                               │
│   ├── Position / Transform                       │
│   ├── (향후) Constraints                         │
│   └── (향후) Annotations                         │
│                                                  │
│   Group (UI 전용 선택 집합)                       │
│   ├── Visibility toggle (보이기/숨기기)           │
│   ├── Lock toggle (잠금)                         │
│   └── Hierarchy (parent/children)                │
│                                                  │
│   규칙: Material은 상태 전이가 아닌 속성 할당      │
│         Group은 소유가 아닌 참조                   │
└─────────────────────────────────────────────────┘
```

### 2.3 핵심 관점 변화

```
현재:
  Volume ──(재질 부여)──→ Xia      ← Material이 "상태 전이"를 유발
  Xia    ──(재질 해제)──→ Volume   ← Material이 "상태 강등"을 유발

제안:
  Volume = Object = XIA의 대상     ← Material은 "속성 할당"일 뿐
  Material 유무가 기하 상태를 바꾸지 않음
```

**본질**: "Volume에 Material이 있어야 XIA"가 아니라, **"Volume이 되면 이미 XIA(객체)"**

---

## 3. Geometry Layer 상세 검토

### 3.1 각 요소의 정의

#### Point (0D)

| 항목 | 내용 |
|------|------|
| 정의 | 공간의 한 점 (위치만 존재) |
| DCEL 대응 | Vertex |
| 치수 | L=0, W=0, H=0 |
| 현재 코드 | XiaState::Point (xia.rs:22) |
| 생성 시점 | DXF ModelPoint 가져오기 |

#### Edge (1D) — 현재 "Line"

| 항목 | 내용 |
|------|------|
| 정의 | 두 점을 잇는 선분 (길이만 존재) |
| DCEL 대응 | Edge + 2개의 HalfEdge |
| 치수 | L>0, W=0, H=0 |
| 현재 코드 | XiaState::Line (xia.rs:24) |
| 생성 시점 | DrawLine 커맨드 |
| 명칭 변경 이유 | DCEL에서 "Edge"가 표준 용어이며, "Line"은 무한 직선과 혼동 가능 |

#### Face (2D)

| 항목 | 내용 |
|------|------|
| 정의 | 평면 다각형 (면적 존재) |
| DCEL 대응 | Face |
| 치수 | L>0, W>0, H=0 |
| 현재 코드 | XiaState::Face (xia.rs:26) |
| 생성 시점 | DrawRect, DrawCircle, DXF 닫힌 폴리라인 |

#### Volume = Object (3D) — 기하의 완성

| 항목 | 내용 |
|------|------|
| 정의 | 닫힌 솔리드 (부피 존재, 기하적으로 완성된 객체) |
| DCEL 대응 | 닫힌 Shell (모든 Edge가 두 Face를 공유) |
| 치수 | L>0, W>0, H>0 |
| 현재 코드 | XiaState::Volume (xia.rs:28) |
| 생성 시점 | PushPull, Primitive (Sphere/Cone/Cylinder), DXF 3D |
| 의미 확장 | **Volume이 곧 Object** — 기하가 완성된 순간 "객체"로 인정 |

### 3.2 DCEL 커널과의 매핑

```
Geometry Layer          DCEL 커널 (axia-geo)
─────────────          ──────────────────
Point         ←→       Vertex (SlotStorage<VertexId, Vertex>)
Edge          ←→       Edge + HalfEdge (SlotStorage<EdgeId/HalfEdgeId>)
Face          ←→       Face (SlotStorage<FaceId, Face>)
Volume        ←→       Shell (닫힌 Face 집합, euler: V-E+F=2)
```

**판정**: Geometry Layer의 4단계가 DCEL 엔티티와 정확히 1:1 대응. 현재 시스템보다 커널과의 정합성이 높음.

---

## 4. Semantic Layer 상세 검토

### 4.1 XIA 재정의

```
현재:
  XIA = "Volume + Material이 있는 최종 상태" (상태 머신의 끝)

제안:
  XIA = "기하에 속성/성질을 가진 엔티티" (의미 계층의 컨테이너)
```

#### XIA 엔티티 구조 (제안)

```rust
pub struct Xia {
    pub id: XiaId,
    pub name: String,
    pub geometry_state: GeometryState,     // Point | Edge | Face | Volume
    pub position: DVec3,
    pub surface_normal: Option<DVec3>,
    pub material: Option<MaterialId>,      // 속성 (상태 전이 아님)
    pub face_ids: Vec<FaceId>,
    pub visible: bool,
    // (향후 확장)
    // pub constraints: Vec<ConstraintId>,
    // pub annotations: Vec<AnnotationId>,
}
```

#### 현재 Xia 구조와의 차이

| 필드 | 현재 | 제안 | 변화 |
|------|------|------|------|
| state | XiaState (6값) | GeometryState (4값) | 축소, Dissolved 분리 |
| material | MaterialId (항상 존재) | Option\<MaterialId\> | Optional로 변경 |
| selected | bool | (SelectionManager로 이동) | XIA에서 제거 |

### 4.2 Material — 속성으로의 전환

```
현재 동작:
  Material 할당 → lifecycle::promote_to_xia()   → 상태 전이 발생
  Material 해제 → lifecycle::demote_to_volume()  → 상태 강등 발생

제안 동작:
  Material 할당 → xia.material = Some(id)        → 속성 변경만
  Material 해제 → xia.material = None             → 속성 변경만
```

**제거되는 코드:**
- `lifecycle::promote_to_xia()` — 전체 삭제
- `lifecycle::demote_to_volume()` — 전체 삭제
- `scene.rs` AssignMaterial 내 XIA 상태 전이 로직
- `scene.rs` RemoveMaterial 내 XIA 상태 강등 로직
- `xia.rs` has_material() 메서드

**장점:**
- Material 변경이 상태 머신을 건드리지 않음 → 부작용 제거
- Material 외 다른 속성(Constraint, Annotation 등) 추가 시 동일 패턴 적용 가능

### 4.3 Group — UI 전용 선택 집합

```
현재:
  Group = face 소유자 + visibility/lock 제어자
  XIA와 독립적으로 face를 소유 → 이중 소유 문제

제안:
  Group = UI 전용 선택 집합 (Selection Set)
  face를 "참조"할 뿐 "소유"하지 않음
  Visibility/Lock은 유지 (UI 편의 기능)
```

#### 역할 비교

| 기능 | 현재 Group | 제안 Group |
|------|-----------|-----------|
| face 참조 | ✅ face_ids 소유 | ✅ face_ids 참조 |
| 가시성 제어 | ✅ visible toggle | ✅ 유지 |
| 잠금 제어 | ✅ locked toggle | ✅ 유지 |
| 계층 구조 | ✅ parent/children | ✅ 유지 |
| face 소유권 | ⚠️ XIA와 이중 소유 | ❌ 소유하지 않음 (참조만) |
| 컴포넌트 | ⚠️ 미구현 | 별도 설계 필요 |

**핵심**: Group은 "이 면들을 함께 묶어서 보이기/숨기기/잠그기 하겠다"는 **UI 편의 도구**로 한정. **face의 진짜 소유자는 XIA**.

---

## 5. 코드 영향 분석

### 5.1 Rust 변경 사항

#### xia.rs — 상태 enum 재정의

```
변경 전 (6개 상태, 저장형):
  pub enum XiaState {
      Dissolved, Point, Line, Face, Volume, Xia
  }

변경 후 (5개 상태, 계산형 — 구현 완료):
  pub enum XiaState {
      Dissolved, // 기하 없음
      Point,     // 0D (예약)
      Edge,      // 1D — standalone_edge_id 있음
      Face,      // 2D — face_ids 1~2개
      Volume,    // 3D — face_ids 3+개
  }

Volume ≠ Object. Object(=XIA)는 Semantic Layer에만 존재.
state 필드 제거 → geometry_state() 메서드로 계산.
```

| 항목 | 결과 |
|------|------|
| state 필드 | **제거** → geometry_state() 계산 메서드 |
| dimension() | 유지 (Point=0, Edge=1, Face=2, Volume=3) |
| has_material() | XIA 속성 체크 (material.raw() != 0) |
| can_transition_to() | **제거** (상태는 계산형, 전이 불필요) |
| transition() | **제거** |

#### lifecycle.rs — 전이 함수 정리 (구현 완료)

```
변경 전 (5개 함수):
  edges_form_loop()      유지
  promote_to_face()      삭제 (상태는 계산형)
  promote_to_volume()    삭제 (상태는 계산형)
  promote_to_xia()       삭제 (Material은 속성)
  demote_to_volume()     삭제 (Material은 속성)
  dissolve()             유지

변경 후 (2개 함수):
  edges_form_loop()      — 닫힌 루프 판별
  dissolve()             — 기하 참조 해제 (face_ids + standalone_edge_id 클리어)
```

#### scene.rs — 커맨드 핸들러 변경 (구현 완료)

| 커맨드 | 이전 | 현재 (구현 완료) |
|--------|------|---------|
| DrawLine | state = Line | standalone_edge_id 설정 → Edge 자동 계산 |
| DrawRect | state = Face | face_ids 추가 → Face 자동 계산 |
| DrawCircle | state = Face | face_ids 추가 → Face 자동 계산 |
| PushPull | promote_to_volume() | face_ids 추가 → Volume 자동 계산 |
| AssignMaterial | promote_to_xia() | 속성 할당만 (상태 변경 없음) |
| RemoveMaterial | demote_to_volume() | 속성 해제만 (상태 변경 없음) |

#### import_dxf.rs — 상태 판별 변경

```
변경 전:
  let state = if new_faces.len() >= 3 { XiaState::Volume } else { XiaState::Face };

변경 후:
  let state = if new_faces.len() >= 3 { GeometryState::Volume } else { GeometryState::Face };
```

#### lib.rs (WASM) — 프리미티브 상태 변경

```
변경 전:
  axia_core::xia::XiaState::Volume    (3곳: cylinder, cone, sphere)

변경 후:
  axia_core::xia::GeometryState::Volume    (3곳)
```

### 5.2 TypeScript 변경 사항

#### MaterialLibrary.ts — GeometryState 재정의

```
변경 전 (5개):
  export enum GeometryState {
    Point = 'point', Line = 'line', Face = 'face',
    Volume = 'volume', Xia = 'xia'
  }

변경 후 (4개):
  export enum GeometryState {
    Point  = 'point',
    Edge   = 'edge',     // Line → Edge
    Face   = 'face',
    Volume = 'volume',   // = Object (기하의 완성)
  }
```

#### MaterialLibrary.ts — determineState() 변경

```
변경 전:
  if (this.hasMaterial(faceIds)) return GeometryState.Xia;
  return GeometryState.Volume;

변경 후:
  return GeometryState.Volume;   // Material 유무가 상태를 바꾸지 않음
  // Material 정보는 별도 property로 표시
```

#### XiaInspector.ts — UI 단계 표시 변경

```
변경 전:
  const order = ['point', 'line', 'face', 'volume', 'xia'];     // 5단계
  Volume/Xia 분기로 물리 속성 표시 제어

변경 후:
  const order = ['point', 'edge', 'face', 'volume'];            // 4단계
  Material 유무에 따른 배지/아이콘 표시 (상태 분기 아님)
```

#### GEOMETRY_STATES 레코드 변경

```
변경 전 (5개 엔트리):
  Point:  { label: '점',   icon: '·',  color: '#888888' }
  Line:   { label: '선',   icon: '─',  color: '#ff9800' }
  Face:   { label: '면',   icon: '▢',  color: '#2196f3' }
  Volume: { label: '체적', icon: '⬡',  color: '#9c27b0' }
  Xia:    { label: 'XIA',  icon: '◆',  color: '#4caf50' }

변경 후 (4개 엔트리):
  Point:  { label: '점',     icon: '·',  color: '#888888' }
  Edge:   { label: '선분',   icon: '─',  color: '#ff9800' }
  Face:   { label: '면',     icon: '▢',  color: '#2196f3' }
  Volume: { label: '객체',   icon: '⬡',  color: '#4caf50' }
                                                 ↑ Volume이 최종 → 초록색
```

### 5.3 테스트 영향

| 테스트 파일 | 예상 변경 |
|------------|----------|
| MaterialLibrary.test.ts | GeometryState.Xia → 제거, Line→Edge, ~10개 수정 |
| XiaInspector (수동 테스트) | 5단계→4단계 UI 확인 |
| scene.rs 관련 Rust 테스트 | 상태 전이 테스트 업데이트 (Rust 테스트 48개 중 ~5개) |

---

## 6. 직렬화 호환성

### 6.1 스냅샷 마이그레이션

기존 .axia 파일과 스냅샷에 `XiaState::Xia`, `XiaState::Line` 값이 저장되어 있음. 역직렬화 시 마이그레이션 필요.

```rust
// 마이그레이션 전략
impl<'de> Deserialize<'de> for GeometryState {
    fn deserialize(...) -> Result<Self, ...> {
        match value {
            "Point"     | 0 => Ok(GeometryState::Point),
            "Line"      | 1 => Ok(GeometryState::Edge),      // Line → Edge
            "Face"      | 2 => Ok(GeometryState::Face),
            "Volume"    | 3 => Ok(GeometryState::Volume),
            "Xia"       | 4 => Ok(GeometryState::Volume),    // Xia → Volume (속성 분리)
            "Dissolved"      => Ok(GeometryState::Point),     // dissolved 플래그로 분리
            _ => Err(...)
        }
    }
}
```

### 6.2 버전 관리

| 버전 | 포맷 |
|------|------|
| v1 (현재) | XiaState 6값 enum (bincode) |
| v2 (제안) | GeometryState 4값 enum + dissolved bool + material Option |
| 호환 | v1 로드 시 자동 마이그레이션 (Line→Edge, Xia→Volume+material) |

---

## 7. 장점 분석

### 7.1 개념적 명확성

| 항목 | 현재 | 제안 | 개선 |
|------|------|------|------|
| "XIA란 무엇인가" | 최종 상태 (Volume+Material) | 속성을 가진 객체 (엔티티 타입) | 의미 혼란 해소 |
| "Material의 역할" | 상태 전이 트리거 | 단순 속성 할당 | 부작용 제거 |
| "Group의 역할" | face 소유자 (XIA와 이중) | UI 선택 집합 | 소유권 명확화 |
| "Volume의 의미" | 중간 상태 (아직 XIA 아님) | 기하의 완성 = Object | 목표 상태 명확 |

### 7.2 코드 단순화

```
제거되는 코드:
  - lifecycle::promote_to_xia()        (10줄)
  - lifecycle::demote_to_volume()      (10줄)
  - scene.rs AssignMaterial 상태 전이  (15줄)
  - scene.rs RemoveMaterial 상태 강등  (18줄)
  - xia.rs has_material()              (3줄)
  - xia.rs Volume→Xia 특례            (3줄)
  - TS GeometryState.Xia 분기 전체    (~20줄)
                                합계: ~79줄 제거

단순화되는 코드:
  - can_transition_to()  ← 특례 제거로 단순화
  - determineState()     ← Xia 분기 제거
  - updateStateSteps()   ← 5단계→4단계
  - GEOMETRY_STATES      ← 5항목→4항목
```

### 7.3 확장성

```
현재 구조에서 속성 추가 시:
  Constraint 추가 → Volume + Material + Constraint = ???  (새 상태 필요?)
  Annotation 추가 → 또 새 상태?  → 상태 폭발

제안 구조에서 속성 추가 시:
  xia.material = Some(...)        ← 속성
  xia.constraints = vec![...]     ← 속성
  xia.annotations = vec![...]     ← 속성
  → 상태 머신은 기하 변화만 다룸 (4단계 고정)
```

---

## 8. 주의사항 및 리스크

### 8.1 명칭 혼동 — Edge

| 컨텍스트 | "Edge"의 의미 | 혼동 가능성 |
|---------|-------------|------------|
| Geometry Layer | XIA의 기하 상태 (1D 선분) | - |
| DCEL 커널 | 단일 edge 엔티티 | ⚠️ XIA Edge ≠ DCEL Edge |
| Three.js | EdgeGeometry (와이어프레임) | 낮음 |

**대응**: XIA의 Edge 상태는 "여러 DCEL Edge의 집합"이므로, 문서/주석에 명시 필요. 또는 "Segment"로 대체 가능하나, Edge가 CAD 표준에 더 부합.

### 8.2 Volume = Object 범위 결정

| 질문 | 선택지 | 권장 |
|------|--------|------|
| 열린 면 집합도 Volume? | ① 닫힌 솔리드만 ② 면 4개+ 높이>0 | ② 현재 로직 유지 |
| 단일 면은 Object? | ① Face 상태 유지 ② Object로 승격 | ① Face 유지 |
| PushPull 없이 Primitive? | 이미 Volume으로 생성 | 현재와 동일 |

### 8.3 직렬화 하위 호환

- 기존 .axia 파일 (v1)에 XiaState::Xia, XiaState::Line이 bincode로 저장됨
- restore_scene_snapshot()에 마이그레이션 로직 추가 필요
- 레거시 스냅샷 (mesh-only)과의 3중 호환 유지해야 함

### 8.4 Inspector UI 변경

```
현재 5단계 인디케이터:
  [·] ─ [─] ─ [▢] ─ [⬡] ─ [◆]
  점     선     면    체적   XIA

변경 후 4단계:
  [·] ─ [─] ─ [▢] ─ [⬡]
  점    선분    면    객체

Material 유무 표시:
  객체 [⬡] + 🟢 (Material 있음)  또는
  객체 [⬡] + ⚪ (Material 없음)
```

---

## 9. 변경 영향 범위 요약

### 9.1 파일별 변경 규모

| 파일 | 변경점 수 | 난이도 | 내용 |
|------|----------|--------|------|
| **Rust** | | | |
| xia.rs | 6개 | 낮음 | enum 재정의, has_material/dimension 변경 |
| lifecycle.rs | 5개 | 낮음 | promote_to_xia/demote 삭제 |
| scene.rs | 8개 | 중간 | 상태 할당/전이 로직 변경 |
| import_dxf.rs | 1개 | 낮음 | 상태 판별 변경 |
| lib.rs | 3개 | 낮음 | Primitive 상태 지정 |
| **TypeScript** | | | |
| MaterialLibrary.ts | 4개 | 낮음 | enum/determineState/STATES 변경 |
| XiaInspector.ts | 5개 | 중간 | UI 단계/분기 변경 |
| MaterialLibrary.test.ts | ~10개 | 낮음 | 테스트 업데이트 |

### 9.2 제거되는 코드

| 항목 | 줄 수 |
|------|------|
| lifecycle::promote_to_xia() | ~10줄 |
| lifecycle::demote_to_volume() | ~10줄 |
| scene.rs 상태 전이 로직 | ~33줄 |
| xia.rs has_material() + 특례 | ~6줄 |
| TS GeometryState.Xia 관련 | ~20줄 |
| **합계** | **~79줄 제거** |

### 9.3 추가되는 코드

| 항목 | 줄 수 |
|------|------|
| 직렬화 마이그레이션 | ~20줄 |
| Material property 처리 | ~10줄 |
| Inspector Material 배지 | ~15줄 |
| **합계** | **~45줄 추가** |

**순 효과: ~34줄 감소 + 개념 단순화**

---

## 10. 결론 및 권장사항

### 10.1 종합 평가

| 평가 항목 | 판정 | 근거 |
|----------|------|------|
| 개념적 정합성 | ✅ 우수 | 기하/의미 분리가 CAD 표준에 부합 |
| DCEL 커널 대응 | ✅ 우수 | Point-Edge-Face-Volume이 Vertex-Edge-Face-Shell에 1:1 매핑 |
| 구현 가능성 | ✅ 실현 가능 | Rust 5파일 + TS 3파일, ~23개 변경점 |
| 코드 단순화 | ✅ 개선 | ~79줄 제거, 상태 전이 2개 제거 |
| 하위 호환 | ⚠️ 주의 필요 | 직렬화 마이그레이션 필수 (v1→v2) |
| 확장성 | ✅ 우수 | 속성 추가 시 상태 폭발 방지 |
| 테스트 영향 | 🟢 낮음 | ~15개 테스트 수정 |

### 10.2 최종 결정 — Volume ≠ Object

초기 제안에서 "Volume = Object (기하의 완성)"으로 등치했으나,
검토 결과 **Volume과 Object는 다른 개념**임이 확인되었습니다.

```
Volume = 기하 속성 (닫힌 솔리드, 부피 측정 가능)
Object = 의미 단위 (사용자가 하나로 인식하는 모든 것)

Volume ⊂ Object (모든 Volume은 Object이지만, 모든 Object가 Volume은 아님)
```

열린 면, 단일 면, 선분도 모두 Object입니다.
Object는 Geometry Layer가 아닌 **Semantic Layer**에 속합니다.

---

## 11. Architecture Decision (확정)

### 11.1 공식 설계 결정

> 1. **Geometry Layer**는 Point / Edge / Face / Volume만 포함한다.
> 2. **Volume**은 "닫힌 기하 상태"이며 Object가 아니다.
> 3. **Object**는 Semantic Layer에 속하며 XIA와 동일 개념이다.
> 4. Object/XIA는 기하를 "소유"하고, 기하 상태는 소유한 기하에서 "계산"된다.
> 5. XIA.state는 저장하지 않으며, `geometry_state()`로 계산한다.
> 6. **Material**은 Object의 속성(property)이며 상태 전이를 유발하지 않는다.
> 7. **Group**은 UI 전용 선택 집합이며 face를 참조할 뿐 소유하지 않는다.

### 11.2 확정된 구조도

```
┌─ Geometry Layer (순수 기하, Mesh DCEL) ──────────────┐
│                                                       │
│  Point (0D)  →  Edge (1D)  →  Face (2D)  → Volume    │
│  Vertex         Edge          Face         (닫힌3D)   │
│                                                       │
│  규칙: 상태는 기하에서 "계산"됨, 저장하지 않음         │
│  Volume ≠ Object (Volume은 순수 기하 상태)             │
└────────────────────┬──────────────────────────────────┘
                     │ 소유 (face_ids, standalone_edge_id)
                     ▼
┌─ Semantic Layer (의미, 사용자 모델) ─────────────────┐
│                                                       │
│  Object (= XIA)                                      │
│    소유: face_ids, standalone_edge_id                 │
│    계산: geometry_state() → Dissolved|Point|Edge|Face|Volume │
│    속성: material (Option), name, position            │
│    Edge 계산: edges_for_xia() — face 경계에서 추출    │
│                                                       │
│  MaterialLibrary (재질 정의 카탈로그)                  │
│    Object.material이 참조 (속성, 상태 전이 안 함)     │
│                                                       │
│  Group (UI 선택 집합)                                 │
│    참조: face_ids (Object 경계 무관)                   │
│    기능: visibility, lock, hierarchy                   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## 12. 구현 계획 (전체 완료)

### Step 1. 설계 공식화 ✅
- 아키텍처 결정을 CLAUDE.md 및 보고서에 반영
- 설계 논쟁 종료

### Step 2. #1·#2 버그 수정 ✅
- Face 삭제 시 face_to_xia 정리 (delete_face/delete_edge/batch_delete)
- XIA state 필드 제거 → geometry_state() 계산형 전환
- face_ids 비면 자동 Dissolved 처리
- promote_to_xia/demote_to_volume/promote_to_volume/promote_to_face 제거

### Step 3. Edge 상태 보완 (B안) ✅
- standalone_edge_id: Option<EdgeId> — draw_line 전용 최소 저장
- edges_for_xia(): face_ids → face_outer_edges() 계산 (저장 안 함)
- geometry_state()에서 Edge 상태 반환 가능

### Step 4. "Volume = Object" 잔여 개념 제거 ✅
- 코드/주석에서 Volume=Object 혼용 완전 제거
- Object는 Semantic Layer에만 존재 확정
- shell.rs, lib.rs, lifecycle.rs, CLAUDE.md, 보고서 전부 정리

---

*이 보고서는 커밋 dce2a52 기준으로 작성되었으며, Step 1~4 구현은 2026-04-15 완료되었습니다.*
