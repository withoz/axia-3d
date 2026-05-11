# ADR-001: Geometry / Semantic 레이어 분리

- **Status**: Accepted
- **Date**: 2026-04-17
- **Scope**: `axia-geo`, `axia-core`

## 맥락 (Context)

CAD / 3D 모델링 엔진은 두 가지 성격의 정보를 다룬다:

1. **기하 정보** — 정점 위치, 엣지 연결, 면 토폴로지, 부울 연산 등 **형태 자체**
2. **의미 정보** — "이것은 벽이다", "방 A에 속한다", 재질, 그룹, 사용자 레이블 등 **해석**

전통적인 3D 엔진(Blender, Unity)은 이 둘을 **Object 단위로 섞어서** 관리한다.
CAD(SolidWorks, SketchUp)는 **토폴로지를 중심으로** 의미를 부속적으로 부여한다.

AXiA 3D는 "CAD를 대치하는 가벼운 모델링 플랫폼"을 지향하므로 후자의 접근을 택한다.

## 결정 (Decision)

**엔진을 두 개의 독립 레이어로 분리한다.**

```
┌─────────────────────────────────────────────┐
│ Semantic Layer (axia-core::scene)           │
│   - XIA (=Object): 소유, 이름, 상태(계산값) │
│   - Material: 재질 속성                     │
│   - Group: UI 선택 집합                     │
└─────────────────┬───────────────────────────┘
                  │ 단방향 참조 (face_ids)
┌─────────────────▼───────────────────────────┐
│ Geometry Layer (axia-geo::mesh)             │
│   - Vertex, Edge, HalfEdge, Face (DCEL)    │
│   - Boolean, PushPull, Split 등 순수 연산  │
│   - 의미를 모름                             │
└─────────────────────────────────────────────┘
```

### 불변식 (Invariants)

1. **Geometry Layer는 Semantic Layer를 import하지 않는다.**
   - `axia-geo`는 `axia-core`에 의존하지 않음. 반대 방향만 허용.

2. **Face는 정확히 하나의 XIA에 귀속된다.**
   - `face_to_xia: HashMap<FaceId, XiaId>` 으로 O(1) 역인덱스 유지
   - N:M 관계는 **의도적으로 배제** (아래 "대안" 참조)

3. **XIA의 상태는 저장하지 않고 계산한다.**
   - `face_ids.len()` 로부터 파생 (상세: ADR-002)

4. **Material은 Face의 속성**(Geometry layer)으로 두되,
   변경이 상태 전이를 유발하지는 않는다.
   - 현재 구조를 유지. 순수 Semantic으로 옮기는 것은 파일 포맷 migration이 필요해
     비용 대비 이득이 불명확.

## 근거 (Rationale)

### 레이어 분리의 이점

| 이점 | 설명 |
|-----|------|
| **테스트 용이** | Geometry 연산은 Semantic 없이 순수 함수로 테스트 가능 |
| **재사용성** | axia-geo 단독으로 다른 프론트엔드에 이식 가능 |
| **진화 안정성** | Semantic 레이어의 큰 변화가 기하 알고리즘에 영향 없음 |
| **검증 가능성** | 각 레이어의 불변식을 독립적으로 보장 |

### 단일 소유(1:N) 선택 이유

| 관점 | 이유 |
|-----|------|
| **단순성** | Face는 한 Object의 경계. 이 의미가 가장 자연스러움 |
| **성능** | HashMap 조회 O(1). Vec<XiaId> 순회 불필요 |
| **삭제 의미론** | XIA 삭제 = 자기 소유 Face 삭제. 명확 |
| **Undo** | 트랜잭션 스냅샷 단순 |

## 결과 (Consequences)

### 긍정
- ✅ Group/Component 기능이 Semantic 레이어에서 깔끔히 구현됨 (ADR-005 참조)
- ✅ 직렬화 포맷이 분리 구조로 단순해짐 (AXIA 매직 바이트 + 레이어별 섹션)
- ✅ Rust WASM 빌드 타겟이 axia-geo 단독으로 가능 → Semantic 없는 뷰어 파생 가능

### 부정
- ⚠️ "재질이 같은 인접면 자동 병합" 같은 Semantic-aware 연산을 Geometry 레이어에서 구현하려면 콜백 패턴 필요 (ADR-005에서 다룸)
- ⚠️ BIM-ish 요구사항(벽 A가 방 B의 경계이기도 함)은 현재 구조로 불가능

## 대안 (Alternatives)

### 대안 A: 단일 레이어 (Blender 스타일)
- 각 Object가 자체 메시를 소유
- **기각 이유**: Boolean, Split 등 연산이 객체 간 토폴로지를 다루기 어려움

### 대안 B: N:M 관계 (BIM 스타일)
- `face_to_xias: HashMap<FaceId, Vec<XiaId>>`
- **기각 이유**:
  - BIM 유즈케이스가 현재 없음 (프리매처 최적화)
  - 상태 계산 모호해짐 ("Face X가 Volume Y의 일부이자 Face Z의 일부?")
  - 삭제 의미론 복잡
  - 파일 포맷 breaking change

### 대안 C: Semantic을 Geometry에 태그로 인라인
- Face에 `semantic_tag: Option<XiaRef>` 추가
- **기각 이유**: 레이어 분리 약화. Geometry가 Semantic 구조를 알아야 함

## 재검토 트리거 (When to Revisit)

다음 시나리오 중 하나라도 발생하면 N:M 확장 검토:
- BIM 파일 포맷(IFC) 임포트/익스포트 요구
- "한 면이 여러 방의 경계" 같은 건축 시나리오
- 사용자가 명시적으로 "공유 면(shared face)" 기능 요청

## 관련 기록 (Related)

- CLAUDE.md — "Architecture Decision (2026-04-15 확정)" 섹션
- [ADR-002](./002-xia-state-from-face-count.md) — 상태 계산 방식
- [ADR-005](./005-coplanar-merge-purely-geometric.md) — 레이어 분리를 유지한 merge 정책
