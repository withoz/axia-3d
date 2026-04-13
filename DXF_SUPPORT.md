# AXiA 3D — DXF 파일 지원

**상태:** ✅ 완료 (2026-04-13)

## 지원 현황

### 즉시 사용 가능
- **DXF (.dxf)** — AutoCAD DXF 형식 완전 지원
  - 메뉴: File → Import → DXF (.dxf)
  - 또는 File → Import All로 모든 형식 지원

### 지원하는 DXF 엔티티

| 엔티티 타입 | 렌더링 방식 | 설명 |
|-----------|---------|------|
| LINE | LineSegments | 직선 |
| CIRCLE | CircleGeometry | 원 |
| ARC | Arc Path | 호 |
| POLYLINE | LineSegments | 폴리라인 |
| LWPOLYLINE | LineSegments | 경량 폴리라인 |
| SOLID | BufferGeometry | 채워진 면 |
| FACE | BufferGeometry | 3D 면 |
| 3DFACE | BufferGeometry | 3D 면 |

### 현재 지원 포맷 (전체)

| 포맷 | 확장자 | 상태 |
|-----|-------|------|
| OBJ | .obj | ✅ |
| STL | .stl | ✅ |
| glTF / GLB | .glb, .gltf | ✅ |
| COLLADA | .dae | ✅ |
| PLY | .ply | ✅ |
| 3DS | .3ds | ✅ |
| **DXF** | **.dxf** | **✅ NEW** |
| DWG | .dwg | ⏳ 준비중 |
| SketchUp | .skp | ⏳ 준비중 |
| Rhino | .3dm | ⏳ 준비중 |

## 사용 방법

### 1. DXF 파일 불러오기

**방법 1: 메뉴 사용**
```
File → Import → DXF (.dxf)
```

**방법 2: 모든 형식 불러오기**
```
File → Import → Import All Formats
```

### 2. 지원되는 형식

가져온 DXF는 Three.js 형상으로 변환되어 뷰포트에 표시됩니다:
- **LINE, ARC**: LineSegments (와이어프레임)
- **CIRCLE, POLYLINE**: 와이어프레임 또는 메시
- **SOLID, FACE, 3DFACE**: 채워진 메시

### 3. 스타일

가져온 DXF는 AXiA 3D의 표준 스타일 적용:
- **전면**: #CCCCCC (밝은 회색)
- **후면**: #8899BB (약간 어두운 파랑)
- **엣지**: #333366 (짙은 파랑)

## DWG 지원 계획

### 현재 상태: 준비중

DWG 파일 지원은 기술적 제약이 있습니다:
- DWG는 Autodesk의 독점 바이너리 형식
- 완벽한 오픈소스 웹 파서가 거의 없음
- Autodesk 공식 SDK는 유료

### 권장 해결책

**즉시 사용 가능:**
- AutoCAD에서 DWG를 **DXF로 저장** 후 AXiA 3D로 불러오기
- 또는 다른 CAD 소프트웨어(Rhino, LibreCAD 등)에서 DXF 내보내기

**향후 지원 검토:**
1. Autodesk API 통합 (유료)
2. 웹 기반 변환 서비스 연동
3. 오픈소스 DWG 파서 개선 모니터링

## SketchUp / Rhino 지원 계획

### SketchUp (.skp)
- **상태:** 준비중
- **예상 지원:** 향후 릴리스
- **대체 방법:** SKP → COLLADA/glTF 변환 후 사용

### Rhino (.3dm)
- **상태:** 준비중
- **예상 지원:** 향후 릴리스
- **대체 방법:** Rhino → glTF/OBJ 변환 후 사용

## 기술 세부사항

### DXF 파서 라이브러리
- **패키지:** `dxf` (npm)
- **위치:** `web/src/import/FileImporter.ts`
- **메서드:** 
  - `loadDXF()`: DXF 파일 로딩 및 파싱
  - `convertDxfEntityToMesh()`: 엔티티 변환
  - 개별 엔티티 변환 메서드 (createLineFromDxf, etc.)

### 변환 프로세스
1. DXF 텍스트 파일 읽기
2. DxfParser로 파싱
3. 각 엔티티를 Three.js 형상으로 변환
4. Three.js 메시 생성 및 씬에 추가
5. 표준 스타일 적용

## 제한 사항

현재 DXF 가져오기 제한:
- **2D 포함:** 2D 엔티티는 Z=0 평면에 렌더링
- **일부 복잡한 엔티티 미지원:**
  - SPLINE (스플라인)
  - MTEXT (여러 줄 텍스트)
  - INSERT (블록 삽입)
  - 기타 고급 엔티티
- **텍스처/재질:** 현재 DXF 색상 정보는 무시하고 기본 스타일 적용
- **레이어:** 레이어 정보는 무시

## 문제 해결

### DXF 파일을 불러올 수 없음

1. **파일 형식 확인**: 유효한 DXF 파일인지 확인
2. **DXF 버전**: 너무 오래된 DXF 버전 (R12 이전)이면 변환 시도
3. **파일 인코딩**: UTF-8 인코딩 확인
4. **콘솔 확인**: 브라우저 DevTools (F12) → Console에서 오류 확인

### 일부 엔티티가 표시되지 않음

- 지원되지 않는 엔티티 타입일 수 있음
- 콘솔에서 경고 메시지 확인
- 지원되는 엔티티 목록 참고

## 다음 단계

1. **DXF 불러오기 테스트**
   - 다양한 DXF 파일로 테스트
   - 복잡한 엔티티 지원 추가

2. **DWG 지원 평가**
   - 사용자 피드백 수집
   - 기술 솔루션 검토

3. **SketchUp/Rhino 지원**
   - 파일 형식 분석
   - 파서 라이브러리 선정

---

**지원:** DXF 불러오기 관련 문제는 콘솔 로그를 참고하거나, 브라우저 DevTools에서 확인하세요.
