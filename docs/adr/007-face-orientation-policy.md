# ADR-007: Face Orientation Policy — 단일 진실(Single Truth) 정책

- **Status**: Accepted (2026-04-20)
- **Scope**: `axia-geo::mesh`, 모든 편집 연산, 렌더링, 직렬화
- **Supersedes**: (없음) — Normal 관리 기존 ad-hoc 방식을 대체

## 맥락

기존 AXiA는 face의 normal을 입력값처럼 취급했고, 편집 후 정리 단계
(align_face_with_neighbors 등)로 사후 보정. 결과:
- "앞면/뒷면" 판단 분기가 코드 전역에 산재
- Normal 불일치로 인한 검은 면 / 조명 오류 재발
- Merge/Boolean 후 수동 재정렬 필요
- Double-sided 렌더링으로 성능 낭비

## 결정

**7가지 불변식(Invariants)을 AXiA 전역에 강제한다.**

### 원칙 1 — 단일 진실: 솔리드의 외부 = Front
```
닫힌 볼륨(Volume)의 모든 외부 face의 normal은 바깥을 향함.
내부를 향한 face는 존재하지 않거나 Back 전용으로 표기.
```

### 원칙 2 — 전역 Winding
```
CCW(반시계) = Front, CW = Back.
파일 로드 / 프리미티브 / 편집 도구 / Import 모두 이 규칙.
```

### 원칙 3 — Normal은 결과
```
Face.normal은 캐시값. 진실은 loop의 vertex winding.
모든 operation이 필요할 때 topology에서 계산하거나 캐시 invalidate.
```

### 원칙 4 — 편집 중 Invariants 불변
```
다음은 모든 편집 연산 전후에 성립:
  - 모든 Face는 일관된 winding
  - 모든 Half-edge는 반대 엣지(twin)와 양립
  - 외부 face의 normal은 바깥 향함
Merge / Split / Extrude 후 "정리 단계" 불필요.
```

### 원칙 5 — Merge/Boolean 3단계
```
1. 사전 검증: coplanar + winding 일치 + shared edge count
2. 자동 보정: 뒤집힌 face는 reverse로 정렬
3. 명확한 실패:
   - edge loop 불완전
   - non-manifold 생성
   - 허용 각도 초과
   각 사유를 분리된 error variant로 반환.
```

### 원칙 6 — Front-only 렌더
```
기본 재질: single-sided (THREE.FrontSide 만).
Double-sided는 "시각적 예외"로만 사용 (유리·얇은 막 등).
기하 규칙은 항상 유지.
```

### 원칙 7 — Save/Load 정합성 체크
```
Serialize 전: winding 검사 + normal 재계산 + 외부/내부 판별 통과해야 OK.
Deserialize 후: 위 검사 재수행, 실패 시 자동 보정 후 재시도.
```

## 결과 (Benefits)

### 버그 감소
- "어떤 면이 앞면?" 분기 소멸
- Normal 불일치 오류 원천 차단
- Merge 후 재정렬 코드 삭제
- 파일 호환성 보증

### 경량화
- 조건 분기 제거 (`if front ... else ...`)
- Double-sided 렌더 예외만 → GPU 작업량 절감
- "뒤집힌 면 복구" 루프 삭제

### 성능
- Back-face culling 정확 동작 → 픽셀 셰이딩 절반
- Normal lazy 계산 (필요 시만)
- Boolean/Merge 사전 검증 → 실패 빠름

## 의도적 가정 (Trade-offs)

1. **2-manifold oriented 전제**: non-manifold (T-junction 등) 미지원.
   대안: Group으로 여러 solid 분리해 해결.

2. **사용자 직접 normal 편집 불가**: "Shift+N 면 반전"은 **winding 반전**으로
   구현. 결과는 같지만 내부적으로 topology 변경.

3. **Open surface (시트)**: Volume 아니어도 원칙 2(CCW=Front)로 default
   부여. 사용자는 winding flip으로 조정.

4. **공유 내벽**: 두 solid가 같은 face를 공유하는 상태 불허. 해결:
   - Boolean merge로 단일 solid 결합 후 공유면 제거
   - 두 face로 분리 (각자 own XIA)

## 실행 로드맵

### Phase 1 — 검증 인프라 (현재)
- [x] ADR 문서화
- [ ] `Mesh::verify_face_invariants()` — 전체 face 위반 스캔 리포트
- [ ] 테스트 헬퍼 `debug_assert_invariants!()`

### Phase 2 — 감사
- [ ] 프리미티브 (box, sphere, cylinder, cone) winding 검증 테스트
- [ ] Import 파이프라인 (DXF, OBJ, STL, 3DM) winding 검증
- [ ] 현재 위반 사항 리포트 → 수정

### Phase 3 — 편집 연산 가드
- [ ] Draw (line/rect/circle)에 `debug_assert_invariants!`
- [ ] Push/Pull, Move/Rotate/Scale, Offset에 동일 가드
- [ ] Merge, Boolean, Split에 동일 가드

### Phase 4 — 렌더 단순화
- [ ] MeshStandardMaterial 기본 single-sided
- [ ] Two-tone back-side 렌더는 "style preset"으로만 분리

### Phase 5 — 직렬화 가드
- [ ] `Scene::export_versioned_snapshot()` 전 verify_all
- [ ] `Scene::import_versioned_snapshot()` 후 verify_all + 자동 보정

### Phase 6 — 문서 / 테스트
- [ ] CLAUDE.md 정책 반영
- [ ] 위반 시 panic 대신 `Result<_, InvariantViolation>` 반환

## 모니터링

각 Phase 후:
- 테스트 통과율 유지 (≥ 918 frontend, ≥ 165 Rust)
- Build 시간 유지 (Rust ≤ 30s, Vite ≤ 3s)
- Invariant 위반 0건 (프리미티브 + 기본 import 파일)

## 참조

- ADR-003: Geometric Validity Guards (선제 조건)
- ADR-005: Coplanar Merge는 순수 기하 (유지)
- ADR-006: Face Merge Multi-loop (ADR-007이 normal 규칙을 확립)
