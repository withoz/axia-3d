# DWG 아키텍처 검토 보고서

**검토일:** 2026-04-13  
**검토자:** Architecture Team  
**상태:** ⚠️ 부분 준수, 개선 필요

---

## 1️⃣ 권장 설계 vs 현재 구현

### 권장 설계 (사용자 제안)
```
[DWG 파일]
    ↓
[dwgdxf (MIT)] ← 변환만 담당
    ↓
[DXF 문자열]
    ↓
[AxiA DXF Importer] ← 엔진 입구
    ↓
[Line/Face/XIA]
```

### 현재 구현
```
[DWG 파일]
    ↓
[dwgdxf (MIT)] ✅
    ↓
[DXF + LibreDwg (GPL)] ❌
    ↓
[FileImporter.loadDWG()]
    ↓
[메시 생성]
```

---

## 2️⃣ 현황 분석

### ✅ 올바른 부분

| 항목 | 상태 | 근거 |
|------|------|------|
| dwgdxf | ✅ MIT | `"license": "MIT"` in package.json |
| 브라우저 기반 | ✅ WASM | `"Client-side DWG→DXF converter"` |
| 변환기 사용 | ✅ | `import { convertDwgToDxf } from 'dwgdxf'` |

**코드:**
```typescript
// FileImporter.ts:663
const dxfBytes = await convertDwgToDxf(new Uint8Array(buffer));
```
→ 이 부분은 정확함 ✅

### ❌ 문제점

**LibreDwg 포함 (GPL v3)**

| 항목 | 현황 | 문제 |
|------|------|------|
| import | `import { LibreDwg } from '@mlightcad/libredwg-web'` | GPL 라이선스 |
| 용도 | DWG 메타데이터 추출 시도 | 엔진에 GPL 침범 |
| 필요성 | 메타데이터 추출 | **DXF로 충분** |

**코드:**
```typescript
// FileImporter.ts:695
const libredwg = await LibreDwg.getInstance();
const result = libredwg.dwg_read_data(buffer, 0);
```
→ 이것이 GPL 오염 경로 ❌

---

## 3️⃣ 라이선스 위험 분석

### 현재 상태

```
AxiA 엔진 (MIT)
    ↓
FileImporter (MIT)
    ↓
dwgdxf (MIT) ✅
LibreDwg (GPL) ❌
    ↓
결과: 엔진 전체 GPL 오염 위험
```

### 위험도

**🔴 HIGH RISK**
- LibreDwg는 GPL v3
- FileImporter에서 직접 import
- 엔진과 분리되지 않음
- 상용 배포 시 문제 가능

---

## 4️⃣ 권장 개선안

### 단계 1: LibreDwg 제거 ✅

```typescript
// ❌ 제거할 코드 (FileImporter.ts)
import { LibreDwg } from '@mlightcad/libredwg-web';

private async extractDWGMetadata(buffer: ArrayBuffer): Promise<DWGMetadata | null> {
  const libredwg = await LibreDwg.getInstance();
  // ...
}
```

### 단계 2: DXF 기반 메타데이터 ✅

```typescript
// ✅ 추가할 코드
// DXF 파싱 후 헤더에서 메타데이터 추출
private extractMetadataFromDxf(dxfString: string): DWGMetadata {
  // DXF HEADER 섹션 파싱
  // $ACADVER, $CODEPAGE, $TITLE 등 추출
  // → 라이선스 안전
}
```

**DXF 헤더 예시:**
```dxf
0
SECTION
2
HEADER
9
$ACADVER
1
AC1015
9
$CODEPAGE
3
ANSI_1252
9
$TITLE
1
My Drawing
```

### 단계 3: 아키텍처 확정

```typescript
async loadDWG(file: File): Promise<THREE.Group> {
  const buffer = await file.arrayBuffer();
  
  // Phase 1: dwgdxf로 변환 (변환기 역할)
  const dxfBytes = await convertDwgToDxf(new Uint8Array(buffer));
  const dxfText = new TextDecoder().decode(dxfBytes);
  
  // Phase 2: DXF 메타데이터 추출 (엔진 역할)
  const metadata = this.extractMetadataFromDxf(dxfText);
  
  // Phase 3: DXF 파싱 및 기하 생성
  const dxfData = parseDxf(dxfText);
  const group = this.processDxfEntities(dxfData);
  
  return group;
}
```

---

## 5️⃣ DXF 헤더에서 추출 가능한 정보

```typescript
interface DWGMetadata {
  // DXF 헤더에서 추출
  version?: string;      // $ACADVER (AC1015, AC1018, ...)
  codepage?: string;     // $CODEPAGE
  title?: string;        // $TITLE
  subject?: string;      // $SUBJECT
  author?: string;       // $AUTHOR
  keywords?: string;     // $KEYWORDS
  created?: number;      // $TDCREATE
  modified?: number;     // $TDUPDATE
  
  // 계산됨
  unitSystem?: string;   // $INSUNITS (1=inch, 4=mm)
  extmin?: Vector3;      // $EXTMIN
  extmax?: Vector3;      // $EXTMAX
}
```

**DXF 파싱 예시:**
```typescript
private extractMetadataFromDxf(dxfText: string): DWGMetadata {
  const metadata: DWGMetadata = {};
  const headerMatch = dxfText.match(/0\nSECTION\n2\nHEADER([\s\S]*?)0\nENDSEC/);
  
  if (headerMatch) {
    const header = headerMatch[1];
    
    // $ACADVER 추출
    const verMatch = header.match(/9\n\$ACADVER\n1\n([^\n]+)/);
    if (verMatch) metadata.version = verMatch[1];
    
    // $TITLE 추출
    const titleMatch = header.match(/9\n\$TITLE\n1\n([^\n]+)/);
    if (titleMatch) metadata.title = titleMatch[1];
    
    // ... 다른 필드들
  }
  
  return metadata;
}
```

---

## 6️⃣ 변경 사항 체크리스트

| 작업 | 현황 | 우선도 | 예상시간 |
|------|------|--------|---------|
| LibreDwg import 제거 | ❌ 미완료 | 🔴 HIGH | 5분 |
| DXF 헤더 파싱 추가 | ❌ 미완료 | 🔴 HIGH | 30분 |
| 타입 정의 업데이트 | ⚠️ 부분완료 | 🟡 MED | 10분 |
| 테스트 (DWG 파일) | ❌ 미완료 | 🟡 MED | 15분 |
| 문서화 | ❌ 미완료 | 🟢 LOW | 10분 |

---

## 7️⃣ 구현 상세

### 제거할 코드

```typescript
// ❌ FileImporter.ts 라인 22 제거
import { LibreDwg } from '@mlightcad/libredwg-web';

// ❌ FileImporter.ts 라인 691-731 메서드 제거
private async extractDWGMetadata(buffer: ArrayBuffer): Promise<DWGMetadata | null>
```

### 추가할 코드

```typescript
// ✅ FileImporter.ts에 추가
private extractMetadataFromDxf(dxfText: string): DWGMetadata {
  const metadata: DWGMetadata = {};
  
  try {
    // DXF HEADER 섹션 추출
    const headerMatch = dxfText.match(
      /0\nSECTION\n2\nHEADER([\s\S]*?)0\nENDSEC/
    );
    
    if (!headerMatch) return metadata;
    
    const header = headerMatch[1];
    
    // 헤더 변수들 추출
    const extractVar = (varName: string): string | undefined => {
      const regex = new RegExp(`9\\n\\$${varName}\\n1?\\n([^\\n]+)`);
      const match = header.match(regex);
      return match ? match[1] : undefined;
    };
    
    metadata.version = extractVar('ACADVER');
    metadata.codepage = extractVar('CODEPAGE');
    metadata.title = extractVar('TITLE');
    metadata.subject = extractVar('SUBJECT');
    metadata.author = extractVar('AUTHOR');
    metadata.keywords = extractVar('KEYWORDS');
    
    console.log('[FileImporter] DXF 메타데이터 추출:', metadata);
  } catch (err) {
    console.warn('[FileImporter] DXF 메타데이터 추출 실패:', err);
  }
  
  return metadata;
}
```

### 통합 코드

```typescript
async loadDWG(file: File): Promise<THREE.Group> {
  const buffer = await file.arrayBuffer();
  
  console.log(`[FileImporter] DWG 변환 시작: ${file.name}`);
  
  // dwgdxf 초기화
  try {
    await initDwgDxf();
  } catch (err) {
    console.warn('[FileImporter] dwgdxf 초기화 건너뜀:', err);
  }
  
  // DWG → DXF 변환
  let dxfText: string;
  try {
    const dxfBytes = await convertDwgToDxf(new Uint8Array(buffer));
    dxfText = new TextDecoder().decode(dxfBytes);
    console.log('[FileImporter] DWG → DXF 변환 완료');
  } catch (err) {
    console.error('[FileImporter] DWG 변환 실패:', err);
    throw new Error(`DWG 변환 실패: ${(err as Error).message}`);
  }
  
  // 메타데이터 추출 (DXF 헤더에서)
  const metadata = this.extractMetadataFromDxf(dxfText);
  
  // DXF 파싱 및 기하 생성
  const dxfData = parseDxf(dxfText);
  
  const group = new THREE.Group();
  group.name = `import-dwg-${file.name}`;
  
  if (dxfData.entities) {
    const entities = Array.isArray(dxfData.entities)
      ? dxfData.entities
      : (dxfData.entities.value || []);
    
    for (const entity of entities) {
      const mesh = this.convertDxfEntityToMesh(entity);
      if (mesh) group.add(mesh);
    }
  }
  
  console.log('[FileImporter] 완료: DWG → DXF → 메시',
    `메시:${group.children.length}`
  );
  
  return group;
}
```

---

## 8️⃣ 최종 아키텍처 (개선 후)

```
[사용자]
   │
   │  .dwg or .dxf
   ▼
[FileImporter]
   │
   ├─→ .dxf → parseDxf() ← [DXF Import Pipeline]
   │           ↓
   │     extractMetadataFromDxf() ← DXF Header (NO GPL)
   │           ↓
   │     entities → convertDxfEntityToMesh()
   │           ↓
   ├─→ [Three.js Group] ✅
   │
   └─→ No GPL ✅
       No external parsing tools ✅
       Pure DXF-based metadata ✅
```

---

## ✅ 최종 체크리스트

- [ ] LibreDwg import 제거
- [ ] DXF 헤더 파싱 메서드 추가
- [ ] loadDWG 메서드 수정
- [ ] TypeScript 컴파일 성공
- [ ] DWG 파일로 테스트
- [ ] DXF 메타데이터 검증
- [ ] 문서 업데이트

---

## 📋 결론

**현재:** ⚠️ dwgdxf (MIT) + LibreDwg (GPL) 혼합 구조 → **GPL 위험**

**목표:** ✅ dwgdxf (MIT) + DXF Header Parsing (내장) → **완전 안전**

**개선 후 이점:**
- 🔒 GPL 오염 제거
- 🚀 성능 향상 (외부 라이브러리 제거)
- 📦 번들 크기 감소
- 🔧 유지보수 단순화
- ⚖️ 법률 위험 제거

---

**검토 완료:** 2026-04-13  
**다음 단계:** 개선안 구현
