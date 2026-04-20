/**
 * Three.js Viewport — AixxiA-style background + infinite grid shader
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
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
  private _frontColor = 0xe8e8e8;
  private _backColor = 0x8899bb;
  private _edgeColor = 0x333366;
  private _faceOpacity = 1.0;
  private _edgeVisible = true;
  private _profileEdge = true;
  private bgCanvas: HTMLCanvasElement | null = null;

  // Cleanup references
  private _resizeObserver: ResizeObserver | null = null;
  private _boundHandlers: { target: EventTarget; type: string; handler: EventListener }[] = [];
  private _frameId: number | null = null;
  private _onFrameCallbacks: (() => void)[] = [];

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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
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
    const ambient = new THREE.AmbientLight(0x404040, 2);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5000, 10000, 7000);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
    backLight.position.set(-5000, 5000, -7000);
    this.scene.add(backLight);

    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d59, 0.6);
    this.scene.add(hemiLight);

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
      });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
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
  private createInfiniteGrid(): THREE.Group {
    const gridGroup = new THREE.Group();
    gridGroup.userData.isGround = true;
    gridGroup.userData.noPick = true;

    const SMALL = 1000;   // 1m 소그리드
    const BIG = 5000;     // 5m 대그리드
    const EXTENT = 100000; // ±100m 범위 (각 방향)
    const COUNT_SMALL = Math.floor(EXTENT / SMALL); // 소그리드 개수
    const COUNT_BIG = Math.floor(EXTENT / BIG);     // 대그리드 개수

    const resolution = new THREE.Vector2(
      this.container.clientWidth,
      this.container.clientHeight,
    );

    // 소그리드 라인 (1m 간격, 얇고 연함)
    for (let i = -COUNT_SMALL; i <= COUNT_SMALL; i++) {
      const pos = i * SMALL;
      // 대그리드 위치는 건너뜀 (대그리드가 덮어씀)
      if (pos % BIG === 0) continue;

      // X 방향 라인 (Z축을 따라)
      const geoX = new LineGeometry();
      geoX.setPositions([-EXTENT, 0, pos, EXTENT, 0, pos]);
      const matX = new LineMaterial({
        color: 0xaaaaaa,
        linewidth: 0.5,
        transparent: true,
        opacity: 0.3,
        resolution,
      });
      const lineX = new Line2(geoX, matX);
      lineX.computeLineDistances();
      lineX.frustumCulled = false;
      lineX.userData.noPick = true;
      gridGroup.add(lineX);

      // Z 방향 라인 (X축을 따라)
      const geoZ = new LineGeometry();
      geoZ.setPositions([pos, 0, -EXTENT, pos, 0, EXTENT]);
      const matZ = new LineMaterial({
        color: 0xaaaaaa,
        linewidth: 0.5,
        transparent: true,
        opacity: 0.3,
        resolution,
      });
      const lineZ = new Line2(geoZ, matZ);
      lineZ.computeLineDistances();
      lineZ.frustumCulled = false;
      lineZ.userData.noPick = true;
      gridGroup.add(lineZ);
    }

    // 대그리드 라인 (5m 간격, 두껍고 진함)
    for (let i = -COUNT_BIG; i <= COUNT_BIG; i++) {
      const pos = i * BIG;
      // 원점(0)은 축 연장선이 이미 있으므로 건너뜀
      if (pos === 0) continue;

      const geoX = new LineGeometry();
      geoX.setPositions([-EXTENT, 0, pos, EXTENT, 0, pos]);
      const matX = new LineMaterial({
        color: 0x999999,
        linewidth: 1,
        transparent: true,
        opacity: 0.5,
        resolution,
      });
      const lineX = new Line2(geoX, matX);
      lineX.computeLineDistances();
      lineX.frustumCulled = false;
      lineX.userData.noPick = true;
      gridGroup.add(lineX);

      const geoZ = new LineGeometry();
      geoZ.setPositions([pos, 0, -EXTENT, pos, 0, EXTENT]);
      const matZ = new LineMaterial({
        color: 0x999999,
        linewidth: 1,
        transparent: true,
        opacity: 0.5,
        resolution,
      });
      const lineZ = new Line2(geoZ, matZ);
      lineZ.computeLineDistances();
      lineZ.frustumCulled = false;
      lineZ.userData.noPick = true;
      gridGroup.add(lineZ);
    }

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
      // Update LineMaterial resolution for thick axes (cached, no traverse)
      for (const mat of lineMaterials) {
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
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    }

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
        color: useVertexColors ? 0xffffff : 0xe8e8e8,
        side: THREE.FrontSide,
        roughness: 0.6,
        metalness: 0.1,
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
      frontMesh.castShadow = true;
      frontMesh.receiveShadow = true;
      this.meshGroup.add(frontMesh);

      // ── Store reference for color updates ──
      this.frontMesh = frontMesh;

      // BackSide도 vertex color 사용 — 재질 색상이 뒷면에도 표시되도록
      // (바닥면 노말이 반전되지 않은 레거시 모델에서도 재질 색상 표시)
      const backMat = new THREE.MeshBasicMaterial({
        color: useVertexColors ? 0xb0b0c8 : 0x9898b4, // vertex color 곱셈 보정 (약간 밝게)
        side: THREE.BackSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        vertexColors: useVertexColors,
      });
      const backMesh = new THREE.Mesh(geometry, backMat);
      backMesh.name = 'back-mesh';
      this.meshGroup.add(backMesh);

      // 엣지 렌더링: DCEL edge lines 우선, 없으면 EdgesGeometry fallback
      if (edgeLines && edgeLines.length > 0) {
        // DCEL 기반 edge lines (coplanar edge 자동 숨김, Line 도구 선 포함)
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeLines), 3));
        const lineMat = new THREE.LineBasicMaterial({ color: this._edgeColor });
        const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
        lineSegs.name = 'dcel-edges';
        lineSegs.visible = this._edgeVisible;
        this.meshGroup.add(lineSegs);
      } else {
        // Fallback: EdgesGeometry (30° threshold)
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
      const lineMat = new THREE.LineBasicMaterial({
        color: this._edgeColor,
        linewidth: 1,
      });
      const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
      lineSegs.name = 'standalone-edges';
      lineSegs.visible = this._edgeVisible;
      this.meshGroup.add(lineSegs);
    }
  }

  /**
   * Update edge wireframe without full mesh rebuild.
   * Used in delta path when only vertex positions changed (translate/rotate/scale).
   * Replaces only the LineSegments child of meshGroup with new EdgesGeometry.
   */
  updateEdgeLines(edgeLines: Float32Array | null): void {
    if (!this.frontMesh || !edgeLines || edgeLines.length === 0) return;

    // Remove existing edge wireframe from meshGroup
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.meshGroup.children) {
      if (child instanceof THREE.LineSegments) {
        toRemove.push(child);
      }
    }
    for (const obj of toRemove) {
      this.meshGroup.remove(obj);
      (obj as THREE.LineSegments).geometry.dispose();
      if ((obj as THREE.LineSegments).material instanceof THREE.Material) {
        ((obj as THREE.LineSegments).material as THREE.Material).dispose();
      }
    }

    // Recreate EdgesGeometry from current front mesh geometry
    const geometry = this.frontMesh.geometry;
    const edgesMat = new THREE.LineBasicMaterial({ color: this._edgeColor });
    const edgesGeo = new THREE.EdgesGeometry(geometry, 30);
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    edges.visible = this._edgeVisible;
    this.meshGroup.add(edges);
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

  /** 엣지 색상/두께/표시 변경 */
  setEdgeStyle(opts: { color?: number; visible?: boolean; profileEdge?: boolean }) {
    if (opts.color !== undefined) this._edgeColor = opts.color;
    if (opts.visible !== undefined) this._edgeVisible = opts.visible;
    if (opts.profileEdge !== undefined) this._profileEdge = opts.profileEdge;

    for (const child of this.meshGroup.children) {
      if (child instanceof THREE.LineSegments) {
        child.visible = this._edgeVisible;
        (child.material as THREE.LineBasicMaterial).color.setHex(this._edgeColor);
      }
    }
  }

  /** 그리드 표시 on/off */
  setGridVisible(visible: boolean) {
    this.infiniteGrid.visible = visible;
  }

  /** 그리드 색상 변경 */
  setGridColor(hex: number) {
    const color = new THREE.Color(hex);
    this.infiniteGrid.traverse((child) => {
      if (child instanceof Line2) {
        (child.material as LineMaterial).color = color;
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
    const animate = () => {
      this._frameId = requestAnimationFrame(animate);
      for (const cb of this._onFrameCallbacks) cb();
      this.renderer.render(this.scene, this.activeCamera);
    };
    animate();
  }

  /** Stop the render loop */
  stop() {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }
}
