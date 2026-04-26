# ADR-007: Face Orientation Policy — Volume-Bound Property

- **Status (Rev 2)**: Accepted (2026-04-25)
- **Status (Rev 1)**: Superseded (2026-04-20 ~ 2026-04-25)
- **Scope**: `axia-geo::mesh`, 모든 편집 연산, 렌더링, 직렬화
- **Supersedes**: ADR-007 Rev 1 (전역 winding 절대규칙)

## 핵심 변경 (Rev 1 → Rev 2)

> **"면의 앞/뒷면은 면 자체의 속성이 아니라 닫힌 볼륨의 멤버가 되었을 때
> 비로소 정의되는 맥락적 속성이다."**

실물 형상에서도 종이 한 장에는 "앞면/뒷면"이 본질적으로 존재하지 않는다.
관찰자가 어느 쪽을 보느냐에 따라 정해질 뿐이다. 닫힌 박스가 만들어진
순간 비로소 "외부면 = 보이는 쪽 = Front", "내부면 = 안쪽 = Back" 이
의미를 가진다. AXiA 3D 도 이 직관을 따른다.

## Rev 1 과의 차이

| 항목 | Rev 1 (Superseded) | Rev 2 (현재) |
|------|--------------------|------|
| 단일 sheet 의 winding | CCW = Front 강제 | **무의미** (winding 자유) |
| Sheet 렌더 | FrontSide + BackSide 구분 | **양면 동등** (DoubleSide 1 mesh) |
| Push/Pull 방향 | 면의 normal 부호로 결정 | **사용자가 extrude 시점에 결정** |
| Shift+N flip | 모든 face | **Wall(volume member) 만** |
| Boolean operand | 모든 face 가능 | **Wall 만** (sheet 거부) |
| Save/Load winding 검증 | 모든 face | **Wall 만** |

## 면 분류 (Face Classification)

토폴로지 기반 자동 분류. 사용자가 명시적으로 표시하지 않는다.

```
def classify(face):
    for he in face.outer_loop:
        twin = he.twin
        if twin.face is null or twin.face is inactive:
            return "Sheet"      # boundary HE 발견
    for inner_loop in face.inners():
        for he in inner_loop:
            twin = he.twin
            if twin.face is null or twin.face is inactive:
                return "Sheet"
    return "Wall"               # 모든 HE 의 twin 이 active face 에 속함
```

즉:
- **Sheet** = manifold-with-boundary 의 boundary face 또는 standalone planar face
- **Wall** = closed volume 의 외피면 (모든 엣지가 다른 active face 와 공유됨)

## 새 7가지 원칙

### 원칙 1 — 면 분류는 topology 결과
```
Sheet vs Wall 은 mesh 토폴로지의 자동 도출 속성.
사용자가 별도 플래그 설정 안 함. 매 invariant 검사에서 재계산.
```

### 원칙 2 — Sheet 의 양면 동등성
```
Sheet face 는 양쪽 모두 외부.
- 렌더: DoubleSide (또는 양쪽 동일 색)
- Winding: 자유 — CCW/CW 여부는 그린 도구의 임의 산물
- Shift+N flip: 의미 없음, UI 비활성화
- Boolean operand: 거부 (inside/outside 미정의)
```

### 원칙 3 — Wall 의 외부 = Front
```
닫힌 볼륨의 외피면은 외부 winding = CCW = Front.
- 렌더: FrontSide (back-face culling)
- Normal: topology 의 winding 에서 도출 (캐시는 결과)
- Save/Load 시 winding 검증
- Boolean/Merge 시 winding 일치 검증
```

### 원칙 4 — 동적 재분류
```
편집 연산이 sheet ↔ wall 전이를 발생시킬 수 있다:
- Push/Pull(sheet)         → 결과는 wall 셋. 사용자가 extrude 한 방향이 외부.
- Boolean Subtract(wall)   → 일부 면이 sheet 로 돌아갈 수 있음.
- Erase Edge               → wall 의 한 면이 분리되면 sheet 로 강등.
연산자는 분류 변경을 명시적으로 처리한다.
```

### 원칙 5 — Merge / Boolean 사전 검증
```
Boolean / Merge 입력은 Wall 만 허용.
1. 사전 검증: 모든 입력 face 가 wall 인지 + winding 일치
2. 자동 보정: 뒤집힌 wall 은 reverse
3. 명확한 실패 사유:
   - sheet 가 operand 에 포함됨 (사용자에게 closed-volume 요청)
   - wall 인데 winding 불일치 자동 보정 실패
   - non-manifold 결과
```

### 원칙 6 — 렌더 모드 분기
```
Wall  : FrontSide single-sided (CAD 모드)
        - back-face culling 으로 픽셀 셰이딩 절반
Sheet : DoubleSide 또는 (FrontSide+BackSide 양쪽 동일 재질)
        - 양쪽에서 모두 보임
재질 / 두 톤 시각효과는 wall 에만 적용.
```

### 원칙 7 — Save/Load 정합성 (Wall 한정)
```
Wall face: serialize 전 winding 검사 + normal 재계산.
Sheet face: winding 자유, 위반 검사 안 함.
Deserialize 후: Wall 만 invariant 검증, 위반 시 자동 보정.
```

## 결과 (Benefits)

### UX 직관성
- 시트 그리면 양쪽 모두 보임 — 사용자가 "왜 한쪽만 보이지?" 묻지 않음
- Push/Pull 방향이 그리는 방향과 분리됨 — 마우스로 직관 결정
- SketchUp 사용자에게 익숙한 모델

### 코드 단순화
- Sheet 의 winding 검증/flip/Boolean 분기 모두 제거
- "open surface 는 어떻게 처리?" 질문 표준화
- ADR-008 Axiom (M1 split, B1 hole-promote 등) 은 wall context 에서만 의미

### 회귀 안정
- 기존 wall 케이스 (push-pull box, primitive solids) 정확히 Rev 1 동작 유지
- Sheet 케이스는 winding 검증 완화로 더 관대 (false positive 감소)

## 의도적 가정 (Trade-offs)

1. **분류 비용**: face 마다 outer loop + inners 의 모든 HE twin 검사. 일반적
   `O(perimeter)` 비용. 캐싱 가능 (mesh 변경 시 무효화).

2. **경계 케이스**: wall 한 변이 비매니폴드(3 faces 공유)면 분류 모호. 현재
   정책: `is_face_in_volume = false` 로 fallback (안전한 sheet 처리).

3. **Boolean 입력 거부**: 사용자가 sheet 로 Boolean 시도하면 명시적으로
   거부. Toast 안내: "Boolean 은 닫힌 볼륨에만 사용 가능합니다."

4. **Push/Pull on sheet 방향 선택 UX**: 마우스 이동 부호로 자동 결정 또는
   화살표/wheel 토글 — Phase B 구현 단계에서 별도 결정.

## 실행 로드맵

### Phase A — 분류 인프라 + 렌더 (이번 작업)
- [x] ADR Rev 2 문서화
- [ ] `Mesh::is_face_in_volume(fid) -> bool` 분류기
- [ ] WASM `isFaceInVolume(faceId)` 노출
- [ ] Viewport 렌더 분기: sheet → DoubleSide 단일 mesh, wall → 기존 two-tone
- [ ] 회귀 테스트 5+

### Phase B — 도구 동작 변경 (별도 세션)
- [ ] Push/Pull 사용자 방향 선택 UX
- [ ] Shift+N flip: wall 에서만 동작
- [ ] BooleanHandler: sheet operand 거부 + Toast
- [ ] 기존 push-pull / boolean 테스트 재검토

### Phase C — 검증 정책 완화 (정리 작업)
- [ ] `verify_face_invariants`: sheet 의 winding 위반 Pass
- [ ] `export_versioned_snapshot_strict`: 분류 별 검증
- [ ] Import 파이프라인 (DXF/OBJ/STL/3DM): sheet 입력은 winding 자유

## 참조

- ADR-003: Geometric Validity Guards (선제 조건)
- ADR-005: Coplanar Merge 는 순수 기하
- ADR-006: Multi-loop Face (hole 지원)
- ADR-007 Rev 1 (Superseded): Single Truth Winding (`docs/adr/007-face-orientation-policy.rev1.md` 백업)
- ADR-008: Face Operation Axioms (wall context 전제)
