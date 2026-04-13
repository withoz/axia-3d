# Seamless Offset Push-Pull — 빌드 가이드

## 개요

Rhino 스타일의 seamless curved surface offset을 구현했습니다.
갭 없이 wall face를 생성하여 smooth group 전체를 seamlessly offset합니다.

## 변경 사항

### 1. Rust 엔진 (`crates/axia-geo/src/operations/push_pull.rs`)

**추가된 메서드:**
- `push_pull_smooth_group_seamless()` — Smooth group 전체를 seamless하게 offset
- `find_shared_edge_vertices()` — 두 면 간의 공유 엣지 찾기 (wall face 생성용)
- `compute_face_area()` — 면의 넓이 계산 (법선 가중치 계산용)

**알고리즘:**
1. Smooth group의 모든 정점 수집
2. 각 정점의 법선 계산 (인접 면들의 넓이 가중 평균)
3. 모든 정점을 함께 오프셋
4. 인접 엣지에 wall face 생성
5. Seamless 연결 완성 (갭 제거)

### 2. WASM 바인딩 (`crates/axia-wasm/src/lib.rs`)

**추가된 메서드:**
```rust
#[wasm_bindgen]
pub fn push_pull_smooth_group_seamless(
    &mut self,
    face_ids_ptr: *const u32,
    face_ids_len: usize,
    dist: f64,
) -> bool
```

### 3. TypeScript 인터페이스 (`web/src/bridge/WasmBridge.ts`)

**AxiaEngineExtended에 추가:**
```typescript
push_pull_smooth_group_seamless?(faceIds: Uint32Array, distance: number): boolean;
```

### 4. PushPullTool (`web/src/tools/PushPullTool.ts`)

**변경:**
- Line 118-129: 각 면을 개별적으로 push-pull → seamless offset 사용

**이전 (갭 있음):**
```typescript
// 각 면을 독립적으로 push-pull
for (const fid of this.smoothGroupFaces) {
  this.ctx.bridge.pushPull(fid, dist);
}
```

**이후 (seamless):**
```typescript
// Seamless offset
const faceArray = new Uint32Array(this.smoothGroupFaces);
this.ctx.bridge.engine?.push_pull_smooth_group_seamless?.(faceArray, dist);
```

## 빌드 단계

### Step 1: Windows PowerShell에서 Rust WASM 빌드

```powershell
cd 'E:\AXiA 3D\crates\axia-wasm'
wasm-pack build --target web --out-dir ../../web/src/wasm
```

**소요 시간**: 약 1-2분

**확인:**
- `web/src/wasm/axia_wasm.d.ts` 업데이트 여부
- `web/src/wasm/axia_wasm_bg.wasm` 생성 여부

### Step 2: TypeScript 빌드

```powershell
cd 'E:\AXiA 3D\web'
npm run build
```

**확인:**
- 빌드 성공 (에러 없음)
- `web/dist/` 폴더에 새로운 파일 생성

### Step 3: 테스트

**로컬 테스트:**
```powershell
cd 'E:\AXiA 3D\web'
npx vite preview
# 브라우저에서 http://localhost:4173 열기
```

**테스트 단계:**
1. 원통 생성 (Draw Circle → Push/Pull)
2. 원통 옆면 클릭 (전체 곡면이 선택되어야 함)
3. 다시 클릭하여 거리 입력
4. **결과 확인**: 갭 없이 seamless하게 연결되어야 함

## 예상 결과

### Before
```
Push/Pull 후
[갭][갭][갭]     ← 톱니바퀴 패턴
[  빈공간  ]     ← 중앙 구멍
```

### After
```
Seamless Offset 후
[=====연결=====]  ← 벽이 seamless 연결
[ 닫힌 형태  ]    ← 중앙 채워짐
```

## 디버그 정보

빌드 후 브라우저 콘솔 (F12)에서:

```
[RUST] push_pull_smooth_group_seamless: 30 faces, dist=10.000
[SEAMLESS] SmoothGroupSeamless: 30 verts, 30 wall faces
```

## 문제 해결

### Issue: WASM 빌드 실패
```
error: could not compile `axia-geo`
```

**해결:**
1. Rust 버전 확인: `rustc --version` (1.70+)
2. 타겟 설치: `rustup target add wasm32-unknown-unknown`
3. 재빌드: `wasm-pack build --target web`

### Issue: TypeScript 에러
```
Property 'push_pull_smooth_group_seamless' does not exist
```

**해결:**
- WasmBridge.ts의 AxiaEngineExtended 인터페이스 확인
- WASM 빌드 후 axia_wasm.d.ts 재생성 확인

## 다음 단계 (향후 개선)

### Phase 2: 중앙 면 자동 생성
- Wall faces 생성 후
- 중앙 구멍 감지
- 자동으로 수평면 생성하여 채우기

**구현 위치**: `push_pull.rs` 내 `close_ends_if_needed()`

### Phase 3: 성능 최적화
- Spatial hashing으로 인접 면 탐색 가속
- 정점 법선 계산 병렬화
- Wall face 생성 배치 최적화

## 참고 사항

### 기존 단일 면 Push/Pull
- 변경 없음
- 기존 `pushPull(faceId, dist)` 계속 사용

### Smooth Group 감지
- SelectionManager의 `getSmoothGroup()` 사용
- BFS + 30° 각도 임계값
- 자동으로 적용 (수동 설정 불필요)

### 디버그 로그
- TypeScript: `debugLog()` 사용 (개발 모드)
- Rust: `console_log!()` 매크로 사용 (브라우저 콘솔)

---

**빌드 시간**: 약 3-5분 (Rust WASM 1-2분 + TypeScript 1-2분)  
**선호하는 환경**: Windows 11 + Rust 1.70+ + Node.js 18+

