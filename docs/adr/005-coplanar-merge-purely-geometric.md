# ADR-005: Coplanar Merge는 순수 기하 연산

- **Status**: Accepted
- **Date**: 2026-04-17
- **Scope**: `axia-geo::mesh::merge_faces_by_edge`, `axia-geo::operations::push_pull`

## 맥락 (Context)

Push/Pull (CreateFace 모드) 후 다음이 자동 수행된다:

```
1. 새 side face 생성
2. 새 face들의 edge를 순회하며, 인접 face와 coplanar 여부 검사
3. Coplanar면 merge (→ 하나의 face로 병합)
```

이 "Coplanar Merge"는 **SketchUp 스타일 모델링**의 핵심이다:
예) 벽을 Push/Pull로 연장하면, 확장된 벽이 기존 벽과 같은 평면이므로 자동으로 하나의 벽이 됨.

### 문제 제기

"Coplanar merge 조건에 Semantic 정보를 추가하자"는 제안이 나옴:
- 같은 XIA에 속한 경우만 merge
- 같은 material인 경우만 merge
- 같은 group에 속한 경우만 merge

## 결정 (Decision)

**Coplanar Merge는 순수 기하 연산으로 유지한다. Semantic 정보에 접근하지 않는다.**

현재 구현 유지:
```rust
// axia-geo/src/mesh.rs
pub fn merge_faces_by_edge(&mut self, edge_id: EdgeId) -> Result<FaceId> {
    // 1. 엣지를 공유하는 2개 면 찾기
    // 2. 평면성 검사 (are_faces_coplanar_strict)
    // 3. 순수 기하 병합 — Semantic 정보 참조 없음
    ...
}
```

### 확장성 확보 (미래 대비)

Semantic-aware 선택이 필요해질 경우를 대비해, **콜백 패턴**으로 확장 가능한 구조만 열어둔다:

```rust
// 미래 시그니처 (현재 구현하지 않음)
pub fn merge_faces_by_edge_filtered<F>(
    &mut self,
    edge_id: EdgeId,
    allow_merge: F,
) -> Result<FaceId>
where
    F: Fn(FaceId, FaceId) -> bool,
{
    // ... coplanar check ...
    if !allow_merge(face_a, face_b) {
        bail!("Merge rejected by filter");
    }
    ...
}
```

`allow_merge` 콜백은 호출자 (axia-core의 scene.rs)에서 제공하며, 여기서 XIA/material 검사 가능.
**하지만 현재는 도입하지 않는다.**

## 근거 (Rationale)

### 레이어 분리 원칙 (ADR-001) 보호

Coplanar Merge가 Semantic 정보에 접근하면:
- `axia-geo` → `axia-core` 역의존성 발생
- 현재의 "Geometry는 Semantic을 모른다" 불변식 위반
- 빌드 의존성 뒤얽힘

### 사용자 기대와의 일치

SketchUp/AixxiA 관행에서:
- **같은 평면의 인접 면은 "하나의 면"으로 취급되는 것이 자연스러움**
- 재질이 다른 것은 렌더링 시 처리 (face별 material tint)
- 그룹이 다른 것은 그룹 해제 의도로 읽힘

즉 **현재 동작이 CAD 관행과 부합**.

### 복잡도 비용

Semantic 조건부 merge 도입 시:
- 테스트 케이스 폭증 (같은 XIA/다른 XIA × 같은 material/다른 material × ...)
- 사용자가 왜 merge되지 않았는지 이해하기 어려움
- 디버깅 시 "왜 이 면이 안 합쳐지지?" 질문 급증

이득(엣지 케이스 대응) 대비 비용이 큼.

## 결과 (Consequences)

### 긍정
- ✅ Layer 분리 유지 (ADR-001 준수)
- ✅ merge 로직이 단순하고 테스트하기 쉬움
- ✅ 기존 동작 변경 없음 → 회귀 없음

### 부정
- ⚠️ **같은 재질로 설정된 이웃 벽이 자동 합쳐짐**
  - 의도치 않은 경우 사용자가 후처리 필요 (Split로 분리)
  - 실사용 패턴상 드물게 문제됨

- ⚠️ **다른 XIA 간 면 병합 불가**
  - 그러나 애초에 Push/Pull은 한 XIA 내에서만 실행되므로 실질적으로 발생 안 함
  - Boolean 연산은 별도 로직 사용 (이미 XIA 병합 처리)

## 대안 (Alternatives)

### 대안 A: 즉시 Semantic 조건화
- `merge_faces_by_edge(edge, &scene)` 로 scene 참조 주입
- **기각**: 레이어 분리 위반

### 대안 B: Face에 `merge_tag: u64` 저장
- 기하 내부에 "같은 태그면 merge 허용" 정보만 보관
- **기각**: 
  - Face 구조 변경 → 파일 포맷 migration
  - 태그 정책은 결국 Semantic 결정이므로 간접 위반

### 대안 C: 콜백 패턴 (미래 대비)
- 호출자가 판정 함수 주입
- **보류**: 필요 시점에 도입. 현재는 API 확장 비용 > 이득.

## 재검토 트리거

- 사용자가 "재질 다른 이웃 벽이 합쳐져서 불편하다"를 명시적으로 리포트
  - 대응: 콜백 패턴 도입 + 기본값은 현재 동작 유지
- Group/Component 기능이 "그룹 경계에서는 merge 안 함"을 요구하게 되는 경우
  - 대응: `allow_merge` 콜백에서 그룹 경계 검사

## 구현 가이드라인

### Push/Pull의 merge 호출 지점

```rust
// axia-geo/src/operations/push_pull.rs — push_pull_create_face
let mut processing_queue: VecDeque<FaceId> = new_face_ids.clone().into();
while let Some(fid) = processing_queue.pop_front() {
    let edges = self.face_outer_edges(fid)?;
    for edge_id in edges {
        match self.merge_faces_by_edge(edge_id) {
            Ok(new_fid) => {
                processing_queue.push_back(new_fid);
                break;
            }
            Err(_) => continue,  // non-coplanar or not shared by 2 faces
        }
    }
}
```

### Face별 재질 다른 경우의 처리

현재 `merge_faces_by_edge`는 f1의 재질을 사용:
```rust
let material = self.faces[f1].material();
```

사용자가 재질 차이에 민감하면 merge 후 오버라이드 가능. 기본 정책은 "첫 번째 face 기준".

## 관련 기록

- [ADR-001](./001-geometry-semantic-layer-separation.md) — 레이어 분리 원칙 (이 결정의 상위 원칙)
- `crates/axia-geo/src/mesh.rs::merge_faces_by_edge` — 구현
- `crates/axia-geo/src/operations/push_pull.rs::push_pull_create_face` — merge 호출 지점
