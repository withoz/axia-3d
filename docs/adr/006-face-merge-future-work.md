# ADR-006: Face Merge 미지원 케이스 — Multi-loop / 비인접

- **Status**: Accepted (2026-04-20)
- **Scope**: `axia-geo::mesh::merge_faces_by_edge`, face topology

## 맥락

Phase E Face Merge 개선 작업 중 다음 2가지 요청이 들어옴:

1. **B2**: 구멍(hole)이 있는 면 병합 지원
2. **C1**: 비인접 coplanar 면 병합 (같은 평면에 떨어져 있는 섬들)

두 케이스 모두 동일한 근본 문제를 가진다:
**"여러 outer/inner loop를 가진 face (multi-loop face)"가 DCEL에 없음.**

현재 `Face` 구조:
```rust
pub struct Face {
    outer: HeRef,       // 외부 boundary (단일 loop)
    // no inner loops
    ...
}
```

## 왜 지금 구현하지 않는가

1. **DCEL 전체 리팩토링 필요** — `outer` 필드를 `loops: Vec<HeRef>`로 변경
2. **boolean / pushpull / offset / split 등 모든 연산이 단일 loop 가정**
   기존 코드가 `face.outer().start`를 수십 곳에서 직접 접근
3. **렌더링 레이어 영향** — tessellation이 단일 polygon 가정
   hole이 있는 polygon tessellation은 ear-clipping 대신 constrained Delaunay 필요
4. **serialization 포맷 변경** — AXIA 파일 하위 호환성 이슈
5. **테스트 커버리지** — 800+ 테스트가 단일 loop 가정

Multi-loop 지원은 **CAD-grade 품질을 위해 언젠가 필요**하지만,
Phase E 범위에서는 **안전성 > 새 기능**이 우선.

## 현재 대응 (Safe Path)

### B2 시나리오 감지
`merge_faces_by_edge`의 F4 체크가 이미 차단:
- 두 face가 2+ 엣지를 공유하면 "C-slit / bridge topology" 에러
- 이는 hole을 만들어야 하는 모든 케이스를 포착

### C1 시나리오 감지  
비인접 면은 공유 엣지가 없음:
- `tryMergeAdjacentFaces`가 edge-sharing 쌍만 검토 → 자동 skip
- `analyzeMergeCandidates`의 `total` 필드가 0

### UX 개선
- Toast에 "공유 엣지 1개 필요" 명시 → 사용자가 한계 인지
- ADR 문서로 명확한 rationale 제공

## 미래 작업 (별도 Phase)

Phase F: Multi-loop face support
1. `Face.loops: Vec<HeRef>` 리팩토링
2. 모든 operation이 loops iteration으로 업데이트
3. tessellator를 constrained Delaunay로 교체
4. AXIA v2 포맷 + 마이그레이션
5. 테스트 전면 재검증

예상 기간: **1~2주**

## 결정

**B2와 C1은 Phase F로 연기.** 현재 Phase E는 정확한 에러 메시지와
이 ADR 문서로 사용자 기대치 관리.

— 2026-04-20
