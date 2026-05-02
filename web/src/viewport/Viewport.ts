/**
 * Three.js Viewport — AixxiA-style background + infinite grid shader
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FurShell } from './FurShell.js';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';
import { getMaterialLibrary, TextureInfo } from '../materials/MaterialLibrary';
import { getTextureCache } from '../materials/TextureCache';
import { computeUVsFromBuffers, UVProjectionParams } from '../materials/UVProjection';
import { WasmBridge, DeltaBuffers } from '../bridge/WasmBridge';
import { frameScheduler } from '../core/FrameScheduler';
import {
  pixelToWorldPerspective,
  pixelToWorldOrthographic,
} from './screen_threshold';

// Phase C1: Patch Three.js Mesh/BufferGeometry with BVH-accelerated raycast.
// All raycaster.intersectObjects calls now use BVH automatically on meshes
// whose geometry has called computeBoundsTree().
(THREE.BufferGeometry.prototype as unknown as {
  computeBoundsTree: typeof computeBoundsTree;
  disposeBoundsTree: typeof disposeBoundsTree;
}).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as {
  disposeBoundsTree: typeof disposeBoundsTree;
}).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

export type ViewMode = '3d' | 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left';

// Reusable vectors for pan operations (avoid allocation in mousemove handler)
const _panRight = new THREE.Vector3();
const _panUp = new THREE.Vector3();
const _zoomTmp = new THREE.Vector3();
const _zoomMouse = new THREE.Vector2();
const _zoomRaycaster = new THREE.Raycaster();

export class Viewport {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly orthoCamera: THREE.OrthographicCamera;

  // View mode
  private _viewMode: ViewMode = '3d';
  private orthoZoom = 10000;  // ortho camera frustum half-size

  // Scene objects (2026-04-23: infiniteGrid/axisGroup public — MenuBar의 토글
  //   상태 동기화에서 .visible 읽기 필요. 쓰기는 여전히 setGridVisible 등
  //   전용 메서드 경유.)
  public infiniteGrid: THREE.Group;
  public meshGroup: THREE.Group;  // 2026-04-23: SectionPlane 접근용 public
  public axisGroup!: THREE.Group;  // 축 화살표+라벨 그룹 (줌 비례 스케일)
  private axisLines: THREE.Object3D[] = []; // X,Y 축 연장선

  // Style settings
  private _bgMode: 'solid' | 'gradient2' | 'gradient3' = 'gradient2';
  private _bgSkyColor = '#8eaac4';
  private _bgMidColor = '#b0c4d8';
  private _bgGroundColor = '#d8dce2';
  // 2026-04-22: 선명도 개선 번들 A+B 적용.
  //   frontColor: 0xe8e8e8 → 0xc8ccd0 — IBL + ACES 조합에서 near-white
  //                                     포화 방지, 면 contrast 확보.
  //   edgeColor : 0x333366 → 0x1a1a2e — 밝은 면과 대비를 강화.
  private _frontColor = 0xc8ccd0;
  private _backColor = 0x8899bb;
  // 2026-04-23: 0x1a1a2e → 0x0a0a14. 1px 엣지 선명도 최대화를 위해 RGB를
  //   (26,26,46) → (10,10,20)으로 낮춰 순검정에 근접. 밝은 면(#c8ccd0) 대비
  //   15:1 → 23:1로 상승, WCAG AAA 대비도 초과. 여전히 완전 0x000000은 피해
  //   ACES 톤매핑 후에도 딥네이비의 미묘한 질감 유지.
  private _edgeColor = 0x0a0a14;
  /** ADR-007 Phase 4 — CAD 모드: single-sided 렌더링 (BackSide mesh 생략, GPU ↑) */
  private _singleSidedRender = false;
  /** ADR-018 dev toggle — when true, every face renders two-tone (legacy
   *  mode 그대로). false (기본): open mesh 는 양면 동일 white,
   *  closed solid 만 두 톤. 사용자 StylePanel 토글로 제어. */
  private _showFaceOrientation = false;
  private _faceOpacity = 1.0;
  private _edgeVisible = true;
  private _profileEdge = true;
  /** Edge line width in CSS pixels (world-space, respects DPR). Controls the
   *  `LineMaterial.linewidth` used by LineSegments2 — unlike LineBasicMaterial,
   *  this actually takes effect on all platforms. Range: 1 ~ 5 from StylePanel.
   *  2026-04-22: 1.5 → 2.0 기본값 상향. 고양이/강아지처럼 곡면 많은 모델에서
   *  형태감 식별력 향상. */
  private _edgeWidth = 1.0;
  /** Cache of Mesh-edge LineMaterials so resize + width changes are fast.
   *  Separate from the axis LineMaterials (lineMaterials arr in constructor). */
  private _meshEdgeMaterials: LineMaterial[] = [];
  /** Pending requestAnimationFrame id for deferred smoothNormals.
   *  Cancel-and-replace ensures we never run an old normal pass on top
   *  of a fresher mesh. */
  private _pendingSmoothNormalsRaf: number | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;

  // Cleanup references
  private _resizeObserver: ResizeObserver | null = null;
  /** External resize subscribers — called with (width, height) after the
   *  internal renderer + composer + line-material updates. */
  private _resizeListeners: Array<(w: number, h: number) => void> = [];

  /** Subscribe to viewport resize events. Returns an unsubscribe fn. */
  onResize(cb: (w: number, h: number) => void): () => void {
    this._resizeListeners.push(cb);
    return () => {
      const i = this._resizeListeners.indexOf(cb);
      if (i >= 0) this._resizeListeners.splice(i, 1);
    };
  }
  private _boundHandlers: { target: EventTarget; type: string; handler: EventListener }[] = [];
  private _frameId: number | null = null;
  private _onFrameCallbacks: (() => void)[] = [];

  // ═══ Post-processing (SSAO) ═══
  // Built lazily on first enable so the WebGL context and scene are
  // fully wired up. `_ssaoEnabled` is the single source of truth read
  // by the animate loop to choose composer.render() vs renderer.render().
  private _composer: EffectComposer | null = null;
  private _ssaoPass: SSAOPass | null = null;
  private _renderPass: RenderPass | null = null;
  // 2026-04-22: 기본값 true → false. SSAO는 screen-space sampling으로
  //   flat surface에 noise pattern(깃털·해치 모양)을 만드는 고유 artifact를
  //   가짐. CAD 작업에서는 깔끔한 solid face가 더 가치 있으므로 기본 off.
  //   View 메뉴 → "AO (주변광 차폐) 토글" 로 필요 시 활성화 가능.
  // 2026-04-24: 기본 true로 되돌림 — 캐비티/홀 입체감 살리기 위해.
  // 2026-04-25: 다시 false. 사용자 선호 — 평면 위 noise hatching 이
  //   거슬려 CAD 스타일의 깔끔한 flat shading 이 기본. 필요하면 View
  //   메뉴 > "AO (주변광 차폐) 토글" 로 즉시 켤 수 있음.
  private _ssaoEnabled: boolean = false;

  // ═══ Fur shell overlay (toggle-able; off by default) ═══
  private _fur: FurShell | null = null;
  private _furEnabled: boolean = false;

  // ═══ Projected shadow (SketchUp-style matrix projection) ═══
  private _projectedShadow: THREE.Mesh | null = null;
  // 2026-04-23: 기본 ON — "건축 그림자"(Projected Planar + MinEquation 균일
  // blending)를 default로 채택. 사용자는 메뉴 "보기 → 건축 그림자"로 토글.
  private _projectedShadowEnabled: boolean = true;
  private _sunTravel = new THREE.Vector3(-0.408, -0.816, -0.408);

  // ═══ Directional light (Phase 2 VSM) ═══
  // castShadow은 기본 false, setProjectedShadowEnabled(true) 시 켜짐.
  // VSM shadow는 Projected와 함께 "건축 모드" 일괄 관리.
  private _dirLight: THREE.DirectionalLight | null = null;
  /** Shadow Phase 2 — dynamic frustum fit (2026-04-26).
   *  When `true`, every frame the dir-light shadow camera is resized to
   *  cover only the geometry within the current view, dramatically
   *  improving texel-per-meter density when zoomed-in on detail. Static
   *  fallback (Phase 1) used otherwise. Texel-snap stabilises edges so
   *  panning doesn't shimmer the shadow boundary. */
  private _dynamicShadowFit: boolean = true;

  // ═══ Sketch plane visual (Tier 3A) ═══
  // Tinted translucent plane + border to show which plane sketching locks to.
  private _sketchPlaneMesh: THREE.Mesh | null = null;
  private _sketchPlaneBorder: THREE.LineSegments | null = null;

  // Camera control state
  private isOrbiting = false;
  private isPanning = false;
  private lastMouse = new THREE.Vector2();
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private spherical = new THREE.Spherical(60000, Math.PI / 4, Math.PI / 4);

  // View mode change callback
  private _onViewModeChange?: (mode: ViewMode) => void;
  private _onContextMenu?: (x: number, y: number) => void;

  // Stats
  private _verts = 0;
  private _edges = 0;
  private _faces = 0;

  // Raycaster
  readonly raycaster = new THREE.Raycaster();

  // Mesh material data
  private faceMap: Uint32Array = new Uint32Array(0);
  private indexBuffer: Uint32Array = new Uint32Array(0); // 삼각형→정점 매핑
  private frontMesh: THREE.Mesh | null = null;
  private colorAttribute: THREE.BufferAttribute | null = null;
  private colorsDirty = false;

  /**
   * ADR-038 P23.4 — analytic surface face id 집합. smoothNormals 가
   * 본 집합의 face 에 속한 vertex 는 Rust 의 정확한 evaluate 결과를
   * 덮어쓰지 않고 그대로 유지.
   */
  private analyticFaceIds: Set<number> = new Set();

  /**
   * ADR-039 P24.5 — 현재 hover target 과 복원용 색상 cache.
   *
   * Face hover 시 colorAttribute 를 in-place 로 tint, hover 해제 시 원본
   * 복원. Edge hover 는 별도 overlay (별도 PR) — 본 commit 은 face only.
   */
  private _hoveredOwner: { kind: 'edge' | 'face'; id: number } | null = null;
  /** faceId → vertex 별 원본 [r, g, b] 저장 (hover 해제 시 복원). */
  private _hoverFaceColorCache: Map<number, Float32Array> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;

    // ── Renderer (AixxiA style) ──
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      // 2026-04-23: 선형 z로 바꿨더니 박스 하단 경계(y=0 근처)에서 면/엣지/
      //   그림자/그리드가 z-fight → 톱니 계단 artifact 및 작은 블롭 발생.
      //   로그 z 버퍼는 camera 근처에 정밀도를 집중해 mm 단위 y=0 분리를
      //   깔끔하게 처리. CAD 와이어프레임 선명도 10% 개선보다 z-fight 제거가
      //   훨씬 중요하므로 true 유지.
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    // 2026-04-22: shadow 기본 off.
    // 2048×2048 shadow map 위 ±20000mm 영역 → texel 19.5mm.
    // 이 해상도가 ground에 떨어지면 shadow acne (수평 scanline) 발생.
    // CAD 작업에서는 그림자 자체가 불필요한 사실감이며 artifact 원인이므로
    // 기본 비활성. 설정 내부 구성은 유지되어 필요 시 enabled=true로 즉시 복구.
    // 2026-04-23 Phase 2: VSM 보조 레이어 재도입.
    // Projected Shadow가 flat receiver만 처리 → 곡면(cat body 등)은 공백.
    // VSM은 low-res + low-opacity로만 설정해 "은은한 환경 음영" 역할:
    //   · scanline artifact가 나와도 subtle하므로 체감 안 됨
    //   · Projected의 sharp silhouette이 primary visual 담당
    //   · VSM은 곡면 위 공간감만 추가
    // 2026-04-23: 기본 ON — 건축 그림자가 default. _projectedShadowEnabled와 동기화.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    // ACESFilmic gives PBR materials a natural photographic look under IBL;
    // the previous NoToneMapping clipped highlights whenever roughness was
    // low. Exposure 1.0 is the neutral baseline.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 2026-04-22: exposure 1.0 → 0.9. 하이라이트 차분히 내림.
    // 2026-04-23: 0.9 → 1.0 복구. 전체가 10% 어두워지는 부작용 → 검은 엣지
    // (0x0a0a14)가 ACES 톤매핑 후 짙은 남색으로 소프트 처리되면서 1px 선의
    // 체감 선명도 저하. 중성 1.0 기준으로 되돌려 엣지가 원래 의도한 순도로 렌더.
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // ── Scene ──
    this.scene = new THREE.Scene();
    this.updateBackground();

    // ── Camera (AixxiA style) ──
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      1,
      1000000000,
    );
    this.updateCameraFromSpherical();

    // ── Orthographic Camera (2D 뷰용) ──
    const aspect = container.clientWidth / container.clientHeight;
    this.orthoCamera = new THREE.OrthographicCamera(
      -this.orthoZoom * aspect, this.orthoZoom * aspect,
      this.orthoZoom, -this.orthoZoom,
      1, 1000,
    );

    // ── Lights ──
    // IBL now does the heavy lifting for ambient-ish fill, so the direct
    // lights can be dialed down and shaped more like studio key/back
    // lights rather than a "flood everything" rig.
    // 2026-04-23 Phase 2.4.2 — 0.6 → 0.3. 기존 값은 anti-sun 면까지 고르게
    //   밝혀서 태양 방향 shading이 약했다. 절반으로 내려 key light 대비
    //   ratio를 키우고 self-shading(form 정의) 체감 향상.
    const ambient = new THREE.AmbientLight(0x303030, 0.3);
    this.scene.add(ambient);

    // Key light — casts the main shadow.
    // DirectionalLight — 조명 + VSM shadow source (Phase 2).
    // VSM 설정은 "subtle 보조"용이므로 파라미터 보수적:
    //   mapSize 1024      — 낮은 해상도로도 VSM은 smooth
    //   frustum ±15000    — 건축 scene 규모
    //   radius 12         — 자연스러운 blur
    //   blurSamples 17    — moment blur 샘플
    //   bias 0            — VSM에 불필요
    // shadowMap.enabled 토글은 setProjectedShadowEnabled에 연동.
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(8000, 15000, 10000);
    dirLight.castShadow = true;
    const shadow = dirLight.shadow;
    // Phase 1 tune (2026-04-25):
    //   mapSize 1024→2048 : texel 29mm → 14.6mm (50% ↓). +12MB 메모리,
    //     shadow pass 4×. 건축 스케일에서 계단 artifact 대폭 감소.
    //   bias/normalBias   : acne 제거 (박스 측면 얇은 줄무늬).
    //   radius/blur 완화  : VSM band 완화 대신 slight crisper edge.
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left   = -15000;
    shadow.camera.right  =  15000;
    shadow.camera.top    =  15000;
    shadow.camera.bottom = -15000;
    shadow.camera.near   = 100;
    shadow.camera.far    = 60000;
    shadow.bias          = -0.0002;
    shadow.normalBias    = 1.5;
    shadow.radius        = 8;
    shadow.blurSamples   = 12;
    this._dirLight = dirLight;
    this.scene.add(dirLight);

    // Back/fill light — no shadow (performance; two shadow-casting lights
    // doubles depth-pass cost without much visual gain).
    // 2026-04-23 Phase 2.4.2 — 0.4 → 0.1. anti-sun 면을 너무 밝혀서 form
    //   shading을 흐릿하게 만들던 주범. 0.1로 내려 윤곽만 살짝 구분.
    const backLight = new THREE.DirectionalLight(0xffffff, 0.1);
    backLight.position.set(-6000, 4000, -8000);
    this.scene.add(backLight);

    // Subtle sky/ground tint on top of IBL — keeps the under-belly of
    // upside-facing surfaces from going fully dark when IBL contribution
    // is low (edge-on to the env map).
    // 2026-04-23 Phase 2.4.2 — 0.35 → 0.2. 전반적 fill 감소 동조.
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d59, 0.2);
    this.scene.add(hemiLight);

    // ── Image-Based Lighting (IBL) ─────────────────────────────────
    // RoomEnvironment is a procedural "studio photo booth" env generated
    // entirely in GPU at runtime, so no HDR asset download is required.
    // PMREMGenerator pre-filters it into a cube mipmap chain tuned for
    // each roughness level of MeshStandardMaterial — without this step
    // the material would only use the direct lights above and reflections
    // would look flat.
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const envScene = new RoomEnvironment();
      const envTex = pmrem.fromScene(envScene, 0.04).texture;
      this.scene.environment = envTex;
      // Keep scene.background on the flat color (updateBackground above)
      // so the photo-booth room doesn't appear behind the model — users
      // still want a clean CAD backdrop, just PBR-lit geometry.
      pmrem.dispose();
    } catch (e) {
      console.warn('[Viewport] IBL init failed; falling back to direct lights only:', e);
    }

    // ── Infinite Grid (AixxiA shader-based) ──
    this.infiniteGrid = this.createInfiniteGrid();
    this.scene.add(this.infiniteGrid);

    // ── Axes: X,Y 연장선 + 원점 방향 화살표 ──
    this.createAxisLines();
    this.createAxisArrows();

    // ── Mesh group (geometry from Rust engine) ──
    this.meshGroup = new THREE.Group();
    this.meshGroup.name = 'mesh-group';
    this.scene.add(this.meshGroup);

    // Events
    this.setupEvents();
  }

  /** X, Y 축 연장선 (양방향 ±500m, 바닥면 축) */
  private createAxisLines() {
    const length = 100000000; // 100km
    // CAD 규약: X=red(바닥), Y=green(바닥), Z=blue(위쪽)
    // Three.js 매핑: X→X, Y→Three.js Z, Z→Three.js Y
    const axisLines: [number[], THREE.ColorRepresentation][] = [
      [[0,0,0, length,0,0], 0xff4444],  // X = red (오른쪽, Three.js X)
      [[0,0,0, 0,0,-length], 0x44cc44],  // Y = green (깊이, Three.js -Z)
    ];
    for (const [pts, color] of axisLines) {
      const geo = new LineGeometry();
      geo.setPositions(pts);
      const mat = new LineMaterial({
        color: color as number,
        linewidth: 1,
        resolution: new THREE.Vector2(
          this.container.clientWidth,
          this.container.clientHeight,
        ),
        alphaToCoverage: true,  // MSAA 기반 smooth edge (점선 artifact 방지)
      });
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.axisLines.push(line);
    }
  }

  /** X, Y, Z 방향 화살표 + 라벨 (줌에 비례 스케일) */
  private createAxisArrows() {
    this.axisGroup = new THREE.Group();
    this.axisGroup.name = 'axis-arrows';

    // 기준 크기 (radius=10000일 때의 치수, 나중에 스케일로 조절)
    const arrowLen = 1;     // 정규화된 단위
    const headLen  = 0.25;
    const headW    = 0.1;

    // CAD 규약: X=red(오른쪽), Y=green(깊이), Z=blue(위쪽)
    // Three.js 매핑: X→(1,0,0), Y→(0,0,1), Z→(0,1,0)
    const axesDef: { dir: THREE.Vector3; color: number; label: string }[] = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xff4444, label: 'X' },
      { dir: new THREE.Vector3(0, 0, -1), color: 0x44cc44, label: 'Y' },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x4488ff, label: 'Z' },
    ];

    for (const { dir, color, label } of axesDef) {
      // 화살표
      const arrow = new THREE.ArrowHelper(
        dir,
        new THREE.Vector3(0, 0, 0),
        arrowLen,
        color,
        headLen,
        headW,
      );
      this.axisGroup.add(arrow);

      // 라벨 (sprite, sizeAttenuation: true → 3D 월드 크기)
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);

      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        depthTest: false,
        sizeAttenuation: true,
        opacity: 0.7,           // 70% 불투명
        transparent: true,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const labelPos = dir.clone().multiplyScalar(arrowLen + 0.28);
      sprite.position.copy(labelPos);
      sprite.scale.set(0.35, 0.35, 1);  // 70% 크기
      this.axisGroup.add(sprite);
    }

    this.scene.add(this.axisGroup);
    // 초기 스케일 적용
    this.updateAxisScale();
  }

  /** 카메라 거리에 비례하여 축 화살표 스케일 업데이트 */
  private updateAxisScale() {
    if (!this.axisGroup) return;
    const size = this._viewMode === '3d'
      ? this.spherical.radius * 0.08
      : this.orthoZoom * 0.08;
    this.axisGroup.scale.set(size, size, size);
  }

  /** 그리드 간격 업데이트 (단위 변경 시 호출) — 라인 기반이므로 재생성 */
  updateGridSpacing(_smallGrid: number, _bigGrid: number) {
    // 라인 기반 그리드: 현재는 고정 간격 사용
    // 향후 동적 간격이 필요하면 그리드 재생성 로직 추가
  }

  /** 라인 기반 무한 그리드 — 축 연장선과 동일 방식 (Y=0 완벽 고정) */
  /**
   * Shader-based infinite grid (2026-04-22 교체).
   *
   * 이전 구현은 ±100m 범위의 Line2 quad를 242×2 = 484개 생성했으나:
   *   - 기울어진 원근뷰에서 alpha blending 간섭 → 점선/얼룩 패턴
   *   - 먼 거리 line이 극단적 skew로 렌더 artifact
   *   - Line2 × 수백 개 유지비
   *
   * 신구현: 단일 PlaneGeometry + Fragment shader가 world 좌표로부터 그리드를
   * analytic 하게 계산 (표준 Blender/Godot/Unity 방식). derivative 기반
   * anti-aliasing으로 모든 거리·각도에서 완벽히 선명. 카메라 거리에 따라
   * 자연스러운 fade. GPU 1회 draw call.
   */
  private createInfiniteGrid(): THREE.Group {
    const gridGroup = new THREE.Group();
    gridGroup.userData.isGround = true;
    gridGroup.userData.noPick = true;

    // 매우 큰 plane — 카메라가 어디에 있든 화면에 꽉 차도록. z=0 기준
    // (xz plane). plane은 xy 면이라 rotation으로 눕힘.
    const size = 500000; // 500m × 500m
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uSmallSpacing: { value: 1000.0 },   // 1m
        uBigSpacing:   { value: 5000.0 },   // 5m
        uSmallColor:   { value: new THREE.Color(0xa8a8a8) },  // 2026-04-23: 0x88 → 0xa8 가늘게(밝게)
        uBigColor:     { value: new THREE.Color(0x808080) },  // 2026-04-23: 0x55 → 0x80 가늘게
        uSmallAlpha:   { value: 0.18 },  // 2026-04-23: 0.45 → 0.22 → 0.18 더 가늘게
        uBigAlpha:     { value: 0.25 },  // 2026-04-23: 0.75 → 0.42 → 0.30 → 0.25 더 가늘게
        // 2026-04-23: 작업공간 2배 확장 — 사용자 요청.
        uFadeNear:     { value: 40000.0 },  // 20m → 40m 부터 fade 시작
        uFadeFar:      { value: 160000.0 }, // 80m → 160m 에서 완전 사라짐
      },
      vertexShader: /* glsl */`
        // Plane-local xy 를 그대로 넘겨 shader에서 grid를 생성.
        // 이렇게 하면 plane group이 view-mode에 따라 어떻게 회전되든
        // 그리드 패턴은 항상 plane면 안에서 계산되므로 왜곡 없음.
        varying vec2 vPlanarPos;
        void main() {
          vPlanarPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vPlanarPos;
        uniform float uSmallSpacing;
        uniform float uBigSpacing;
        uniform vec3  uSmallColor;
        uniform vec3  uBigColor;
        uniform float uSmallAlpha;
        uniform float uBigAlpha;
        uniform float uFadeNear;
        uniform float uFadeFar;

        // screen-space analytic grid line — returns alpha [0, 1].
        // fwidth로 픽셀 단위 line 두께를 normalize해 원거리/근거리 모두
        // 일정 폭으로 보이게 함 (anti-aliased).
        float gridAlpha(vec2 p, float spacing) {
          vec2 coord = p / spacing;
          vec2 dcoord = fwidth(coord);
          vec2 lines = abs(fract(coord - 0.5) - 0.5) / dcoord;
          float line = min(lines.x, lines.y);
          return 1.0 - min(line, 1.0);
        }

        void main() {
          vec2 p = vPlanarPos;

          // Big grid on top of small — 대그리드 위치에서는 small contribution을
          // 억제해서 double-darken을 방지.
          float big = gridAlpha(p, uBigSpacing);
          float small = gridAlpha(p, uSmallSpacing) * (1.0 - big);

          // 거리 fade — 원거리 aliasing 억제.
          float dist = length(p);
          float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);

          float smallA = small * uSmallAlpha * fade;
          float bigA   = big   * uBigAlpha   * fade;

          // Over-compositing big over small (big이 우세)
          vec3 col = mix(uSmallColor, uBigColor, bigA / max(bigA + smallA, 1e-4));
          float alpha = bigA + smallA * (1.0 - bigA);

          if (alpha < 0.005) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;  // XZ plane (y=0)
    plane.position.y = 0;
    plane.renderOrder = -10;            // mesh 뒤에
    plane.frustumCulled = false;        // 항상 그리기
    plane.userData.noPick = true;
    gridGroup.add(plane);

    return gridGroup;
  }

  private setupEvents() {
    const canvas = this.renderer.domElement;

    // Resize
    // LineMaterial references cache (avoid scene.traverse on every resize)
    const lineMaterials: LineMaterial[] = [];
    this.scene.traverse((obj) => {
      if (obj instanceof Line2 && obj.material instanceof LineMaterial) {
        lineMaterials.push(obj.material);
      }
    });

    this._resizeObserver = new ResizeObserver(() => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      const aspect = w / h;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      // Ortho camera resize
      this.orthoCamera.left = -this.orthoZoom * aspect;
      this.orthoCamera.right = this.orthoZoom * aspect;
      this.orthoCamera.top = this.orthoZoom;
      this.orthoCamera.bottom = -this.orthoZoom;
      this.orthoCamera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      // Post-processing composer needs matching size.
      if (this._composer) this._composer.setSize(w, h);
      if (this._ssaoPass) this._ssaoPass.setSize(w, h);
      // Update LineMaterial resolution for thick axes (cached, no traverse)
      for (const mat of lineMaterials) {
        mat.resolution.set(w, h);
      }
      // Mesh-edge LineMaterials도 resolution 업데이트 — 굵기가 픽셀 기준
      // 정확히 유지되려면 DPR 반영 resolution이 필수.
      for (const mat of this._meshEdgeMaterials) {
        mat.resolution.set(w, h);
      }
      // 외부 구독자 (SelectionManager 등) 에 resize 알림.
      for (const cb of this._resizeListeners) {
        try { cb(w, h); } catch { /* swallow */ }
      }
    });
    this._resizeObserver.observe(this.container);

    // ═══ CAD 스타일 마우스 조작 ═══
    // 왼쪽: 선택/도구 (ToolManager에서 처리)
    // 휠 클릭: 회전(orbit) / 2D에서는 pan
    // 휠 스크롤: 줌 인/아웃
    // 오른쪽: 길게 → 이동(pan), 짧게 → 컨텍스트 메뉴

    let rightDownTime = 0;
    let rightDownPos = { x: 0, y: 0 };
    const RIGHT_CLICK_THRESHOLD = 300;  // ms
    const RIGHT_MOVE_THRESHOLD = 5;     // px

    // Helper to track event listeners for cleanup
    const track = (target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, handler, options);
      this._boundHandlers.push({ target, type, handler });
    };

    // ── Mouse Down ──
    track(canvas, 'mousedown', ((e: MouseEvent) => {
      // 휠(중간) 버튼: 회전 (3D) / 팬 (2D)
      if (e.button === 1) {
        if (this._viewMode !== '3d') {
          this.isPanning = true;
        } else {
          this.isOrbiting = true;
        }
        this.lastMouse.set(e.clientX, e.clientY);
        e.preventDefault();
      }
      // 오른쪽 버튼: 길게 누르면 이동(pan)
      else if (e.button === 2) {
        rightDownTime = Date.now();
        rightDownPos = { x: e.clientX, y: e.clientY };
        this.lastMouse.set(e.clientX, e.clientY);
        e.preventDefault();
      }
    }) as EventListener);

    // ── Mouse Move ──
    track(window, 'mousemove', ((e: MouseEvent) => {
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse.set(e.clientX, e.clientY);

      if (this.isOrbiting) {
        this.spherical.theta -= dx * 0.01;
        this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01,
          this.spherical.phi - dy * 0.01));
        this.updateCameraFromSpherical();
      } else if (this.isPanning) {
        if (this._viewMode !== '3d') {
          this.panOrtho(dx, dy);
        } else {
          const panSpeed = 0.005 * this.spherical.radius;
          _panRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
          _panUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
          this.orbitTarget.addScaledVector(_panRight, -dx * panSpeed);
          this.orbitTarget.addScaledVector(_panUp, dy * panSpeed);
          this.updateCameraFromSpherical();
        }
      }

      // 오른쪽 버튼 드래그 → pan 전환
      if (e.buttons & 2) {
        const movedDist = Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y);
        if (movedDist > RIGHT_MOVE_THRESHOLD && !this.isPanning && !this.isOrbiting) {
          this.isPanning = true;
        }
      }
    }) as EventListener);

    // ── Mouse Up ──
    track(window, 'mouseup', ((e: MouseEvent) => {
      // 오른쪽 버튼 놓기: 짧게 눌렀으면 컨텍스트 메뉴
      if (e.button === 2) {
        const elapsed = Date.now() - rightDownTime;
        const movedDist = Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y);
        if (elapsed < RIGHT_CLICK_THRESHOLD && movedDist < RIGHT_MOVE_THRESHOLD) {
          // 짧게 클릭 → 컨텍스트 메뉴 표시
          this.showContextMenu(e.clientX, e.clientY);
        }
      }
      this.isOrbiting = false;
      this.isPanning = false;
    }) as EventListener);

    // ── Wheel: 줌 (SketchUp 스타일 zoom-to-cursor) ──
    track(canvas, 'wheel', ((e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;

      if (this._viewMode !== '3d') {
        // 2D ortho: 기존 동작 유지 (단일 zoom factor)
        this.orthoZoom = Math.max(10, Math.min(200000, this.orthoZoom * factor));
        this.updateOrthoCamera();
        return;
      }

      // 3D: 커서 아래 3D 점을 찾아 그쪽으로 zoom. 없으면 기본 orbit 중심 zoom.
      const pivot = this._cursorWorldPoint(e.clientX, e.clientY);
      const newRadius = Math.max(100, Math.min(500000000,
        this.spherical.radius * factor));

      if (pivot) {
        // orbit target 을 pivot 쪽으로 (1 - factor) 만큼 이동.
        //   zoom in (factor<1): target 이 pivot 에 가까워짐
        //   zoom out (factor>1): target 이 pivot 에서 멀어짐 (cursor 기준 반대편 확대)
        const t = 1 - factor;
        this.orbitTarget.addScaledVector(
          _zoomTmp.subVectors(pivot, this.orbitTarget),
          t,
        );
      }
      this.spherical.radius = newRadius;
      this.updateCameraFromSpherical();
    }) as EventListener, { passive: false });

    // 오른쪽 클릭 기본 메뉴 차단 (document 전체)
    track(document, 'contextmenu', (e) => e.preventDefault());
  }

  /** 오른쪽 클릭 컨텍스트 메뉴 콜백 등록 */
  onContextMenu(cb: (x: number, y: number) => void) {
    this._onContextMenu = cb;
  }

  /** 컨텍스트 메뉴 표시 */
  private showContextMenu(x: number, y: number) {
    this._onContextMenu?.(x, y);
  }

  /** Cleanup all resources — call when Viewport is destroyed */
  dispose(): void {
    // Stop render loop
    this.stop();
    // Disconnect ResizeObserver
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    // Remove tracked event listeners
    for (const { target, type, handler } of this._boundHandlers) {
      target.removeEventListener(type, handler);
    }
    this._boundHandlers.length = 0;
    // Dispose renderer
    this.renderer.dispose();
    // Dispose scene objects
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      } else if (obj instanceof THREE.LineSegments || obj instanceof Line2) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
  }

  private updateCameraFromSpherical() {
    const pos = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(pos.add(this.orbitTarget));
    this.camera.lookAt(this.orbitTarget);
    this.updateAxisScale();
  }

  /** Get the active camera (perspective or ortho) */
  get activeCamera(): THREE.Camera {
    return this._viewMode === '3d' ? this.camera : this.orthoCamera;
  }

  /** Get current view mode */
  get viewMode(): ViewMode {
    return this._viewMode;
  }

  /** Register view mode change callback */
  onViewModeChange(cb: (mode: ViewMode) => void) {
    this._onViewModeChange = cb;
  }

  /** Switch view mode */
  setViewMode(mode: ViewMode) {
    this._viewMode = mode;

    if (mode === '3d') {
      // 3D perspective 복원 — 그리드+축을 XZ 바닥면(Y=0)으로 리셋
      this.infiniteGrid.rotation.set(0, 0, 0);
      this.infiniteGrid.position.set(0, 0, 0);
      for (const al of this.axisLines) {
        al.rotation.set(0, 0, 0);
        al.position.set(0, 0, 0);
      }
      this.updateCameraFromSpherical();
    } else {
      // 2D 직교 뷰 설정
      // dist = 3D 카메라와 동일한 거리 → near/far도 비례 스케일
      const dist = this.spherical.radius;
      const cam = this.orthoCamera;

      cam.near = Math.max(0.1, dist * 0.001);
      cam.far = Math.max(10000, dist * 10);

      // 3D perspective에서 보이는 화면 높이와 1:1 대응
      // visibleHeight = 2 * tan(FOV/2) * dist → orthoZoom = visibleHeight / 2
      const fovRad = (this.camera.fov * Math.PI) / 180;
      this.orthoZoom = this.spherical.radius * Math.tan(fovRad / 2);

      switch (mode) {
        case 'top':    // Numpad 7 — 위에서 내려다봄
          cam.position.set(this.orbitTarget.x, this.orbitTarget.y + dist, this.orbitTarget.z);
          cam.up.set(0, 0, -1);
          break;
        case 'bottom': // Ctrl+Numpad 7 — 아래에서 올려다봄
          cam.position.set(this.orbitTarget.x, this.orbitTarget.y - dist, this.orbitTarget.z);
          cam.up.set(0, 0, 1);
          break;
        case 'front':  // Numpad 1 — 정면 (X축이 오른쪽)
          cam.position.set(this.orbitTarget.x, this.orbitTarget.y, this.orbitTarget.z + dist);
          cam.up.set(0, 1, 0);
          break;
        case 'back':   // Ctrl+Numpad 1 — 후면
          cam.position.set(this.orbitTarget.x, this.orbitTarget.y, this.orbitTarget.z - dist);
          cam.up.set(0, 1, 0);
          break;
        case 'right':  // Numpad 3 — 우측면
          cam.position.set(this.orbitTarget.x + dist, this.orbitTarget.y, this.orbitTarget.z);
          cam.up.set(0, 1, 0);
          break;
        case 'left':   // Ctrl+Numpad 3 — 좌측면
          cam.position.set(this.orbitTarget.x - dist, this.orbitTarget.y, this.orbitTarget.z);
          cam.up.set(0, 1, 0);
          break;
      }

      cam.lookAt(this.orbitTarget);

      // 그리드+축 연장선을 현재 뷰의 작업 평면에 맞게 회전
      // 기본 그리드: XZ 평면 (Y=0) — top/bottom에서 그대로 보임
      this.infiniteGrid.rotation.set(0, 0, 0);
      this.infiniteGrid.position.set(0, 0, 0);
      const axisRot = new THREE.Euler(0, 0, 0);
      switch (mode) {
        case 'front':
        case 'back':
          // XZ → XY 평면 (Z=0): X축 기준 -90° 회전
          this.infiniteGrid.rotation.x = -Math.PI / 2;
          axisRot.x = -Math.PI / 2;
          break;
        case 'right':
        case 'left':
          // XZ → YZ 평면 (X=0): Z축 기준 90° 회전
          this.infiniteGrid.rotation.z = Math.PI / 2;
          axisRot.z = Math.PI / 2;
          break;
        // top/bottom: 기본 XZ 평면 그대로
      }
      for (const al of this.axisLines) {
        al.rotation.copy(axisRot);
      }

      this.updateOrthoCamera();
    }

    this._onViewModeChange?.(mode);
  }

  /** Update ortho camera frustum from orthoZoom */
  private updateOrthoCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.orthoCamera.left = -this.orthoZoom * aspect;
    this.orthoCamera.right = this.orthoZoom * aspect;
    this.orthoCamera.top = this.orthoZoom;
    this.orthoCamera.bottom = -this.orthoZoom;
    this.orthoCamera.updateProjectionMatrix();
    this.updateAxisScale();
  }

  /** Pan in 2D ortho mode */
  private panOrtho(dx: number, dy: number) {
    const panSpeed = this.orthoZoom * 2 / this.container.clientHeight;
    const cam = this.orthoCamera;

    // 카메라 로컬 right/up 벡터로 이동
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    this.orbitTarget.addScaledVector(right, -dx * panSpeed);
    this.orbitTarget.addScaledVector(up, dy * panSpeed);

    // 카메라 위치도 같이 이동
    cam.position.addScaledVector(right, -dx * panSpeed);
    cam.position.addScaledVector(up, dy * panSpeed);
    cam.lookAt(this.orbitTarget);
    cam.updateProjectionMatrix();
  }

  /**
   * Update mesh geometry and edge wireframe.
   * @param faceMap Optional triangle → faceId mapping for per-face material coloring
   */
  updateMesh(
    positions: Float32Array,
    normals: Float32Array,
    indices: Uint32Array,
    edgeLines?: Float32Array,
    faceMap?: Uint32Array,
    centerLines?: Float32Array | null,
    volumeFlags?: Uint8Array | null,
    /** ADR-018 — true 일 때만 volumeFlags 의 wall 비트가 두 톤 렌더에 반영
     *  된다. open mesh (false) 는 volumeFlags 무시하고 전부 sheet (양면 동일).
     *  is_face_in_volume 이 planar overlap face 도 wall 로 분류하는 false-
     *  positive 를 차단. */
    isClosedSolid?: boolean,
    /** ADR-038 P23.4 — analytic surface 를 가진 face id 집합. smoothNormals
     *  가 이 face 의 vertex 는 덮어쓰지 않음 (Rust 정확 evaluate 유지). */
    analyticFaceIds?: Set<number>,
  ) {
    // P23.4: store for smoothNormals
    this.analyticFaceIds = analyticFaceIds ?? new Set();
    // Sprint 4 §3 — updateMesh 내부 분해 측정.
    //   syncMesh.fullUpdate(16ms budget) 의 어느 phase 가 dominator 인지
    //   격리. record helper — 외부 telemetry 모듈 dep 없이 동작.
    const recordStep = (key: string, ms: number): void => {
      const w = window as unknown as { __AXIA_TELEMETRY_RECORD?: (key: string, ms: number) => void };
      w.__AXIA_TELEMETRY_RECORD?.(key, ms);
    };

    // ── 1) 기존 geometry + material 완전 제거 ──
    const tDispose0 = performance.now();
    while (this.meshGroup.children.length > 0) {
      const child = this.meshGroup.children[0];
      this.meshGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        // Phase C1: dispose BVH before the geometry itself
        const geo = child.geometry as THREE.BufferGeometry & {
          disposeBoundsTree?: () => void;
        };
        if (typeof geo.disposeBoundsTree === 'function') {
          try { geo.disposeBoundsTree(); } catch { /* ignore */ }
        }
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      } else if (child instanceof THREE.LineSegments || child instanceof LineSegments2) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    }
    // 이전 frame의 mesh-edge LineMaterial 캐시 리셋 (dispose는 위에서 이미 함)
    this._meshEdgeMaterials.length = 0;
    recordStep('updateMesh.dispose', performance.now() - tDispose0);

    // ── 2) Face geometry (면이 있을 때만) ──
    if (positions.length > 0) {
      const tGeom0 = performance.now();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array(positions), 3));
      geometry.setAttribute('normal',
        new THREE.BufferAttribute(new Float32Array(normals), 3));
      geometry.setIndex(
        new THREE.BufferAttribute(new Uint32Array(indices), 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      recordStep('updateMesh.geometry', performance.now() - tGeom0);

      // ── Smooth normals: 인접 면 각도 < threshold 면 법선 보간 (원통 등 곡면 부드럽게).
      // ⚡ 성능 최적화 (2026-04-27): smoothNormals 는 O(V·T) 로 드로잉 시
      //   가장 큰 단일 비용. 화면에는 WASM 이 준 법선으로 즉시 표시하고
      //   부드러운 노멀은 다음 프레임에 적용 → 사용자 체감 반응 속도 ↑.
      //   `_pendingSmoothNormals` 가 RAF 스케줄을 들고 있으므로 새 mesh
      //   가 도착하면 이전 RAF 는 자동 취소됨.
      // ✱ ADR-038 P23.3 (2026-05-01): hardcode 30° 제거 → Rust SSOT mirror
      //   (`WasmBridge.EDGE_VISIBILITY_ANGLE_DEG = 20.1°`). 두 layer 의
      //   hard/soft edge 판정이 일치하도록 강제. drift 차단.
      this._scheduleSmoothNormals(geometry, WasmBridge.EDGE_VISIBILITY_ANGLE_DEG);

      // ── Store faceMap, indexBuffer and create per-face color attribute ──
      this.indexBuffer = new Uint32Array(indices);
      if (faceMap) {
        this.faceMap = faceMap;
        this.createColorAttribute(geometry, faceMap, positions.length);
      } else {
        this.faceMap = new Uint32Array(0);
      }

      // ── 3) Two-tone rendering (SketchUp style) ──
      const useVertexColors = this.colorAttribute !== null;

      // ── 3a) Texture lookup — Phase E v1: single-texture per mesh ──
      // Scan assigned materials for the first textured one; apply its texture
      // + UV projection to the whole front mesh. Faces without texture still
      // render via vertex color (white * texture ≈ texture on default color).
      // Multi-texture via geometry groups is future work (v2).
      const firstTex = this.findFirstTexturedMaterial(faceMap);
      const firstAux = this.findFirstAuxMaterial(faceMap);
      // UV must be present if EITHER base color OR aux maps are textured.
      if (firstTex || firstAux) {
        // Use base-color projection if available, otherwise fall back to
        // a default planar projection so aux maps still get UVs.
        const projParams: UVProjectionParams = firstTex
          ? { mode: firstTex.projection, scale: firstTex.scale, rotation: firstTex.rotation ?? 0 }
          : { mode: 'planar', scale: 0.001, rotation: 0 };
        const uvs = computeUVsFromBuffers(
          geometry.getAttribute('position').array as Float32Array,
          geometry.getAttribute('normal').array as Float32Array,
          projParams,
        );
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        if (firstTex) this.applyTextureAsync(firstTex);
        if (firstAux) this.applyAuxTexturesAsync(firstAux);
      }

      const frontMat = new THREE.MeshStandardMaterial({
        // vertexColors가 활성이면 white(곱셈 중립) 사용 → vertex color가 그대로 표시됨
        color: useVertexColors ? 0xffffff : this._frontColor,
        side: THREE.FrontSide,
        // Balanced PBR defaults for a CAD preview.
        // 2026-04-22: roughness 0.5 → 0.65. 0.5는 IBL 반사가 강해 매끈한
        // 면이 하얗게 포화. 0.65는 확산 우세로 색 보존 + 경계 대비 확보.
        // metalness 0은 비금속 surface 가정 유지.
        roughness: 0.65,
        metalness: 0.0,
        polygonOffset: true,
        // 2026-04-23: logBuffer on 복원 → factor 0.5도 원복(1). logBuffer의 비
        //   선형 z에서 0.5는 너무 작아 일부 각도에서 엣지가 면에 먹힐 수 있음.
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        vertexColors: useVertexColors,
        // 텍스처가 이미 캐시돼 있으면 즉시 적용, 아니면 applyTextureAsync가 나중에 세팅
        map: firstTex ? getTextureCache().get(firstTex.dataUrl) : null,
      });
      // Phase C1: build BVH on the shared geometry so intersectObjects is O(log N).
      //
      // ✱ Critical (2026-04-19): `indirect: true`를 주어야 index buffer를 permute하지
      // 않음. 기본값(reorder)이면 geometry.index.array 순서가 뒤섞여서 faceMap(tri→faceId)
      // 매핑이 어긋남 → 레이캐스트 hit.faceIndex가 다른 삼각형의 faceId를 반환 → 박스
      // 클릭했는데 스피어가 선택되는 현상. indirect 모드는 별도 permutation 테이블을
      // 유지해 원본 index 순서를 보존한다.
      const geoWithBvh = geometry as THREE.BufferGeometry & {
        computeBoundsTree?: (opts?: { indirect?: boolean }) => void;
      };
      if (typeof geoWithBvh.computeBoundsTree === 'function' && indices.length > 0) {
        try { geoWithBvh.computeBoundsTree({ indirect: true }); }
        catch (e) { console.warn('[Viewport] BVH build failed:', e); }
      }

      const frontMesh = new THREE.Mesh(geometry, frontMat);
      frontMesh.name = 'front-mesh';
      // ADR-007 Rev 2 Shadow Phase 3 (B): Sheet 면은 양면 동등 평면이라
      //   VSM 자체 그림자가 의미 없는 데다 flat surface 위에 noisy band
      //   를 뿌려 미관을 해친다. 그래서 frontMesh 의 castShadow 는 OFF
      //   로 두고, 별도의 invisible "wall-only shadow caster" 가 wall
      //   삼각형만 그림자 맵에 기여하도록 분리.
      frontMesh.castShadow = false;
      frontMesh.receiveShadow = true;
      this.meshGroup.add(frontMesh);

      // ── Store reference for color updates ──
      this.frontMesh = frontMesh;

      // Phase 3 — wall-only invisible shadow caster (built later in
      //   the same flow once volumeFlags has been used to split
      //   indices). Falls back to whole-geometry caster when
      //   volumeFlags is unavailable (legacy / non-Rust path).

      // If fur was enabled before this mesh rebuild, re-attach so the
      // shell overlay tracks the new geometry automatically.
      this._refreshFur();

      // ADR-018 — Uniform Surface Render Policy:
      //   Wall (closed-volume member): two-tone (front=front-color, back=cyan)
      //   Sheet (standalone planar)  : 양면 동등 (back 도 front-color)
      //
      //   결정 driver: volumeFlags[fid] === 1 → wall, else → sheet.
      //   ADR-018 의 핵심 원칙: 사용자 작업 중 의도치 않은 lavender (BackSide)
      //   노출 차단. open mesh 는 항상 양면 white. closed solid 만 cavity
      //   가시화 위해 두 톤 유지.
      //
      //   Phase 3 의 "Show face orientation (debug)" 토글 활성 시:
      //   _showFaceOrientation = true → legacy 모드 (모든 face 양면 차이)
      //
      //   구현: backMesh 두 개 — wall 전용 (cyan) + sheet 전용 (front color).
      //   각각 cloned geometry 가 wall 또는 sheet 삼각형 indices 만 포함.
      //   position/normal 은 원본과 공유. frontMesh 는 모든 삼각형 단일 색.
      //
      // Single-sided (CAD) 모드: back-mesh 통째 skip → wall-only shadow caster
      //   도 만들어지지 않음. frontMesh.castShadow = true 로 fallback.
      if (this._singleSidedRender) {
        frontMesh.castShadow = true;
      }
      if (!this._singleSidedRender) {
        const wallIndices: number[] = [];
        const sheetIndices: number[] = [];
        const idxArr = indices as Uint32Array;
        const debugOrientation = this._showFaceOrientation === true;
        // ADR-018: open mesh (isClosedSolid=false) 면 모든 face 를 sheet 로
        //   강제. volumeFlags 의 wall 비트를 무시한다. (is_face_in_volume 이
        //   planar overlap face 를 false-positive 로 wall 분류하는 케이스 차단.)
        const useVolumeFlags = (isClosedSolid !== false) && !debugOrientation;
        if (faceMap && volumeFlags && useVolumeFlags) {
          for (let ti = 0; ti < faceMap.length; ti++) {
            const fid = faceMap[ti];
            const isWall = (fid < volumeFlags.length) && volumeFlags[fid] === 1;
            const i0 = idxArr[ti * 3], i1 = idxArr[ti * 3 + 1], i2 = idxArr[ti * 3 + 2];
            if (isWall) wallIndices.push(i0, i1, i2);
            else sheetIndices.push(i0, i1, i2);
          }
        } else {
          // ADR-018: 다음 케이스는 모두 동일 처리 — 모든 삼각형을 sheet 로
          //   (또는 debug toggle 활성 시 wall 로):
          //     1) volumeFlags / faceMap 미가용
          //     2) isClosedSolid=false (open mesh) — useVolumeFlags=false
          //     3) debug toggle ON
          if (debugOrientation) {
            for (let i = 0; i < idxArr.length; i++) wallIndices.push(idxArr[i]);
          } else {
            for (let i = 0; i < idxArr.length; i++) sheetIndices.push(idxArr[i]);
          }
        }

        const cyanMat = new THREE.MeshBasicMaterial({
          color: useVertexColors ? 0xb0b0c8 : 0x9898b4,
          side: THREE.BackSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
          vertexColors: useVertexColors,
        });
        if (wallIndices.length > 0) {
          const wallBackGeo = new THREE.BufferGeometry();
          wallBackGeo.setAttribute('position', geometry.getAttribute('position'));
          wallBackGeo.setAttribute('normal', geometry.getAttribute('normal'));
          if (useVertexColors && geometry.getAttribute('color')) {
            wallBackGeo.setAttribute('color', geometry.getAttribute('color'));
          }
          wallBackGeo.setIndex(wallIndices);
          const wallBackMesh = new THREE.Mesh(wallBackGeo, cyanMat);
          wallBackMesh.name = 'back-mesh-wall';
          this.meshGroup.add(wallBackMesh);

          // Phase 3 — invisible wall-only shadow caster.
          //   Geometry shares attributes with frontMesh (no extra GPU
          //   memory beyond the index buffer). Casts shadows but never
          //   rendered itself, so we use a cheap depth material via
          //   visible=false. Sheets are excluded from this caster, so
          //   they don't pollute VSM with noisy band artefacts on flat
          //   coplanar faces.
          const shadowGeo = new THREE.BufferGeometry();
          shadowGeo.setAttribute('position', geometry.getAttribute('position'));
          shadowGeo.setAttribute('normal', geometry.getAttribute('normal'));
          shadowGeo.setIndex(wallIndices);
          const shadowMat = new THREE.MeshBasicMaterial({ visible: false });
          const wallShadowCaster = new THREE.Mesh(shadowGeo, shadowMat);
          wallShadowCaster.name = 'wall-shadow-caster';
          wallShadowCaster.castShadow = true;
          wallShadowCaster.receiveShadow = false;
          // ✱ 2026-04-27 — pick() 가 invisible mesh 를 제외하지 않는
          //   raycaster 동작 때문에 같은 wall geometry 가 frontMesh 와
          //   동일 distance hit → 사용자가 클릭한 면이 비결정적으로 선택됨.
          //   noPick 협약 + 이름 기반 제외 둘 다 적용.
          wallShadowCaster.userData.noPick = true;
          this.meshGroup.add(wallShadowCaster);
        }

        if (sheetIndices.length > 0) {
          // Sheet back: same material as front, just BackSide so it
          //   renders when camera is on the opposite side. Cloning the
          //   front material keeps everything in sync (texture, color,
          //   roughness etc.) without re-instantiating logic.
          const sheetBackMat = frontMat.clone();
          (sheetBackMat as THREE.MeshStandardMaterial).side = THREE.BackSide;
          const sheetBackGeo = new THREE.BufferGeometry();
          sheetBackGeo.setAttribute('position', geometry.getAttribute('position'));
          sheetBackGeo.setAttribute('normal', geometry.getAttribute('normal'));
          if (useVertexColors && geometry.getAttribute('color')) {
            sheetBackGeo.setAttribute('color', geometry.getAttribute('color'));
          }
          sheetBackGeo.setIndex(sheetIndices);
          const sheetBackMesh = new THREE.Mesh(sheetBackGeo, sheetBackMat);
          sheetBackMesh.name = 'back-mesh-sheet';
          this.meshGroup.add(sheetBackMesh);
        }
      }

      // 엣지 렌더링: DCEL edge lines 우선, 없으면 EdgesGeometry fallback.
      //
      // 2026-04-24 — Line2 + LineMaterial 복귀. WebGL LineBasicMaterial 은
      //   linewidth 가 1px 로 고정되어 oblique view 에서 aliasing 으로
      //   점선처럼 보이는 사용자 보고 (user.png). Line2 는 실제 quad 를
      //   그리므로 모든 각도에서 연속된 선으로 렌더. 과거 artifact 재발
      //   방지: polygonOffset 로 face 보다 약간 앞으로, depthWrite 유지,
      //   transparent:false, worldUnits:false (픽셀 굵기 고정).
      const tEdges0 = performance.now();
      if (edgeLines && edgeLines.length > 0) {
        const geo = new LineSegmentsGeometry();
        geo.setPositions(edgeLines);
        const mat = this._makeMeshEdgeMaterial();
        const obj = new LineSegments2(geo, mat);
        obj.name = 'dcel-edges';
        obj.visible = this._edgeVisible;
        obj.renderOrder = 1;
        this._meshEdgeMaterials.push(mat);
        this.meshGroup.add(obj);
      } else {
        const edgesGeo = new THREE.EdgesGeometry(geometry, 30);
        const positions = edgesGeo.getAttribute('position');
        const arr = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          arr[i*3] = positions.getX(i);
          arr[i*3+1] = positions.getY(i);
          arr[i*3+2] = positions.getZ(i);
        }
        const geo = new LineSegmentsGeometry();
        geo.setPositions(arr);
        const mat = this._makeMeshEdgeMaterial();
        const obj = new LineSegments2(geo, mat);
        obj.name = 'dcel-edges-fallback';
        obj.visible = this._edgeVisible;
        obj.renderOrder = 1;
        this._meshEdgeMaterials.push(mat);
        this.meshGroup.add(obj);
        edgesGeo.dispose();
      }
      recordStep('updateMesh.edges', performance.now() - tEdges0);
    }

    // ── 4) Standalone edge lines (면 없이 Line 도구로 그린 선) ──
    if (positions.length === 0 && edgeLines && edgeLines.length > 0) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(edgeLines);
      const mat = this._makeMeshEdgeMaterial();
      const obj = new LineSegments2(geo, mat);
      obj.name = 'standalone-edges';
      obj.visible = this._edgeVisible;
      obj.renderOrder = 1;
      this._meshEdgeMaterials.push(mat);
      this.meshGroup.add(obj);
    }

    // ── 5) Centerlines (중심선/참조 축) — 점선 + 옅은 색 + 얇게 ──
    if (centerLines && centerLines.length > 0) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(centerLines);
      const mat = this._makeCenterlineMaterial();
      const obj = new LineSegments2(geo, mat);
      obj.name = 'centerlines';
      obj.visible = this._edgeVisible;
      obj.computeLineDistances();  // essential for dashed rendering
      this.meshGroup.add(obj);
    }
  }

  /** LineMaterial for DCEL mesh edges. Solid, polygon-offset'd so it
   *  renders slightly in front of the shaded faces to avoid z-fight
   *  while still occluding correctly behind the geometry. */
  private _makeMeshEdgeMaterial(): LineMaterial {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const mat = new LineMaterial({
      color: this._edgeColor,
      linewidth: Math.max(1, this._edgeWidth),
      resolution: new THREE.Vector2(w, h),
      worldUnits: false,
      dashed: false,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      // polygonOffset negative values push the primitive toward the camera
      //   in depth-buffer units — keeps edges on top of the coincident face
      //   without ghost-edge artifacts on the opposite side. Values below
      //   are ramped up from -1 so coincident faces never eat into the
      //   edge line at shallow viewing angles (CAD top/side views).
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    return mat;
  }

  /** LineMaterial tuned for centerlines: dashed, dimmer color, thinner.
   *  Same resize pool as mesh edges so DPR/resize updates together. */
  private _makeCenterlineMaterial(): LineMaterial {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const mat = new LineMaterial({
      color: 0x808090,                  // neutral grey-blue, dimmer than main edges
      linewidth: Math.max(1, this._edgeWidth * 0.7),  // thinner than geometry edges
      dashed: true,
      dashSize: 120,                    // world units (mm) — visible at architectural scale
      gapSize: 60,
      dashScale: 1,
      resolution: new THREE.Vector2(w, h),
      worldUnits: false,                // pixel-space width; dash sizes still world
      depthTest: true,
      transparent: true,
      opacity: 0.75,
    });
    this._meshEdgeMaterials.push(mat);  // reuse resize pool
    return mat;
  }

  /** @deprecated mesh edges는 단순한 LineBasicMaterial로 되돌림 (2026-04-22).
   *  Line2 + LineMaterial 조합은 굵기 조절 가능하지만 MSAA/z-fighting/dithering
   *  artifact가 쌓여 "두 줄처럼 보이는" 현상을 유발. 1px LineBasicMaterial이
   *  CAD에서 훨씬 깔끔. 이 함수는 centerline(dashed)만 여전히 필요하면 유지. */
  // private _makeEdgeLineMaterial 제거됨 — LineBasicMaterial을 인라인 사용.

  /**
   * Update edge wireframe without full mesh rebuild.
   * Used in delta path when only vertex positions changed (translate/rotate/scale).
   * Replaces only the LineSegments child of meshGroup with new EdgesGeometry.
   */
  updateEdgeLines(edgeLines: Float32Array | null): void {
    if (!this.frontMesh || !edgeLines || edgeLines.length === 0) return;

    // Remove existing edge wireframe from meshGroup (both legacy + Line2)
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.meshGroup.children) {
      if (child instanceof THREE.LineSegments || child instanceof LineSegments2) {
        toRemove.push(child);
      }
    }
    for (const obj of toRemove) {
      this.meshGroup.remove(obj);
      (obj as unknown as { geometry: { dispose: () => void } }).geometry.dispose();
      const mat = (obj as unknown as { material: THREE.Material }).material;
      if (mat instanceof THREE.Material) mat.dispose();
    }
    this._meshEdgeMaterials.length = 0;

    // Rebuild via LineBasicMaterial (단순, 안정)
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(edgeLines, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: this._edgeColor });
    const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
    lineSegs.visible = this._edgeVisible;
    this.meshGroup.add(lineSegs);
  }

  /**
   * Apply a position-only delta to existing geometry (Phase 1 Optimization).
   * Only valid when delta.topologyChanged === false.
   * Patches vertex positions/normals in-place — much faster than full rebuild.
   *
   * @returns true if successfully applied, false if full rebuild needed
   */
  applyDelta(delta: DeltaBuffers): boolean {
    try {
      if (delta.topologyChanged) return false;

      if (!this.frontMesh || !this.frontMesh.geometry) {
        return false;
      }

      const geometry = this.frontMesh.geometry;

      // Use WasmBridge static helper to patch positions/normals
      const success = WasmBridge.applyDeltaToGeometry(geometry, delta);
      if (!success) return false;

      // Update bounding volumes for raycasting/culling
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      // ✱ Bug fix (2026-04-19): BVH bounds도 함께 갱신해야 함.
      // three-mesh-bvh는 위치 변경 후 refit()으로 bounds를 업데이트. refit이 없으면
      // raycast가 이전 위치 기반 BVH를 사용 → "옮긴 후 예전 자리에 있는 것처럼" pick됨.
      const geoBvh = geometry as THREE.BufferGeometry & {
        boundsTree?: { refit?: () => void };
      };
      if (geoBvh.boundsTree?.refit) {
        try { geoBvh.boundsTree.refit(); }
        catch (e) { console.warn('[Viewport] BVH refit failed, rebuilding:', e); }
      }

      // Note: smoothNormals is NOT re-run here because translate/rotate/scale
      // don't change the angular relationship between adjacent faces.
      // Edge wireframe vertex 위치는 JS에서 별도 업데이트 (ToolManager.syncMesh가 호출).

      return true;
    } catch (e) {
      console.warn('[Viewport] Failed to apply delta, will use full update:', e);
      return false;
    }
  }

  /**
   * Smooth normals (area-weighted, angle threshold).
   *
   * 알고리즘:
   * 1. 각 삼각형의 면 노멀 계산 (cross product, 정규화하지 않음 → 면적 가중)
   * 2. 정점 위치 기반으로 그룹핑 (용접/weld)
   * 3. 같은 위치의 정점들 중, 면 노멀 각도가 threshold 이내인 것만 합산
   * 4. 결과: 원통 옆면 → 부드러운 곡면, 직각 모서리 → 날카로운 엣지 유지
   */
  /**
   * Schedule smoothNormals on the next animation frame so the new mesh
   * paints immediately with WASM-supplied normals. If a previous schedule
   * is still pending it gets cancelled — only the latest mesh is smoothed.
   *
   * ADR-012 §2 — uses FrameScheduler so rAF chain depth stays ≤ 1 even
   * when multiple modules independently defer work to the next frame.
   * Same TaskKey ('smoothNormals') auto-deduplicates (latest geometry wins).
   */
  private _scheduleSmoothNormals(geometry: THREE.BufferGeometry, angleDeg: number): void {
    // Reference cleared (legacy field still on instance for back-compat)
    this._pendingSmoothNormalsRaf = null;
    frameScheduler.schedule('smoothNormals', () => {
      // Geometry might have been disposed if a newer updateMesh() ran.
      const pos = geometry.getAttribute('position');
      if (!pos) return;
      try { this.smoothNormals(geometry, angleDeg); }
      catch (e) { console.warn('[Viewport] deferred smoothNormals failed:', e); }
    });
  }

  private smoothNormals(geometry: THREE.BufferGeometry, angleDeg: number): void {
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const indexAttr = geometry.getIndex();
    if (!posAttr || !normAttr || !indexAttr) return;

    const cosThreshold = Math.cos(angleDeg * Math.PI / 180);
    const vertCount = posAttr.count;
    const idxArr = indexAttr.array;
    const triCount = Math.floor(idxArr.length / 3);

    // 1) 삼각형별 면 노멀 (area-weighted: cross product 정규화 안 함)
    //    + 삼각형별 단위 노멀 (각도 비교용)
    const faceNormals = new Float32Array(triCount * 3);     // area-weighted
    const faceUnitNormals = new Float32Array(triCount * 3);  // unit
    for (let t = 0; t < triCount; t++) {
      const i0 = idxArr[t * 3], i1 = idxArr[t * 3 + 1], i2 = idxArr[t * 3 + 2];
      const ax = posAttr.getX(i0), ay = posAttr.getY(i0), az = posAttr.getZ(i0);
      const bx = posAttr.getX(i1), by = posAttr.getY(i1), bz = posAttr.getZ(i1);
      const cx = posAttr.getX(i2), cy = posAttr.getY(i2), cz = posAttr.getZ(i2);
      // edge vectors
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      // cross product (area-weighted)
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      faceNormals[t * 3] = nx; faceNormals[t * 3 + 1] = ny; faceNormals[t * 3 + 2] = nz;
      // unit normal
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-10) {
        faceUnitNormals[t * 3] = nx / len;
        faceUnitNormals[t * 3 + 1] = ny / len;
        faceUnitNormals[t * 3 + 2] = nz / len;
      }
    }

    // 2) 정점 → 연결된 삼각형 목록 (incident faces)
    const incident: number[][] = new Array(vertCount);
    for (let i = 0; i < vertCount; i++) incident[i] = [];
    for (let t = 0; t < triCount; t++) {
      incident[idxArr[t * 3]].push(t);
      incident[idxArr[t * 3 + 1]].push(t);
      incident[idxArr[t * 3 + 2]].push(t);
    }

    // 3) 위치 키 → 정점 인덱스 그룹 (용접)
    const posMap = new Map<string, number[]>();
    const P = 0.01; // 0.01mm 정밀도
    for (let i = 0; i < vertCount; i++) {
      const x = Math.round(posAttr.getX(i) / P) * P;
      const y = Math.round(posAttr.getY(i) / P) * P;
      const z = Math.round(posAttr.getZ(i) / P) * P;
      const key = `${x},${y},${z}`;
      let list = posMap.get(key);
      if (!list) { list = []; posMap.set(key, list); }
      list.push(i);
    }

    // 4) 각 정점의 스무스 노멀 계산
    //
    // ADR-038 P23.4 — analytic face 의 vertex 는 Rust 의 정확한 evaluate
    // 결과를 그대로 유지한다. newNormals 를 원본 normAttr 로 pre-seed
    // 하여, analytic vertex 는 본 루프에서 건너뛰어도 원래 값이 보존됨.
    const newNormals = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) {
      newNormals[i * 3]     = normAttr.getX(i);
      newNormals[i * 3 + 1] = normAttr.getY(i);
      newNormals[i * 3 + 2] = normAttr.getZ(i);
    }

    // P23.4 — analytic vertex 식별을 위한 helper.
    // vertex i 가 analytic face 의 triangle 에 속하면 skip.
    const analyticIds = this.analyticFaceIds;
    const faceMapArr = this.faceMap;
    const isAnalyticVertex = (vi: number): boolean => {
      if (analyticIds.size === 0 || faceMapArr.length === 0) return false;
      const inc = incident[vi];
      for (let k = 0; k < inc.length; k++) {
        const tri = inc[k];
        if (tri < faceMapArr.length && analyticIds.has(faceMapArr[tri])) {
          return true;
        }
      }
      return false;
    };

    for (const group of posMap.values()) {
      // 같은 위치의 모든 정점이 연결된 삼각형 목록을 합침
      const allTris = new Set<number>();
      for (const vi of group) {
        for (const t of incident[vi]) allTris.add(t);
      }

      // 각 정점에 대해: seed = 그 정점이 속한 삼각형의 단위 노멀
      // 같은 위치의 모든 인접 삼각형 중 각도 < threshold인 것의 area-weighted 합산
      for (const vi of group) {
        if (incident[vi].length === 0) continue;

        // ADR-038 P23.4 — analytic vertex 는 Rust 정확 normal 유지.
        if (isAnalyticVertex(vi)) continue;

        const seedTri = incident[vi][0];
        const snx = faceUnitNormals[seedTri * 3];
        const sny = faceUnitNormals[seedTri * 3 + 1];
        const snz = faceUnitNormals[seedTri * 3 + 2];

        let sx = 0, sy = 0, sz = 0;
        for (const t of allTris) {
          const unx = faceUnitNormals[t * 3];
          const uny = faceUnitNormals[t * 3 + 1];
          const unz = faceUnitNormals[t * 3 + 2];
          const dot = snx * unx + sny * uny + snz * unz;
          if (dot >= cosThreshold) {
            // area-weighted 합산
            sx += faceNormals[t * 3];
            sy += faceNormals[t * 3 + 1];
            sz += faceNormals[t * 3 + 2];
          }
        }

        const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (len > 1e-10) {
          newNormals[vi * 3] = sx / len;
          newNormals[vi * 3 + 1] = sy / len;
          newNormals[vi * 3 + 2] = sz / len;
        }
        // else: pre-seeded 원본 normal 그대로 유지
      }
    }

    normAttr.set(newNormals);
    normAttr.needsUpdate = true;
  }

  /**
   * Create per-vertex color attribute based on face material assignments.
   * Each triangle gets the color of its assigned material from MaterialLibrary.
   */
  private createColorAttribute(geometry: THREE.BufferGeometry, faceMap: Uint32Array, positionCount: number): void {
    const matLib = getMaterialLibrary();
    const vertexCount = Math.floor(positionCount / 3); // positionCount = float 수, vertex 수 아님
    const colors = new Float32Array(vertexCount * 3);
    const defaultColor = 0xe8e8e8; // Default front color

    // 기본색으로 초기화
    const dr = ((defaultColor >> 16) & 255) / 255;
    const dg = ((defaultColor >> 8) & 255) / 255;
    const db = (defaultColor & 255) / 255;
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = dr;
      colors[i * 3 + 1] = dg;
      colors[i * 3 + 2] = db;
    }

    // 인덱스 버퍼를 사용하여 실제 정점 인덱스로 색상 할당
    const indexArray = this.indexBuffer;
    for (let tri = 0; tri < faceMap.length; tri++) {
      const faceId = faceMap[tri];
      const material = matLib.getMaterialForFace(faceId);
      if (!material) continue; // 기본색은 이미 설정됨

      const color = material.visual.color;
      const r = ((color >> 16) & 255) / 255;
      const g = ((color >> 8) & 255) / 255;
      const b = (color & 255) / 255;

      // 인덱스 버퍼에서 실제 정점 위치를 참조
      for (let v = 0; v < 3; v++) {
        const vertexIndex = indexArray[tri * 3 + v];
        const ci = vertexIndex * 3;
        colors[ci] = r;
        colors[ci + 1] = g;
        colors[ci + 2] = b;
      }
    }

    this.colorAttribute = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', this.colorAttribute);
  }

  /**
   * Find the first textured material among the face set's assignments.
   * Phase E v1: single-texture-per-mesh. Multi-texture via geometry groups
   * is planned for v2.
   */
  private findFirstTexturedMaterial(faceMap?: Uint32Array): TextureInfo | null {
    if (!faceMap || faceMap.length === 0) return null;
    const matLib = getMaterialLibrary();
    const seen = new Set<number>();
    for (let i = 0; i < faceMap.length; i++) {
      const fid = faceMap[i];
      if (seen.has(fid)) continue;
      seen.add(fid);
      const mat = matLib.getMaterialForFace(fid);
      if (mat?.visual.texture) return mat.visual.texture;
    }
    return null;
  }

  /** A. Material 확장 — find first material that has any aux PBR map
   *  (normal or roughness). Same single-texture limitation as
   *  findFirstTexturedMaterial. */
  private findFirstAuxMaterial(faceMap?: Uint32Array): import('../materials/MaterialLibrary').AuxTextureInfo | null {
    if (!faceMap || faceMap.length === 0) return null;
    const matLib = getMaterialLibrary();
    const seen = new Set<number>();
    for (let i = 0; i < faceMap.length; i++) {
      const fid = faceMap[i];
      if (seen.has(fid)) continue;
      seen.add(fid);
      const mat = matLib.getMaterialForFace(fid);
      if (mat?.visual.aux && (mat.visual.aux.normal || mat.visual.aux.roughness)) {
        return mat.visual.aux;
      }
    }
    return null;
  }

  /**
   * Load the texture from cache (or fetch asynchronously) and apply it to the
   * current frontMesh's material. Called after geometry build when a textured
   * material is detected.
   */
  private applyTextureAsync(tex: TextureInfo): void {
    const cache = getTextureCache();
    const cached = cache.get(tex.dataUrl);
    if (cached) {
      // Already loaded — nothing to do; frontMat.map was set at build time.
      return;
    }
    cache.load(tex.dataUrl)
      .then((three_tex) => {
        if (!this.frontMesh) return;
        const mat = this.frontMesh.material as THREE.MeshStandardMaterial;
        mat.map = three_tex;
        mat.needsUpdate = true;
      })
      .catch((err) => console.warn('[Viewport] texture load failed:', err));
  }

  /** A. Material 확장 (2026-04-26) — Apply auxiliary PBR maps (normal,
   *  roughness) to the front mesh's material. Loaded via the same
   *  TextureCache so multiple faces sharing the same texture only
   *  decode once. Called after applyTextureAsync (or on first build).
   *
   *  Limitations: only the FIRST face's aux maps are honoured (matching
   *  the existing single-texture path). Multi-texture per-face is future
   *  work via geometry groups. */
  private applyAuxTexturesAsync(aux: import('../materials/MaterialLibrary').AuxTextureInfo): void {
    if (!this.frontMesh) return;
    const mat = this.frontMesh.material as THREE.MeshStandardMaterial;
    const cache = getTextureCache();

    if (aux.normal) {
      const intensity = aux.normalIntensity ?? 1.0;
      const apply = (tex: THREE.Texture) => {
        if (!this.frontMesh) return;
        mat.normalMap = tex;
        mat.normalScale = new THREE.Vector2(intensity, intensity);
        mat.needsUpdate = true;
      };
      const cached = cache.get(aux.normal.dataUrl);
      if (cached) apply(cached);
      else cache.load(aux.normal.dataUrl).then(apply).catch(err =>
        console.warn('[Viewport] normal map load failed:', err));
    }

    if (aux.roughness) {
      const apply = (tex: THREE.Texture) => {
        if (!this.frontMesh) return;
        mat.roughnessMap = tex;
        mat.needsUpdate = true;
      };
      const cached = cache.get(aux.roughness.dataUrl);
      if (cached) apply(cached);
      else cache.load(aux.roughness.dataUrl).then(apply).catch(err =>
        console.warn('[Viewport] roughness map load failed:', err));
    }
  }

  /**
   * Refresh per-face material colors. Call this when material assignments change.
   */
  refreshMaterialColors(): void {
    if (!this.frontMesh || !this.colorAttribute || this.faceMap.length === 0) {
      return;
    }

    const matLib = getMaterialLibrary();
    const colors = this.colorAttribute.array as Float32Array;
    const defaultColor = 0xe8e8e8;
    const indexArray = this.indexBuffer;
    let hasChanges = false;

    // 인덱스 버퍼를 사용하여 실제 정점 인덱스로 색상 갱신
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      const faceId = this.faceMap[tri];
      const material = matLib.getMaterialForFace(faceId);
      let color = defaultColor;
      if (material) {
        color = material.visual.color;
      }

      const r = ((color >> 16) & 255) / 255;
      const g = ((color >> 8) & 255) / 255;
      const b = (color & 255) / 255;

      for (let v = 0; v < 3; v++) {
        const vertexIndex = indexArray[tri * 3 + v];
        const ci = vertexIndex * 3;
        if (colors[ci] !== r || colors[ci + 1] !== g || colors[ci + 2] !== b) {
          colors[ci] = r;
          colors[ci + 1] = g;
          colors[ci + 2] = b;
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      this.colorAttribute.needsUpdate = true;
    }

    // ── Texture sync ──
    // Material 재할당으로 텍스처 상태가 바뀌었으면 UV + map 갱신.
    this.refreshMeshTexture();
  }

  /**
   * Re-scan assigned materials for a textured material and sync the frontMesh's
   * map + UV attribute. Called from refreshMaterialColors to handle cases where
   * texture was assigned/removed AFTER initial mesh build.
   */
  private refreshMeshTexture(): void {
    if (!this.frontMesh) return;
    const geometry = this.frontMesh.geometry;
    const mat = this.frontMesh.material as THREE.MeshStandardMaterial;
    const tex = this.findFirstTexturedMaterial(this.faceMap);

    if (!tex) {
      // 텍스처가 모두 제거됨 — map 해제
      if (mat.map) {
        mat.map = null;
        mat.needsUpdate = true;
      }
      return;
    }

    // UV attribute 갱신 (현재 projection 기준)
    const posAttr = geometry.getAttribute('position');
    const normAttr = geometry.getAttribute('normal');
    if (!posAttr || !normAttr) return;
    const uvs = computeUVsFromBuffers(
      posAttr.array as Float32Array,
      normAttr.array as Float32Array,
      { mode: tex.projection, scale: tex.scale, rotation: tex.rotation ?? 0 },
    );
    const existingUv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (existingUv && existingUv.array.length === uvs.length) {
      (existingUv.array as Float32Array).set(uvs);
      existingUv.needsUpdate = true;
    } else {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }

    // 텍스처 로드/적용
    const cached = getTextureCache().get(tex.dataUrl);
    if (cached) {
      if (mat.map !== cached) {
        mat.map = cached;
        mat.needsUpdate = true;
      }
    } else {
      this.applyTextureAsync(tex);
    }
  }

  /** Perform a raycast pick.
   *
   * 제외 규칙:
   *   - userData.noPick === true 인 메시는 제외 (협약).
   *   - wall-shadow-caster (invisible 그림자 caster) 는 같은 좌표라
   *     frontMesh 와 distance 동일 hit → tie-break 비결정적이라 제외.
   *   - back-mesh-wall / back-mesh-sheet 는 대상에 포함 (사용자가 솔리드
   *     안쪽에서 클릭하는 경우 지원). FrontSide 메시가 같은 거리에 있으면
   *     hits 정렬 후 그쪽이 우선됨. */
  pick(screenX: number, screenY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.activeCamera as THREE.PerspectiveCamera);
    const meshes = this.meshGroup.children.filter(c => {
      if (!(c instanceof THREE.Mesh)) return false;
      if (c.userData?.noPick === true) return false;
      // 그림자 caster — invisible 이지만 raycaster 가 잡음. 명시 제외.
      if (c.name === 'wall-shadow-caster') return false;
      return true;
    });
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    // distance 정렬된 hits[0] — front/back 메시가 동일 거리면 raycaster
    // 가 자체 정렬한 결과를 그대로 사용. front-mesh 가 보통 먼저 children
    // 에 추가되므로 tie-break 시 우선됨.
    // ✱ FrontSide 우선 — same-distance 동률 시 front-mesh 우선 선택.
    if (hits.length >= 2) {
      const eps = Math.max(hits[0].distance * 1e-4, 0.001);
      // hits 가 distance 정렬돼 있다고 가정 (Three.js raycaster 기본 동작).
      // [0] 와 [1] 이 거의 같은 거리면 front-mesh 가 있는지 확인 후 우선.
      if (Math.abs(hits[0].distance - hits[1].distance) < eps) {
        for (const h of hits) {
          const obj = h.object as THREE.Object3D & { name?: string };
          if (Math.abs(h.distance - hits[0].distance) > eps) break;
          if (obj.name === 'front-mesh') return h;
        }
      }
    }
    return hits[0];
  }

  /**
   * Edge / Face 동시 raycast → 커서에 더 가까운 쪽을 선호하는 "지능형 우선순위" 픽.
   *
   * 규칙:
   *  1. 엣지 hit이 커서로부터 `preferEdgeWithinPx` 픽셀 이내 → **edge 우선**
   *  2. 그 외 face hit이 있으면 → face
   *  3. face miss지만 edge hit → edge (빈 공간 근처 엣지)
   *  4. 둘 다 miss → null
   *
   * 이 방식으로:
   *  - 면 중앙 클릭 → 언제나 면 선택
   *  - 엣지 5px 이내 클릭 → 엣지 선택 (얇은 엣지도 놓치지 않음)
   *  - 작은 면도 중앙만 정확히 클릭하면 face 선택 가능
   */
  pickEdgeOrFace(
    screenX: number,
    screenY: number,
    preferEdgeWithinPx: number = 5,
  ):
    | { type: 'face'; hit: THREE.Intersection }
    | { type: 'edge'; hit: THREE.Intersection }
    | null
  {
    const faceHit = this.pick(screenX, screenY);
    const edgeHit = this.pickEdge(screenX, screenY);

    if (!faceHit && !edgeHit) return null;
    if (!edgeHit) return { type: 'face', hit: faceHit! };
    if (!faceHit) return { type: 'edge', hit: edgeHit };

    // ── 둘 다 hit ──
    // ✱ Bug fix (2026-04-19): pickEdge는 LineSegments에 threshold를 적용한 Line raycast라
    // 카메라 ray에서 perpendicular 거리만 판정함. 그래서 박스 뒤에 있는 구/원의 엣지가
    // 박스 face보다 perpendicular-거리상 가깝다는 이유로 선택돼 "박스 클릭했는데 구/원이
    // 먼저 선택"되는 현상 발생. → face가 edge보다 "명백히 앞"(ray 거리)에 있으면 edge 무시.
    //
    // polygonOffset으로 edge가 face보다 아주 살짝 앞에 렌더링되므로 eps를 좀 크게 둔다.
    // 카메라-거리에 비례한 tolerance: 0.5% (박스 5m 떨어져 있을 때 약 25mm 여유).
    const cam = this.activeCamera;
    const camDist = (cam as THREE.PerspectiveCamera).position.length();
    const depthEps = Math.max(camDist * 0.005, 1);
    if (edgeHit.distance > faceHit.distance + depthEps) {
      // edge가 face보다 뒤에 있음 (occluded). face 선택.
      return { type: 'face', hit: faceHit };
    }

    // 화면 상 엣지까지 거리로 판정 (edge가 face와 같은 평면상이거나 앞에 있을 때만).
    //
    // ❗ 2026-04-27 엔진 결함 수정: 이전엔 `edgeHit.point` 를 screen 으로
    //   project 해서 거리를 측정했는데, Three.js raycaster 의 Line/Line2 는
    //   `point` 를 카메라 ray 위의 closest 점으로 설정한다 (즉 cursor 가
    //   투영되는 screen 좌표와 거의 동일). 결과: edgePixelDist 가 항상 ≈ 0
    //   → preferEdgeWithinPx 검사가 무력화되어 엣지가 거의 항상 우선.
    //   사용자 보고 "면을 선택했는데 엣지라인이 선택돼 있다" 의 원인.
    //
    //   올바른 좌표는 `intersection.pointOnLine` — 엣지 segment 위의 실제
    //   closest 점. Three.js LineSegments raycast 와 LineSegments2 (Line2)
    //   raycast 모두 이 필드를 채워준다. 이 점을 screen 으로 project 해야
    //   "cursor 와 edge line 사이 픽셀 거리" 라는 본래 의도가 살아난다.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const onEdge = (edgeHit as THREE.Intersection & { pointOnLine?: THREE.Vector3 })
      .pointOnLine ?? edgeHit.point;
    const edgeProj = onEdge.clone().project(cam);
    const edgeScreenX = ((edgeProj.x + 1) / 2) * rect.width + rect.left;
    const edgeScreenY = ((1 - edgeProj.y) / 2) * rect.height + rect.top;
    const dx = edgeScreenX - screenX;
    const dy = edgeScreenY - screenY;
    const edgePixelDist = Math.sqrt(dx * dx + dy * dy);

    if (edgePixelDist <= preferEdgeWithinPx) {
      return { type: 'edge', hit: edgeHit };
    }
    return { type: 'face', hit: faceHit };
  }

  // ─────────────────────────────────────────────────────────────────
  // ADR-040 Stage 3 — Analytic ray-curve hover refinement (P25)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Convert a screen-space pixel threshold to a world-space distance at
   * the depth of `worldPoint`. ADR-040 P25.3 — keeps the hover threshold
   * camera-distance-independent.
   *
   * Returns the world distance (mm) such that a perpendicular offset of
   * exactly that amount appears as `pixels` pixels on screen at the
   * given depth.
   */
  pixelToWorldAtDepth(worldPoint: THREE.Vector3, pixels: number): number {
    const cam = this.activeCamera as THREE.PerspectiveCamera;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (cam.isPerspectiveCamera) {
      const camToPoint = worldPoint.clone().sub(cam.position).length();
      return pixelToWorldPerspective(pixels, rect.height, {
        fovDeg: cam.fov,
        cameraToPointDistance: camToPoint,
      });
    }
    const ortho = cam as unknown as THREE.OrthographicCamera;
    return pixelToWorldOrthographic(pixels, rect.height, {
      topMinusBottom: ortho.top - ortho.bottom,
      zoom: ortho.zoom || 1,
    });
  }

  /**
   * ADR-040 Stage 3 — refine an edge hover using analytic curve distance.
   *
   * Given an existing BVH hit on edge `edgeId`, calls the WASM analytic
   * distance kernel and reports whether the ray is within `thresholdPx`
   * (default 12px per P25.3 industrial CAD norm) of the *true* curve.
   *
   * Returns:
   *   - `{ within: true, distance, point }` when analytic distance ≤ threshold
   *   - `{ within: false, distance, point }` when the polyline-fooled hit
   *     should be rejected (BVH false positive, P25 main case)
   *   - `null` when the edge has no analytic curve OR Newton diverged
   *     (P25.4 — caller keeps the polyline result as-is)
   */
  refineEdgeHoverWithAnalytic(
    bridge: WasmBridge,
    edgeId: number,
    screenX: number,
    screenY: number,
    thresholdPx: number = 12,
  ): { within: boolean; distance: number; point: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.activeCamera as THREE.PerspectiveCamera);
    const ray = this.raycaster.ray;
    // Three.js raycaster sets a unit direction; defensive normalise.
    const dir = ray.direction.clone().normalize();

    const result = bridge.edgeRayDistance(
      edgeId,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    if (!result) return null;

    const point = new THREE.Vector3(result.point.x, result.point.y, result.point.z);
    const worldThreshold = this.pixelToWorldAtDepth(point, thresholdPx);
    return {
      within: result.distance <= worldThreshold,
      distance: result.distance,
      point,
    };
  }

  /** Perform a raycast pick on wireframe edges.
   *
   *  Supports both LineSegments (legacy) and LineSegments2 (Line2 path,
   *  2026-04-24 edge rendering). LineSegments2 inherits from Mesh so it
   *  needs to be explicitly included — a plain `instanceof LineSegments`
   *  filter skipped it, and edge selection + erase silently broke.
   *
   *  Threshold auto-scales from camera distance for consistent
   *  screen-space feel. */
  pickEdge(screenX: number, screenY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.activeCamera as THREE.PerspectiveCamera);

    const cam = this.activeCamera as THREE.PerspectiveCamera;
    const camDist = cam.position.length();
    const dynamicThreshold = Math.max(camDist * 0.005, 10);

    // Legacy LineSegments threshold (raycaster.params.Line.threshold, world units)
    const prevLine = this.raycaster.params.Line?.threshold ?? 1;
    if (!this.raycaster.params.Line) this.raycaster.params.Line = { threshold: 1 };
    this.raycaster.params.Line.threshold = dynamicThreshold;

    // Line2 threshold (raycaster.params.Line2.threshold). LineSegments2
    //   raycast uses world units like the legacy Line variant, so reuse
    //   the same camera-distance-scaled value for consistent feel
    //   whether edges render with LineBasicMaterial or LineMaterial.
    const raycasterParams = this.raycaster.params as unknown as { Line2?: { threshold: number } };
    const prevLine2 = raycasterParams.Line2?.threshold ?? 1;
    if (!raycasterParams.Line2) raycasterParams.Line2 = { threshold: dynamicThreshold };
    else raycasterParams.Line2.threshold = dynamicThreshold;

    // Pick any edge-ish child: both LineSegments and LineSegments2.
    const isEdgeChild = (c: THREE.Object3D): boolean => {
      if (c.userData?.noPick === true) return false;
      if (c instanceof THREE.LineSegments) return true;
      // LineSegments2 extends Mesh but has a distinct type string.
      return (c as THREE.Object3D & { isLineSegments2?: boolean }).isLineSegments2 === true
        || c.type === 'LineSegments2';
    };
    const lineSegments = this.meshGroup.children.filter(isEdgeChild);
    const hits = this.raycaster.intersectObjects(lineSegments, false);

    this.raycaster.params.Line.threshold = prevLine;
    if (raycasterParams.Line2) raycasterParams.Line2.threshold = prevLine2;

    if (hits.length === 0) return null;

    // 2026-04-27 — pick the *visually-closest* edge in screen space, not
    //   the ray-closest. Three.js `intersectObjects` returns hits sorted by
    //   ray distance (which prefers edges whose perpendicular-from-ray
    //   distance is smallest), but for "라인 선택이 쉽도록" 의도엔 화면
    //   상에서 가장 가까운 엣지가 더 자연스럽다. pointOnLine → screen
    //   project → smallest distance from cursor wins.
    const cursorRect = this.renderer.domElement.getBoundingClientRect();
    let best: THREE.Intersection | null = null;
    let bestPx = Infinity;
    for (const h of hits) {
      const onEdge = (h as THREE.Intersection & { pointOnLine?: THREE.Vector3 })
        .pointOnLine ?? h.point;
      if (!onEdge) continue;
      const proj = onEdge.clone().project(cam);
      const x = ((proj.x + 1) / 2) * cursorRect.width + cursorRect.left;
      const y = ((1 - proj.y) / 2) * cursorRect.height + cursorRect.top;
      const dx = x - screenX;
      const dy = y - screenY;
      const px = Math.sqrt(dx * dx + dy * dy);
      if (px < bestPx) {
        bestPx = px;
        best = h;
      }
    }
    const hit = best ?? hits[0];

    // Normalize `index` to "first-vertex-index" convention.
    //   Legacy THREE.LineSegments: hit.index = first vertex index of the
    //     segment (seg n starts at index 2n). Callers compute
    //     segIndex = Math.floor(index / 2).
    //   LineSegments2:             hit.index = segment index (n directly);
    //     hit.faceIndex = same. Without adjustment callers would halve it
    //     and look up the wrong edgeMap slot → edge pick reads back the
    //     wrong edge id, erase hits the wrong edge or misses entirely.
    const isL2 = (hit.object as THREE.Object3D & { isLineSegments2?: boolean }).isLineSegments2 === true
      || hit.object.type === 'LineSegments2';
    if (isL2) {
      const segIndex = hit.faceIndex ?? hit.index ?? 0;
      (hit as THREE.Intersection & { index?: number }).index = segIndex * 2;
    }
    return hit;
  }

  /** index buffer 백업 */
  backupFaceIndices(): Uint32Array | null {
    const frontMesh = this.meshGroup.children.find(
      c => c instanceof THREE.Mesh && c.name === 'front-mesh'
    ) as THREE.Mesh | undefined;
    if (!frontMesh) return null;
    const index = frontMesh.geometry.getIndex();
    if (!index) return null;
    return new Uint32Array(index.array as Uint32Array);
  }

  /**
   * ADR-039 P24.5 — Hover target 시각 적용.
   *
   * SelectTool.onHoverChange 가 호출 — stickiness 통과한 변경에만 들어옴.
   *
   * Face hover: 해당 face 의 모든 vertex color 를 hover tint 로 변경.
   *             원본은 `_hoverFaceColorCache` 에 저장, hover 해제 시 복원.
   *
   * Edge hover: 본 commit 은 state 저장만 (실제 시각은 별도 PR — overlay
   *             LineSegments 추가 필요).
   *
   * null: 이전 hover 시각 복원.
   */
  setHoveredOwner(target: { kind: 'edge' | 'face'; id: number } | null): void {
    // 1. 이전 hover 의 시각 복원
    if (this._hoveredOwner?.kind === 'face') {
      this._restoreFaceHoverTint(this._hoveredOwner.id);
    }
    // (edge restore: 별도 PR)

    // 2. 새 hover 적용
    this._hoveredOwner = target;
    if (target?.kind === 'face') {
      this._applyFaceHoverTint(target.id);
    }
    // (edge apply: 별도 PR)
  }

  /** 진단 / 테스트용 — 현재 hover target 조회. */
  getHoveredOwner(): { kind: 'edge' | 'face'; id: number } | null {
    return this._hoveredOwner;
  }

  /**
   * Face F 의 모든 vertex 에 hover tint 적용.
   *
   * Tint 정책 (P24.5 권장):
   *   r' = clamp(r * 0.7 + 0.4, 0, 1)
   *   g' = clamp(g * 0.7 + 0.4, 0, 1)
   *   b' = clamp(b * 0.7 + 0.6, 0, 1)
   * → 약간 밝아지면서 파란빛 가미 (산업 CAD 표준 hover 색감).
   *
   * 원본 색상은 `_hoverFaceColorCache[faceId]` 에 [vertexIdx, r, g, b]
   * 형식으로 저장되어 hover 해제 시 정확히 복원.
   */
  private _applyFaceHoverTint(faceId: number): void {
    if (!this.colorAttribute || this.faceMap.length === 0
        || this.indexBuffer.length === 0) {
      return;
    }
    const colorArr = this.colorAttribute.array as Float32Array;
    const idxArr = this.indexBuffer;

    // 본 face 의 모든 vertex 수집 (중복 제거)
    const verts = new Set<number>();
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (this.faceMap[tri] === faceId) {
        verts.add(idxArr[tri * 3]);
        verts.add(idxArr[tri * 3 + 1]);
        verts.add(idxArr[tri * 3 + 2]);
      }
    }
    if (verts.size === 0) return;

    // 원본 저장 + tint 적용
    const saved = new Float32Array(verts.size * 4);
    let i = 0;
    for (const v of verts) {
      const r = colorArr[v * 3];
      const g = colorArr[v * 3 + 1];
      const b = colorArr[v * 3 + 2];
      saved[i * 4]     = v;
      saved[i * 4 + 1] = r;
      saved[i * 4 + 2] = g;
      saved[i * 4 + 3] = b;
      // P24.5 hover tint
      colorArr[v * 3]     = Math.min(1, r * 0.7 + 0.4);
      colorArr[v * 3 + 1] = Math.min(1, g * 0.7 + 0.4);
      colorArr[v * 3 + 2] = Math.min(1, b * 0.7 + 0.6);
      i++;
    }
    this._hoverFaceColorCache.set(faceId, saved);
    this.colorAttribute.needsUpdate = true;
  }

  /** Face F 의 hover tint 를 원본으로 복원. */
  private _restoreFaceHoverTint(faceId: number): void {
    const saved = this._hoverFaceColorCache.get(faceId);
    if (!saved || !this.colorAttribute) return;
    const colorArr = this.colorAttribute.array as Float32Array;
    const n = saved.length / 4;
    for (let k = 0; k < n; k++) {
      const v = saved[k * 4];
      colorArr[v * 3]     = saved[k * 4 + 1];
      colorArr[v * 3 + 1] = saved[k * 4 + 2];
      colorArr[v * 3 + 2] = saved[k * 4 + 3];
    }
    this._hoverFaceColorCache.delete(faceId);
    this.colorAttribute.needsUpdate = true;
  }

  /** 특정 face의 삼각형을 index buffer에서 임시 제거 */
  hideFace(faceMap: Uint32Array, faceId: number) {
    const frontMesh = this.meshGroup.children.find(
      c => c instanceof THREE.Mesh && c.name === 'front-mesh'
    ) as THREE.Mesh | undefined;
    if (!frontMesh) return;
    const geo = frontMesh.geometry;
    const index = geo.getIndex();
    if (!index) return;
    const current = index.array as Uint32Array;
    const filtered: number[] = [];
    for (let tri = 0; tri < faceMap.length; tri++) {
      if (faceMap[tri] !== faceId) {
        const base = tri * 3;
        if (base + 2 < current.length) {
          filtered.push(current[base], current[base + 1], current[base + 2]);
        }
      }
    }
    geo.setIndex(filtered);
  }

  /** 백업 인덱스로 복원 */
  restoreFace(originalIndices: Uint32Array) {
    const frontMesh = this.meshGroup.children.find(
      c => c instanceof THREE.Mesh && c.name === 'front-mesh'
    ) as THREE.Mesh | undefined;
    if (!frontMesh) return;
    frontMesh.geometry.setIndex(new THREE.BufferAttribute(originalIndices, 1));
  }

  setStats(verts: number, faces: number) {
    this._verts = verts;
    this._faces = faces;
  }

  getStats() {
    return { verts: this._verts, edges: this._edges, faces: this._faces };
  }

  /** 카메라 상태 내보내기 (저장용) */
  getCameraState() {
    return {
      viewMode: this._viewMode,
      radius: this.spherical.radius,
      phi: this.spherical.phi,
      theta: this.spherical.theta,
      targetX: this.orbitTarget.x,
      targetY: this.orbitTarget.y,
      targetZ: this.orbitTarget.z,
      orthoZoom: this.orthoZoom,
    };
  }

  /** 카메라 상태 복원 (로드용) */
  setCameraState(state: {
    viewMode?: string;
    radius?: number;
    phi?: number;
    theta?: number;
    targetX?: number;
    targetY?: number;
    targetZ?: number;
    orthoZoom?: number;
  }) {
    if (state.radius !== undefined) this.spherical.radius = state.radius;
    if (state.phi !== undefined) this.spherical.phi = state.phi;
    if (state.theta !== undefined) this.spherical.theta = state.theta;
    if (state.targetX !== undefined) this.orbitTarget.x = state.targetX;
    if (state.targetY !== undefined) this.orbitTarget.y = state.targetY;
    if (state.targetZ !== undefined) this.orbitTarget.z = state.targetZ;
    if (state.orthoZoom !== undefined) this.orthoZoom = state.orthoZoom;

    if (state.viewMode) {
      this.setViewMode(state.viewMode as ViewMode);
    } else {
      this.updateCameraFromSpherical();
    }
  }

  /** 카메라를 원점으로 복귀 (초기 상태) */
  /**
   * Screen cursor → world 3D point for zoom pivot.
   * Priority: ① scene geometry hit  ② orbit-target view-plane projection.
   *
   * The view-plane fallback keeps the zoom pivot at the "same depth" as
   * the current orbit target when nothing is under the cursor — this is
   * what users expect from SketchUp/Blender-style zoom.
   */
  private _cursorWorldPoint(screenX: number, screenY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _zoomMouse.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    _zoomRaycaster.setFromCamera(_zoomMouse, this.activeCamera as THREE.PerspectiveCamera);
    // ① 실제 메시 hit
    const meshes = this.meshGroup.children.filter(c => c instanceof THREE.Mesh);
    const hits = _zoomRaycaster.intersectObjects(meshes, false);
    if (hits.length > 0) return hits[0].point.clone();
    // ② orbit-target 을 지나는 view-plane 으로 projection
    const ray = _zoomRaycaster.ray;
    const camDir = _zoomTmp.set(0, 0, 0);
    this.activeCamera.getWorldDirection(camDir);
    const denom = ray.direction.dot(camDir);
    if (Math.abs(denom) < 1e-6) return null;
    const t = (this.orbitTarget.clone().sub(ray.origin).dot(camDir)) / denom;
    if (!Number.isFinite(t) || t <= 0) return null;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }

  resetCamera() {
    this.orbitTarget.set(0, 0, 0);
    this.spherical.set(60000, Math.PI / 4, Math.PI / 4);
    if (this._viewMode === '3d') {
      this.updateCameraFromSpherical();
    } else {
      // 2D 뷰 모드에서도 orbitTarget 리셋 후 뷰 재설정
      this.setViewMode(this._viewMode);
    }
  }

  // ═══ Style API ═══

  /** 배경 모드/색상 업데이트 */
  updateBackground(
    mode?: 'solid' | 'gradient2' | 'gradient3',
    skyColor?: string,
    groundColor?: string,
    midColor?: string,
  ) {
    if (mode !== undefined) this._bgMode = mode;
    if (skyColor !== undefined) this._bgSkyColor = skyColor;
    if (groundColor !== undefined) this._bgGroundColor = groundColor;
    if (midColor !== undefined) this._bgMidColor = midColor;

    if (this._bgMode === 'solid') {
      this.scene.background = new THREE.Color(this._bgSkyColor);
      return;
    }

    // Gradient: canvas → texture
    if (!this.bgCanvas) {
      this.bgCanvas = document.createElement('canvas');
      this.bgCanvas.width = 2;
      this.bgCanvas.height = 512;
    }
    const ctx = this.bgCanvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);

    if (this._bgMode === 'gradient2') {
      grad.addColorStop(0, this._bgSkyColor);
      grad.addColorStop(1, this._bgGroundColor);
    } else {
      grad.addColorStop(0, this._bgSkyColor);
      grad.addColorStop(0.5, this._bgMidColor);
      grad.addColorStop(1, this._bgGroundColor);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);

    const tex = new THREE.CanvasTexture(this.bgCanvas);
    tex.needsUpdate = true;

    // Dispose old texture if it was a CanvasTexture
    if (this.scene.background instanceof THREE.Texture) {
      this.scene.background.dispose();
    }
    this.scene.background = tex;
  }

  /** 면 색상 변경 */
  setFaceColors(frontHex?: number, backHex?: number) {
    if (frontHex !== undefined) this._frontColor = frontHex;
    if (backHex !== undefined) this._backColor = backHex;
    // 현재 meshGroup의 재질을 업데이트
    for (const child of this.meshGroup.children) {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.side === THREE.FrontSide) {
          mat.color.setHex(this._frontColor);
        } else if (mat.side === THREE.BackSide) {
          mat.color.setHex(this._backColor);
        }
      }
    }
  }

  /** 면 투명도 변경 */
  setFaceOpacity(opacity: number) {
    this._faceOpacity = opacity;
    for (const child of this.meshGroup.children) {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.transparent = opacity < 1.0;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
    }
  }

  /** 엣지 색상/굵기/표시 변경. width는 1~5 CSS px 범위 권장. */
  setEdgeStyle(opts: { color?: number; visible?: boolean; profileEdge?: boolean; width?: number }) {
    if (opts.color !== undefined) this._edgeColor = opts.color;
    if (opts.visible !== undefined) this._edgeVisible = opts.visible;
    if (opts.profileEdge !== undefined) this._profileEdge = opts.profileEdge;
    // width: WebGL LineBasicMaterial은 1px 고정이라 내부 상태만 저장 (미래
    // 대비). 실제 적용하려면 Line2 기반으로 교체 필요 — 지금은 의도적으로
    // 단순화해 1px solid 채택.
    if (opts.width !== undefined) this._edgeWidth = Math.max(0.5, Math.min(10, opts.width));

    for (const child of this.meshGroup.children) {
      if (child instanceof THREE.LineSegments) {
        child.visible = this._edgeVisible;
        (child.material as THREE.LineBasicMaterial).color.setHex(this._edgeColor);
      } else if (child instanceof LineSegments2) {
        // Centerline은 여전히 Line2 기반 (dashed 필요).
        child.visible = this._edgeVisible;
      }
    }
    // Centerline material 색상 동기화 (필요 시 개별 API로 분리 가능).
    for (const mat of this._meshEdgeMaterials) {
      if (mat.dashed) {
        // 중심선은 기본 grey-blue 유지 — edge color 따라가지 않음.
        continue;
      }
    }
  }

  /** 현재 엣지 굵기 (StylePanel 초기값용). */
  getEdgeWidth(): number { return this._edgeWidth; }

  /** 그리드 표시 on/off */
  setGridVisible(visible: boolean) {
    this.infiniteGrid.visible = visible;
  }

  /** 그리드 색상 변경. Shader-grid는 big/small 2-tier 구조이지만 단일
   *  색상 API가 필요한 경우 small은 hex 기준, big은 조금 더 짙게 세팅. */
  setGridColor(hex: number) {
    const color = new THREE.Color(hex);
    this.infiniteGrid.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
        const u = child.material.uniforms;
        if (u.uSmallColor) (u.uSmallColor.value as THREE.Color).copy(color);
        if (u.uBigColor) {
          // Big grid는 small보다 어둡게 — luminance 65%로 스케일
          const big = color.clone().multiplyScalar(0.65);
          (u.uBigColor.value as THREE.Color).copy(big);
        }
      }
    });
  }

  /** 축 표시 on/off */
  setAxisVisible(visible: boolean) {
    if (this.axisGroup) this.axisGroup.visible = visible;
    for (const line of this.axisLines) {
      line.visible = visible;
    }
  }

  /**
   * ADR-007 Phase 4 — CAD 모드 (single-sided 렌더) on/off.
   *
   * true: BackSide mesh 생략 → GPU 작업량 절반, outer=Front 불변식 기반
   * false: 기존 two-tone (뒷면 파란 톤)
   *
   * 변경은 다음 updateMesh()부터 반영됨. 즉시 효과를 보려면 호출 후
   * bridge.syncMesh() 또는 updateMesh()를 재호출.
   */
  setSingleSidedRender(enabled: boolean) {
    this._singleSidedRender = enabled;
  }

  /** 현재 single-sided 모드 여부 */
  isSingleSidedRender(): boolean {
    return this._singleSidedRender;
  }

  /** ADR-018 dev toggle — face orientation 가시화 (legacy 두 톤 모드). */
  setShowFaceOrientation(enabled: boolean) {
    this._showFaceOrientation = enabled;
  }

  /** ADR-018 — 현재 face orientation 가시화 모드 여부. */
  isShowFaceOrientation(): boolean {
    return this._showFaceOrientation;
  }

  /** 현재 스타일 설정값 반환 (프리셋 비교/저장용) */
  getStyleSettings() {
    return {
      bgMode: this._bgMode,
      bgSkyColor: this._bgSkyColor,
      bgMidColor: this._bgMidColor,
      bgGroundColor: this._bgGroundColor,
      frontColor: this._frontColor,
      backColor: this._backColor,
      edgeColor: this._edgeColor,
      faceOpacity: this._faceOpacity,
      edgeVisible: this._edgeVisible,
      profileEdge: this._profileEdge,
      gridVisible: this.infiniteGrid.visible,
      axisVisible: this.axisGroup ? this.axisGroup.visible : true,
      singleSidedRender: this._singleSidedRender,
    };
  }

  /** 스타일 프리셋 적용 */
  applyStylePreset(preset: {
    bgMode: 'solid' | 'gradient2' | 'gradient3';
    bgSkyColor: string;
    bgMidColor?: string;
    bgGroundColor: string;
    frontColor: number;
    backColor: number;
    edgeColor: number;
  }) {
    this.updateBackground(preset.bgMode, preset.bgSkyColor, preset.bgGroundColor, preset.bgMidColor);
    this.setFaceColors(preset.frontColor, preset.backColor);
    this.setEdgeStyle({ color: preset.edgeColor });
  }

  /** Register a callback to run each frame (before render) */
  onFrame(cb: () => void): void {
    this._onFrameCallbacks.push(cb);
  }

  /** Toggle dynamic shadow frustum fit (Shadow Phase 2). */
  setDynamicShadowFit(enabled: boolean): void {
    this._dynamicShadowFit = enabled;
    if (!enabled && this._dirLight) {
      // Restore Phase 1 static frustum.
      const s = this._dirLight.shadow;
      s.camera.left = -15000; s.camera.right = 15000;
      s.camera.top = 15000;   s.camera.bottom = -15000;
      s.camera.near = 100;    s.camera.far = 60000;
      s.camera.updateProjectionMatrix();
    }
  }

  /** Recompute the directional light's shadow frustum each frame so it
   *  hugs the visible scene. Called from animate() when the toggle is
   *  on (default).
   *
   *  Strategy:
   *    - Light-space bbox of all active mesh AABBs (in light-view coords).
   *    - Pad slightly so geometry near the edge isn't clipped.
   *    - Texel-snap left/bottom to integer texels so the shadow doesn't
   *      crawl across surfaces during camera pan ("shadow shimmering").
   *
   *  No-op when the dir light has no castShadow or when the scene is
   *  empty. */
  private _updateDynamicShadowFrustum(): void {
    if (!this._dynamicShadowFit) return;
    const dl = this._dirLight;
    if (!dl || !dl.castShadow) return;

    // Build light-view basis (z = -light direction, x/y orthonormal).
    const lightDir = dl.position.clone().sub(dl.target.position).normalize();
    if (lightDir.lengthSq() < 1e-6) return;
    const upGuess = Math.abs(lightDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(upGuess, lightDir).normalize();
    const up = new THREE.Vector3().crossVectors(lightDir, right).normalize();

    // Walk active meshes; project their AABB corners into light-view
    //   coords and accumulate min/max per axis.
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    const tmp = new THREE.Vector3();
    let foundAny = false;
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (!obj.visible || !obj.castShadow) return;
      const geo = obj.geometry as THREE.BufferGeometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      // 8 AABB corners in object space
      for (let i = 0; i < 8; i++) {
        tmp.set(
          (i & 1) ? bb.max.x : bb.min.x,
          (i & 2) ? bb.max.y : bb.min.y,
          (i & 4) ? bb.max.z : bb.min.z,
        );
        tmp.applyMatrix4(obj.matrixWorld);
        // Project onto light basis
        const lx = tmp.dot(right);
        const ly = tmp.dot(up);
        const lz = tmp.dot(lightDir);
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;
        if (lz < minZ) minZ = lz;
        if (lz > maxZ) maxZ = lz;
        foundAny = true;
      }
    });
    if (!foundAny) return;

    // Pad the box a bit so anti-aliased silhouettes don't clip.
    const padXY = Math.max(50, (maxX - minX) * 0.05);
    const padZ = Math.max(50, (maxZ - minZ) * 0.05);
    minX -= padXY; maxX += padXY;
    minY -= padXY; maxY += padXY;
    minZ -= padZ;  maxZ += padZ;

    // Texel-snap: round left/bottom to whole texels so silhouettes
    //   don't wobble between frames as the camera pans.
    const s = dl.shadow;
    const mapSize = s.mapSize.x;
    if (mapSize > 0) {
      const tx = (maxX - minX) / mapSize;
      const ty = (maxY - minY) / mapSize;
      if (tx > 0) {
        minX = Math.floor(minX / tx) * tx;
        maxX = minX + tx * mapSize;
      }
      if (ty > 0) {
        minY = Math.floor(minY / ty) * ty;
        maxY = minY + ty * mapSize;
      }
    }

    s.camera.left = minX; s.camera.right = maxX;
    s.camera.bottom = minY; s.camera.top = maxY;
    // light-view Z grows opposite to lightDir; remap to near/far.
    s.camera.near = Math.max(1, -maxZ);
    s.camera.far = Math.max(s.camera.near + 100, -minZ);
    s.camera.updateProjectionMatrix();
  }

  start() {
    // Build the post-processing composer on first start if SSAO is on
    // and we haven't built it yet. Lazy so any headless test that
    // instantiates Viewport without calling start() skips WebGL work.
    if (this._ssaoEnabled && !this._composer) {
      this._buildSsaoComposer();
    }
    const animate = () => {
      this._frameId = requestAnimationFrame(animate);
      // Frame boundary marker for ADR-012 telemetry — installs no-ops
      // when the telemetry module isn't loaded. Lookup is one window
      // property access; Hidden when __AXIA_DEBUG=false anyway.
      const w = window as unknown as { __AXIA_TELEMETRY_FRAME_START?: () => void };
      w.__AXIA_TELEMETRY_FRAME_START?.();
      for (const cb of this._onFrameCallbacks) cb();
      // Shadow Phase 2 — refit the directional light frustum to the
      //   visible scene each frame (texel-snapped to avoid shimmer).
      this._updateDynamicShadowFrustum();
      if (this._ssaoEnabled && this._composer) {
        // Keep the SSAO pass's camera in sync with the active camera —
        // we switch between perspective and orthographic on view-mode
        // changes, and SSAO's depth reconstruction is camera-specific.
        if (this._renderPass) this._renderPass.camera = this.activeCamera;
        if (this._ssaoPass)   this._ssaoPass.camera = this.activeCamera;
        this._composer.render();
      } else {
        this.renderer.render(this.scene, this.activeCamera);
      }
      // End-of-frame telemetry hook (mirror of start hook above).
      const w2 = window as unknown as { __AXIA_TELEMETRY_FRAME_END?: () => void };
      w2.__AXIA_TELEMETRY_FRAME_END?.();
    };
    animate();
  }

  /**
   * Toggle Screen-Space Ambient Occlusion. Off by default can be
   * preferred for low-end GPUs; we default ON since the puppy scene
   * benefits strongly and the perf cost is manageable.
   */
  setSsaoEnabled(enabled: boolean): void {
    this._ssaoEnabled = enabled;
    if (enabled && !this._composer) {
      this._buildSsaoComposer();
    }
  }

  isSsaoEnabled(): boolean {
    return this._ssaoEnabled;
  }

  // ═══════════════════════════════════════════════════════
  //  Projected shadow (SketchUp-style)
  // ═══════════════════════════════════════════════════════

  /** Projected shadow on/off 토글 (+ VSM 보조 레이어 연동).
   *  Rust-side projection이 필요하므로 활성화 시 caller가 syncMesh로
   *  trigger해 updateProjectedShadow()가 호출되도록 해야 함 (ToolManager에서
   *  이미 보장). Phase 2: VSM shadow map도 같이 on/off해 곡면 subtle 음영 추가. */
  setProjectedShadowEnabled(enabled: boolean): void {
    this._projectedShadowEnabled = enabled;
    if (this._projectedShadow) this._projectedShadow.visible = enabled;
    // VSM 보조 layer 연동 — renderer 레벨에서 shadow pass 토글.
    this.renderer.shadowMap.enabled = enabled;
    this.renderer.shadowMap.needsUpdate = true;
    // Material 재컴파일 (shadow uniform 반영)
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).material) {
        const m = (obj as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach(mm => { mm.needsUpdate = true; });
        else m.needsUpdate = true;
      }
    });
  }

  isProjectedShadowEnabled(): boolean {
    return this._projectedShadowEnabled;
  }

  /** ToolManager.syncMesh에서 projected shadow geometry 재계산 시 호출.
   *  Rust WASM에서 triangle buffer 받아 BufferGeometry로 렌더.
   *  enabled=false면 기존 mesh 숨기기만 하고 작업 skip (성능). */
  updateProjectedShadow(triangleBuffer: Float32Array | null): void {
    if (!this._projectedShadowEnabled) {
      if (this._projectedShadow) this._projectedShadow.visible = false;
      return;
    }
    // Dispose existing geometry (매 update마다 새로 빌드)
    if (this._projectedShadow) {
      this._projectedShadow.geometry.dispose();
    }
    if (!triangleBuffer || triangleBuffer.length === 0) {
      // Nothing to project (empty scene or sun direction invalid)
      if (this._projectedShadow) this._projectedShadow.visible = false;
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(triangleBuffer, 3));
    geo.computeBoundingSphere();
    if (!this._projectedShadow) {
      // 2026-04-23 Phase 2.3: MinEquation 블렌딩으로 중첩 균일화.
      // 표준 alpha blending은 1-(1-α)^N으로 겹칠수록 어두워져서 띠 그라데이션 발생.
      // MinEquation: result = min(src*srcF, dst*dstF). srcF=One, dstF=One이면
      // 픽셀별로 min(shadowColor, bgColor). 처음 그림자 0.72, 같은 자리에 또 그려도
      // min(0.72, 0.72) = 0.72로 균일 유지. fan triangulation 자기중첩/인접 건물
      // 중첩 모두 자동 해결. opacity 파라미터는 MinEquation에서 의미 없음 —
      // 어둠의 정도는 color 값(0.72)으로 직접 제어.
      const mat = new THREE.MeshBasicMaterial({
        // 2026-04-23 Phase 2.4.2 — 0x909090 → 0x707070. MinEquation은
        //   min(shadow, bg)이므로 대비는 "배경색 - shadow색"으로 결정됨.
        //   박스 top(PBR로 밝게 렌더, ≈200)에서 shadow 144는 차이 56으로 옅고,
        //   지면(≈224)에서 차이 80으로 강하게 드러나 불균일. 112로 낮추면
        //   박스 top에서 88, 지면에서 112 → 양쪽 다 뚜렷.
        color: 0x707070,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MinEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,  // 살짝 앞쪽 — ground plane 위에 확실히
      });
      this._projectedShadow = new THREE.Mesh(geo, mat);
      this._projectedShadow.name = 'projected-shadow';
      this._projectedShadow.renderOrder = -4;  // mesh 아래에서 먼저 그려짐
      this._projectedShadow.userData.noPick = true;
      this.scene.add(this._projectedShadow);
    } else {
      this._projectedShadow.geometry = geo;
    }
    // 2026-04-23 Phase 2.4 — Rust가 이미 각 receiver 평면 + RECV_EPS(0.5mm) 로
    //   벡터 buffer에 y값을 기록. 여기서 추가 position.y 오프셋은 불필요하며
    //   오히려 per-receiver 위치를 망가뜨림 (ground=0.5, box top=500.5 그대로 유지해야 함).
    this._projectedShadow.position.y = 0;
    this._projectedShadow.visible = true;
  }

  /** 현재 sun travel 방향 조회 (projected shadow compute에 전달). */
  getSunTravelDirection(): THREE.Vector3 {
    return this._sunTravel.clone();
  }

  /**
   * Sun 방향 설정 — azimuth/elevation 각도(도) 기준.
   *
   *   azimuth   — 북(0°)에서 시계방향. 동=90°, 남=180°, 서=270°.
   *               Three.js 좌표: +Z가 "앞", +X가 오른쪽. 통상 건축에선
   *               북=−Z 라고 가정. 본 함수도 그 규약 따름.
   *   elevation — 수평선(0°)에서 천정(90°)으로.
   *
   * 내부 처리:
   *   · sun position (DirectionalLight) 위치 = 천구상 방향의 scaled 점
   *   · sun travel direction = -light direction (빛이 가는 방향)
   *   · 두 값 모두 업데이트 + renderer shadow camera refresh
   *
   * 호출 후 caller는 syncMesh()를 트리거해 projected shadow 재계산해야 함
   * (SunPanel 등 UI가 담당).
   */
  setSunDirection(azimuthDeg: number, elevationDeg: number): void {
    // clamp
    const az = azimuthDeg;
    const el = Math.max(1, Math.min(89, elevationDeg));  // 지평선 아래/천정 정방향 금지
    const azRad = (az * Math.PI) / 180;
    const elRad = (el * Math.PI) / 180;
    // 천구상 sun 위치 (단위벡터) → 거리 20000mm로 scale.
    //   x = sin(az) * cos(el)  (동서)
    //   y = sin(el)            (상승각)
    //   z = -cos(az) * cos(el) (-Z = 북)
    const dist = 20000;
    const sx = Math.sin(azRad) * Math.cos(elRad) * dist;
    const sy = Math.sin(elRad) * dist;
    const sz = -Math.cos(azRad) * Math.cos(elRad) * dist;
    if (this._dirLight) {
      this._dirLight.position.set(sx, sy, sz);
      this._dirLight.target.position.set(0, 0, 0);
      // Shadow camera frustum은 world-origin 중심 고정 — 태양 방향만 바뀜.
    }
    // Sun travel direction (빛이 scene으로 가는 방향) = -normalize(light position)
    const mag = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (mag > 1e-6) {
      this._sunTravel.set(-sx / mag, -sy / mag, -sz / mag);
    }
  }

  /** 현재 sun azimuth/elevation 조회 (SunPanel 초기값 복원용). */
  getSunAzimuthElevation(): { azimuth: number; elevation: number } {
    // sun travel에서 역산. travel = -sun_pos_unit.
    const t = this._sunTravel;
    // sun position unit vector = (-t.x, -t.y, -t.z)
    const sx = -t.x, sy = -t.y, sz = -t.z;
    const el = Math.asin(Math.max(-1, Math.min(1, sy))) * 180 / Math.PI;
    const az = Math.atan2(sx, -sz) * 180 / Math.PI;
    return {
      azimuth: (az + 360) % 360,
      elevation: el,
    };
  }

  /**
   * Toggle the shell-technique fur overlay on the main mesh. Off by
   * default because it costs N extra draw calls (N = layers). When
   * enabled we attach to the currently-rendered `frontMesh`; if the
   * mesh is rebuilt (syncMesh) the fur gets re-attached automatically.
   */
  setFurEnabled(enabled: boolean): void {
    this._furEnabled = enabled;
    if (enabled) {
      if (!this._fur) this._fur = new FurShell();
      if (this.frontMesh) {
        this._fur.attach(this.frontMesh);
      }
    } else if (this._fur) {
      this._fur.dispose();
    }
  }

  isFurEnabled(): boolean {
    return this._furEnabled;
  }

  // ═══════════════════════════════════════════════════════
  //  Sketch plane visual (Tier 3A)
  // ═══════════════════════════════════════════════════════
  /** Show/hide the sketch plane indicator. Pass null to remove.
   *  Renders a 10m × 10m translucent amber patch + dashed border centered
   *  at the plane origin. Visible across the scene (not depth-tested for
   *  border) so users always know where "up" on the sketch plane is.
   */
  setSketchPlaneVisual(
    plane: { origin: THREE.Vector3; normal: THREE.Vector3; up: THREE.Vector3 } | null,
  ): void {
    // Remove existing
    if (this._sketchPlaneMesh) {
      this.scene.remove(this._sketchPlaneMesh);
      this._sketchPlaneMesh.geometry.dispose();
      (this._sketchPlaneMesh.material as THREE.Material).dispose();
      this._sketchPlaneMesh = null;
    }
    if (this._sketchPlaneBorder) {
      this.scene.remove(this._sketchPlaneBorder);
      this._sketchPlaneBorder.geometry.dispose();
      (this._sketchPlaneBorder.material as THREE.Material).dispose();
      this._sketchPlaneBorder = null;
    }
    if (!plane) return;

    const size = 10000; // 10m square — architectural scale
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffa500,         // amber — distinct from UI highlights (blue/green)
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Orient PlaneGeometry (initial normal = +Z) to match sketch plane normal.
    const initialNormal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(
      initialNormal,
      plane.normal.clone().normalize(),
    );
    mesh.quaternion.copy(q);
    mesh.position.copy(plane.origin);
    mesh.renderOrder = -1;     // behind other geometry
    this.scene.add(mesh);
    this._sketchPlaneMesh = mesh;

    // Dashed border for extra legibility (always drawn on top)
    const half = size / 2;
    // In plane-local coords (before quaternion rotation): ±half on X/Y, z=0
    const corners = [
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3( half, -half, 0),
      new THREE.Vector3( half,  half, 0),
      new THREE.Vector3(-half,  half, 0),
    ].map(v => v.applyQuaternion(q).add(plane.origin));
    const borderGeo = new THREE.BufferGeometry().setFromPoints([
      corners[0], corners[1],
      corners[1], corners[2],
      corners[2], corners[3],
      corners[3], corners[0],
    ]);
    const borderMat = new THREE.LineBasicMaterial({
      color: 0xff8800,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });
    const border = new THREE.LineSegments(borderGeo, borderMat);
    border.renderOrder = 1002;
    this.scene.add(border);
    this._sketchPlaneBorder = border;
  }

  /**
   * Re-attach fur to the current main mesh. Called by `syncMesh` after
   * mesh rebuilds so the shell overlay keeps tracking the puppy.
   */
  private _refreshFur(): void {
    if (this._furEnabled && this._fur && this.frontMesh) {
      this._fur.attach(this.frontMesh);
    }
  }

  private _buildSsaoComposer(): void {
    const w = this.renderer.domElement.clientWidth  || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    try {
      // ━━━ MSAA render target ━━━
      // EffectComposer의 기본 WebGLRenderTarget은 samples=0(AA 꺼짐) —
      // renderer.antialias:true가 무시되어 post-process 경로에서 엣지가
      // 계단 현상으로 흐릿하게 보이는 원인. WebGL2에서 지원되는 MSAA 4x
      // rendertarget을 명시적으로 전달해 LineSegments/mesh 공통 선명도 복원.
      const pr = this.renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, {
        type: THREE.HalfFloatType,   // HDR 톤매핑 정확도 유지
        samples: 4,                   // 4x MSAA — 엣지 aliasing 제거
      });
      const composer = new EffectComposer(this.renderer, rt);
      composer.setPixelRatio(pr);
      const renderPass = new RenderPass(this.scene, this.activeCamera);
      composer.addPass(renderPass);
      const ssao = new SSAOPass(this.scene, this.activeCamera, w, h);
      // Tuned for CAD-ish scene scale (scenes run 1–10k mm). Radius in
      // world units — a large AO sphere keeps the effect visible when
      // the model is zoomed out.
      ssao.kernelRadius = 200;
      ssao.minDistance = 0.001;
      ssao.maxDistance = 0.1;
      composer.addPass(ssao);
      composer.addPass(new OutputPass());
      this._composer = composer;
      this._renderPass = renderPass;
      this._ssaoPass = ssao;
    } catch (e) {
      console.warn('[Viewport] SSAO init failed, reverting to plain render:', e);
      this._ssaoEnabled = false;
    }
  }

  /** Stop the render loop */
  stop() {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }
}
