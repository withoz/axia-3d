# ADR-004: 안정 ID는 XIA-level만 (Face GUID 금지)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Scope**: `axia-core::xia`, `axia-geo::FaceId`

## 맥락 (Context)

모델링 연산은 토폴로지를 **생성/파괴**한다:
- Push/Pull: 원본 face + 새 top face + side faces
- Boolean: A - B 결과에 새로 생긴 face
- Split: 하나의 face → 두 개
- Coplanar Merge: 두 face → 하나

사용자가 "이 면이 천장이다" 같은 **안정적인 참조**를 하려면:
- Face에 재질 할당
- Group에 면 포함
- 외부 constraint (미래 기능)

연산 후에도 "그 면"을 유지하려면 안정 ID가 필요한데, 현재 `FaceId`는 슬롯 인덱스 u32로 **연산마다 재발급**된다.

## 결정 (Decision)

**Face 단위 안정 ID(GUID)는 도입하지 않는다. 안정성은 XIA-level에서만 보장한다.**

### 유지되는 것

```rust
pub struct Xia {
    pub id: XiaId,               // ← 안정, 영속
    pub face_ids: Vec<FaceId>,   // ← 휘발성, 연산마다 갱신
    pub name: Option<String>,
    pub material: MaterialId,
    ...
}
```

- **XiaId**: 모노토닉 카운터, 삭제 후에도 재사용 금지, 파일 저장 시 유지
- **FaceId**: 슬롯 인덱스, 재사용 가능, 연산 후 변경 가능

### 연산 후 재매핑 책임

Push/Pull, Split 등 연산을 수행한 코드가 **결과 face들을 XIA의 `face_ids`에 반영**:

```rust
// scene.rs::exec_push_pull 예시
let pp_result = self.mesh.push_pull(face_id, dist, ...)?;
if let Some(xia) = self.xias.get_mut(&owning_xia_id) {
    if pp_result.base_removed {
        xia.face_ids.retain(|&f| f != face_id);
    }
    xia.face_ids.push(pp_result.top_face);
    xia.face_ids.extend(pp_result.side_faces.iter());
}
// face_to_xia 역인덱스도 갱신
```

## 근거 (Rationale)

### Face GUID의 근본 문제

> **기하 연산은 토폴로지를 CREATE/DESTROY 한다. GUID는 영속성을 약속한다. 이 모순은 해결 불가.**

#### 구체적 난제

| 연산 | GUID 정책 문제 |
|-----|--------------|
| Push/Pull CreateFace | base face + top face. base GUID를 top이 상속? 새로? |
| Coplanar Merge | 두 face → 하나. 누가 survive? "larger area wins"? |
| Face Split | 하나 → 둘. 원본 GUID는 어느 쪽? 위치 기반 휴리스틱? |
| Boolean Subtract | A의 일부 면 + B 형상으로 잘린 새 면. 매핑 불가능 |

모든 정책이 **휴리스틱**이 되며, 사용자 기대와 어긋날 수 있음.

### XIA-level로 충분한 이유

대부분의 사용자 관심사는 "이 **객체**가 무엇인가"지, "이 **면**이 무엇인가"는 아님.

- ✅ 재질 할당: XIA 단위로 충분 (Face-level 재질도 가능하지만 XIA 기본값 상속 구조)
- ✅ 그룹: XIA 기반 (면은 XIA 내 세부사항)
- ✅ 이름/레이블: XIA 단위가 자연스러움 ("벽 A", "천장")
- ✅ 외부 참조(constraint): XIA 간 관계로 모델링

Face를 직접 참조해야 하는 경우는 드물며, 그때는 "연산 후 재해결(re-resolve)" 휴리스틱으로 충분:
- 법선 방향
- 중심점 근접성
- 이웃 XIA

### 저장 비용

안정 GUID 채택 시:
- Face당 u128 GUID + 맵핑 테이블
- 10000 face 기준 수십 KB~수백 KB
- 파일 포맷 migration

반면 XIA 수는 일반적으로 Face 수보다 훨씬 적음 (XIA당 평균 5~20 face):
- 안정성 보장 비용이 훨씬 낮음

## 결과 (Consequences)

### 긍정
- ✅ 연산 구현이 단순 — 휴리스틱 매핑 불필요
- ✅ 파일 크기 절감 — Face GUID 테이블 없음
- ✅ 현재 `face_to_xia: HashMap<FaceId, XiaId>` 구조 그대로 유지

### 부정
- ⚠️ Face-level 영속 참조 불가능
  - 예: "이 면에 텍스처 A를 붙였다" → 연산 후 텍스처 재적용 로직 필요
  - **대응**: XIA 단위 재질/텍스처 할당 + Face별 오버라이드는 별도 관리 (필요 시)

- ⚠️ Undo/Redo에서 Face 참조가 일관되지 않을 수 있음
  - 현재는 스냅샷 전체 복원으로 해결 중
  - **대응**: 트랜잭션 경계 내에서는 FaceId가 유효하다는 약속만 보장

## 대안 (Alternatives)

### 대안 A: Face-level UUID
- **기각**: 위의 근본 모순 + 저장 비용 + 휴리스틱 매핑 복잡성

### 대안 B: Face "lineage" 추적 (부모-자식 관계)
- Split 시 "이 면은 FaceX에서 유래" 기록
- Merge 시 여러 부모 기록
- **기각**: 트리가 무한히 성장, 실용적 가치 낮음

### 대안 C: 특성 기반 재해결
- 재질/그룹 할당 시 "법선, 중심, 면적" 기록 → 연산 후 근접한 것에 재할당
- **보류**: 필요 시 도입 가능. XIA-level로 대부분 해결되므로 현재 불필요.

## 재검토 트리거

- 사용자가 Face별 영속 속성(커스텀 태그 등) 기능을 요청
- BIM 유즈케이스에서 Face-level 레이블링 필수
- 외부 constraint 시스템이 Face 단위 참조 요구

## 관련 기록

- `crates/axia-core/src/xia.rs` — XiaId 정의
- `crates/axia-geo/src/entities/ids.rs` — FaceId (슬롯 인덱스)
- `crates/axia-core/src/scene.rs::exec_push_pull` — 연산 후 face_ids 갱신 예시
