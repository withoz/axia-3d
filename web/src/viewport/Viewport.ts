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

export class Viewport {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly orthoCamera: THREE.OrthographicCamera;

  // View mode
  private _viewMode: ViewMode = '3d';
  private orthoZoom = 10000;  // ortho camera frustum half-size

  // Scene objects
  private infiniteGrid: THREE.Group;
  private meshGroup: THREE.Group;
  private axisGroup!: THREE.Group;  // 축 화살표+라벨 그룹 (줌 비례 스케일)
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
  private _edgeColor = 0x1a1a2e;
  /** ADR-007 Phase 4 — CAD 모드: single-sided 렌더링 (BackSide mesh 생략, GPU ↑) */
  private _singleSidedRender = false;
  private _faceOpacity = 1.0;
  private _edgeVisible = true;
  private _profileEdge = true;
  /** Edge line width in CSS pixels (world-space, respects DPR). Controls the
   *  `LineMaterial.linewidth` used by LineSegments2 — unlike LineBasicMaterial,
   *  this actually takes effect on all platforms. Range: 1 ~ 5 from StylePanel.
   *  2026-04-22: 1.5 → 2.0 기본값 상향. 고양이/강아지처럼 곡면 많은 모델에서
   *  형태감 식별력 향상. */
  private _edgeWidth = 2.0;
  /** Cache of Mesh-edge LineMaterials so resize + width changes are fast.
   *  Separate from the axis LineMaterials (lineMaterials arr in constructor). */
  private _meshEdgeMaterials: LineMaterial[] = [];
  private bgCanvas: HTMLCanvasElement | null = null;

  // Cleanup references
  private _resizeObserver: ResizeObserver | null = null;
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
  // flat surface에 noise pattern(깃털·해치 모양)을 만드는 고유 artifact를
  // 가짐. CAD 작업에서는 깔끔한 solid face가 더 가치 있으므로 기본 off.
  // View 메뉴 → "AO (주변광 차폐) 토글" 로 필요 시 활성화 가능.
  private _ssaoEnabled: boolean = false;

  // ═══ Fur shell overlay (toggle-able; off by default) ═══
  private _fur: FurShell | null = null;
  private _furEnabled: boolean = false;

  // ═══ Blob shadow (light-weight ground shadow) ═══
  private _blobShadow: THREE.Mesh | null = null;
  private _blobShadowEnabled: boolean = true;  // 기본 on — 깔끔+가벼움

  // ═══ Projected shadow (SketchUp-style matrix projection) ═══
  private _projectedShadow: THREE.Mesh | null = null;
  private _projectedShadowEnabled: boolean = false;
  private _sunTravel = new THREE.Vector3(-0.408, -0.816, -0.408);

  // ═══ Directional light (Phase 2 VSM) ═══
  // castShadow은 기본 false, setProjectedShadowEnabled(true) 시 켜짐.
  // VSM shadow는 Projected와 함께 "건축 모드" 일괄 관리.
  private _dirLight: THREE.DirectionalLight | null = null;

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

  constructor(container: HTMLElement) {
    this.container = container;

    // ── Renderer (AixxiA style) ──
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
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
    // 기본 off — 사용자가 "건축 그림자 (Projected)" 켤 때 자동 같이 켜짐.
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    // ACESFilmic gives PBR materials a natural photographic look under IBL;
    // the previous NoToneMapping clipped highlights whenever roughness was
    // low. Exposure 1.0 is the neutral baseline.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 2026-04-22: exposure 1.0 → 0.9. IBL + roughness 0.65 조합에서 하이라이트가
    // 과하게 밝아지는 현상을 차분히 내림. 면-면 경계선 가시화를 돕는다.
    this.renderer.toneMappingExposure = 0.9;
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
    const ambient = new THREE.AmbientLight(0x303030, 0.6);
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
    shadow.mapSize.set(1024, 1024);
    shadow.camera.left   = -15000;
    shadow.camera.right  =  15000;
    shadow.camera.top    =  15000;
    shadow.camera.bottom = -15000;
    shadow.camera.near   = 100;
    shadow.camera.far    = 60000;
    shadow.bias          = 0.0;
    shadow.normalBias    = 0.0;
    shadow.radius        = 12;
    shadow.blurSamples   = 17;
    this._dirLight = dirLight;
    this.scene.add(dirLight);

    // Back/fill light — no shadow (performance; two shadow-casting lights
    // doubles depth-pass cost without much visual gain).
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-6000, 4000, -8000);
    this.scene.add(backLight);

    // Subtle sky/ground tint on top of IBL — keeps the under-belly of
    // upside-facing surfaces from going fully dark when IBL contribution
    // is low (edge-on to the env map).
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d59, 0.35);
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

    // ── Blob shadow (실제 shadow map 대체) ───────────────────────────
    // 단일 PlaneGeometry + radial gradient shader. syncMesh 시 bbox에 맞춰
    // 위치/크기 갱신. shadow map rendering 없이 "객체 아래 soft grounding"
    // 효과만 내어 CAD preview에 가장 부담 없이 공간감 제공.
    this._createBlobShadow();

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
        uSmallColor:   { value: new THREE.Color(0x888888) },
        uBigColor:     { value: new THREE.Color(0x555555) },
        uSmallAlpha:   { value: 0.45 },
        uBigAlpha:     { value: 0.75 },
        uFadeNear:     { value: 20000.0 },  // 20m부터 fade 시작
        uFadeFar:      { value: 80000.0 },  // 80m에서 완전 사라짐
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

    // ── Wheel: 줌 ──
    track(canvas, 'wheel', ((e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      if (this._viewMode !== '3d') {
        this.orthoZoom = Math.max(10, Math.min(200000, this.orthoZoom * factor));
        this.updateOrthoCamera();
      } else {
        this.spherical.radius = Math.max(100, Math.min(500000000,
          this.spherical.radius * factor));
        this.updateCameraFromSpherical();
      }
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
  ) {
    // ── 1) 기존 geometry + material 완전 제거 ──
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

    // ── 2) Face geometry (면이 있을 때만) ──
    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array(positions), 3));
      geometry.setAttribute('normal',
        new THREE.BufferAttribute(new Float32Array(normals), 3));
      geometry.setIndex(
        new THREE.BufferAttribute(new Uint32Array(indices), 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      // ── Smooth normals: 인접 면 각도 < 30°이면 법선 보간 (원통 등 곡면 부드럽게) ──
      this.smoothNormals(geometry, 30);

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
      if (firstTex) {
        const uvs = computeUVsFromBuffers(
          geometry.getAttribute('position').array as Float32Array,
          geometry.getAttribute('normal').array as Float32Array,
          {
            mode: firstTex.projection,
            scale: firstTex.scale,
            rotation: firstTex.rotation ?? 0,
          } as UVProjectionParams,
        );
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        // Kick off async texture load; refresh material when ready.
        this.applyTextureAsync(firstTex);
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
      // VSM 보조 layer를 위해 shadow 기능 활성. renderer.shadowMap.enabled가
      // false면 GPU 측에서 shadow pass 생략하므로 기본 상태에서 비용 없음.
      frontMesh.castShadow = true;
      frontMesh.receiveShadow = true;
      this.meshGroup.add(frontMesh);

      // ── Store reference for color updates ──
      this.frontMesh = frontMesh;

      // If fur was enabled before this mesh rebuild, re-attach so the
      // shell overlay tracks the new geometry automatically.
      this._refreshFur();

      // Blob shadow (light-weight ground shadow) 위치·크기 갱신.
      this._updateBlobShadow();

      // ADR-007 Phase 4 — CAD 모드 (single-sided) 활성화 시 BackSide mesh 생략
      // 이점:
      //   - 렌더 draw call 절반 (face 당 front + back → front only)
      //   - GPU 픽셀 셰이딩 작업량 감소 (back-face culling 정상 동작)
      //   - 외부=Front 불변식 가정 시 뒤쪽 면은 사용자가 볼 일 없음
      // 단점:
      //   - 볼륨 안에서 바라보면 면이 안 보임 (원칙상 OK — 일관된 "outer=front")
      //   - 뒤집힌 레거시 모델은 수동 flip 필요
      if (!this._singleSidedRender) {
        const backMat = new THREE.MeshBasicMaterial({
          color: useVertexColors ? 0xb0b0c8 : 0x9898b4,
          side: THREE.BackSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
          vertexColors: useVertexColors,
        });
        const backMesh = new THREE.Mesh(geometry, backMat);
        backMesh.name = 'back-mesh';
        this.meshGroup.add(backMesh);
      }

      // 엣지 렌더링: DCEL edge lines 우선, 없으면 EdgesGeometry fallback.
      //
      // 2026-04-22 (단순화): Line2 + LineMaterial 조합은 두꺼운 선을 지원하지만
      // 여러 artifact(z-fighting, 두 줄 보임, dithering)를 유발해 원래의 단순한
      // LineBasicMaterial로 되돌림. WebGL은 linewidth가 1px로 고정되지만 그게
      // 오히려 CAD 와이어프레임에 이상적인 깔끔함.
      if (edgeLines && edgeLines.length > 0) {
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeLines), 3));
        const lineMat = new THREE.LineBasicMaterial({ color: this._edgeColor });
        const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
        lineSegs.name = 'dcel-edges';
        lineSegs.visible = this._edgeVisible;
        this.meshGroup.add(lineSegs);
      } else {
        const edgesMat = new THREE.LineBasicMaterial({ color: this._edgeColor });
        const edgesGeo = new THREE.EdgesGeometry(geometry, 30);
        const edges = new THREE.LineSegments(edgesGeo, edgesMat);
        edges.visible = this._edgeVisible;
        this.meshGroup.add(edges);
      }
    }

    // ── 4) Standalone edge lines (면 없이 Line 도구로 그린 선) ──
    if (positions.length === 0 && edgeLines && edgeLines.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeLines), 3));
      const lineMat = new THREE.LineBasicMaterial({ color: this._edgeColor });
      const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
      lineSegs.name = 'standalone-edges';
      lineSegs.visible = this._edgeVisible;
      this.meshGroup.add(lineSegs);
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
    const newNormals = new Float32Array(vertCount * 3);

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
        } else {
          // fallback: 원래 노멀 유지
          newNormals[vi * 3] = normAttr.getX(vi);
          newNormals[vi * 3 + 1] = normAttr.getY(vi);
          newNormals[vi * 3 + 2] = normAttr.getZ(vi);
        }
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

  /** Perform a raycast pick */
  pick(screenX: number, screenY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.activeCamera as THREE.PerspectiveCamera);
    // FrontSide + BackSide 메시 모두 raycast 대상
    // → 바닥면(노말이 위를 향함)도 아래에서 클릭 가능
    const meshes = this.meshGroup.children.filter(c => c instanceof THREE.Mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    // ✱ Bug fix (2026-04-19): 이전 구현은 FrontSide를 선호하려고 BackSide hit을
    // 스킵했으나, front/back 메시가 *같은 geometry를 공유*하므로 정면 hit은 frontMesh,
    // 뒷면 hit은 backMesh로 동일 거리에 기록됨. 따라서 hits[0]이 BackSide일 때
    // "다음 FrontSide"는 뒤쪽 **다른 오브젝트**의 정면이 되어 엉뚱한 오브젝트가
    // 선택됨. 거리 정렬된 hits[0]을 그대로 사용한다 (front/back 무관하게 가장 가까운 면).
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

    // 화면 상 엣지까지 거리로 판정 (edge가 face와 같은 평면상이거나 앞에 있을 때만)
    const rect = this.renderer.domElement.getBoundingClientRect();
    const edgeProj = edgeHit.point.clone().project(cam);
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

  /** Perform a raycast pick on wireframe edges (LineSegments).
   *  Returns the intersection with `index` = line segment index (for edge map lookup).
   *  Threshold is automatically computed from camera distance for consistent screen-space feel. */
  pickEdge(screenX: number, screenY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.activeCamera as THREE.PerspectiveCamera);

    // 카메라 거리에 비례한 threshold (약 화면의 1% 정도)
    const cam = this.activeCamera as THREE.PerspectiveCamera;
    const camDist = cam.position.length();
    const dynamicThreshold = Math.max(camDist * 0.005, 10);

    const prevThreshold = this.raycaster.params.Line?.threshold ?? 1;
    if (!this.raycaster.params.Line) this.raycaster.params.Line = { threshold: 1 };
    this.raycaster.params.Line.threshold = dynamicThreshold;

    const lineSegments = this.meshGroup.children.filter(c => c instanceof THREE.LineSegments);
    const hits = this.raycaster.intersectObjects(lineSegments, false);

    // threshold 복원
    this.raycaster.params.Line.threshold = prevThreshold;

    return hits.length > 0 ? hits[0] : null;
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

  start() {
    // Build the post-processing composer on first start if SSAO is on
    // and we haven't built it yet. Lazy so any headless test that
    // instantiates Viewport without calling start() skips WebGL work.
    if (this._ssaoEnabled && !this._composer) {
      this._buildSsaoComposer();
    }
    const animate = () => {
      this._frameId = requestAnimationFrame(animate);
      for (const cb of this._onFrameCallbacks) cb();
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

  /** 그림자 on/off 토글 (blob shadow 방식).
   *  Real shadow map 사용 안 함 — 객체 아래 soft radial gradient plane만
   *  표시/숨김. 항상 가볍고 scanline artifact 없음. */
  setShadowEnabled(enabled: boolean): void {
    this._blobShadowEnabled = enabled;
    if (this._blobShadow) this._blobShadow.visible = enabled;
  }

  isShadowEnabled(): boolean {
    return this._blobShadowEnabled;
  }

  /** Blob shadow plane 생성 (한 번만). 이후 _updateBlobShadow()로 위치·크기 갱신. */
  private _createBlobShadow(): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uOpacity: { value: 0.35 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform float uOpacity;
        void main() {
          // 중심 (0.5, 0.5)에서 가장자리(1.0)로 갈수록 alpha 0.
          // smoothstep으로 부드러운 경계. 타원형 fade.
          vec2 c = vUv - 0.5;
          float d = length(c) * 2.0;  // [0, 1] in circle
          float alpha = (1.0 - smoothstep(0.3, 1.0, d)) * uOpacity;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
        }
      `,
    });
    this._blobShadow = new THREE.Mesh(geo, mat);
    this._blobShadow.rotation.x = -Math.PI / 2;  // XZ plane
    this._blobShadow.position.y = 0.5;            // 약간 띄워 z-fighting 회피
    this._blobShadow.renderOrder = -5;            // mesh 보다 먼저
    this._blobShadow.visible = this._blobShadowEnabled;
    this._blobShadow.userData.noPick = true;
    this.scene.add(this._blobShadow);
  }

  /** frontMesh bbox XZ에 맞춰 blob shadow 위치·크기 갱신.
   *  syncMesh (updateMesh)에서 매번 호출. */
  private _updateBlobShadow(): void {
    if (!this._blobShadow || !this.frontMesh) return;
    const geo = this.frontMesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) { this._blobShadow.visible = false; return; }
    const width = Math.max(100, bb.max.x - bb.min.x);
    const depth = Math.max(100, bb.max.z - bb.min.z);
    const cx = (bb.max.x + bb.min.x) / 2;
    const cz = (bb.max.z + bb.min.z) / 2;
    // Scale: bbox보다 살짝 여유롭게 — 가장자리 fade가 자연스럽게
    this._blobShadow.scale.set(width * 1.6, depth * 1.6, 1);
    this._blobShadow.position.set(cx, 0.5, cz);
    this._blobShadow.visible = this._blobShadowEnabled;
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
        color: 0xb8b8b8,  // 밝은 회색 — min 연산에서 배경(흰/연회색) 대비 어두워짐
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
      this._projectedShadow.renderOrder = -4;  // blob shadow(-5)보다 위, mesh 아래
      this._projectedShadow.userData.noPick = true;
      this.scene.add(this._projectedShadow);
    } else {
      this._projectedShadow.geometry = geo;
    }
    this._projectedShadow.position.y = 0.8;  // z-fighting 회피
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
