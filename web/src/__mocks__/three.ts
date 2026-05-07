/**
 * Minimal Three.js mock for Vitest unit tests.
 * Only stubs what AXiA 3D actually uses.
 */

export class Vector2 {
  x: number; y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  copy(v: Vector2) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vector2(this.x, this.y); }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; }
  distanceTo(v: Vector2) { return Math.hypot(this.x - v.x, this.y - v.y); }
}

export class Vector3 {
  x: number; y: number; z: number;
  isVector3 = true;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v: Vector3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: Vector3) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s: number) { this.x /= s; this.y /= s; this.z /= s; return this; }
  subVectors(a: Vector3, b: Vector3) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  crossVectors(a: Vector3, b: Vector3) { this.x = a.y*b.z - a.z*b.y; this.y = a.z*b.x - a.x*b.z; this.z = a.x*b.y - a.y*b.x; return this; }
  lengthSq() { return this.x*this.x + this.y*this.y + this.z*this.z; }
  applyMatrix4(_m: any) { return this; }
  dot(v: Vector3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: Vector3) {
    const ax = this.x, ay = this.y, az = this.z;
    this.x = ay * v.z - az * v.y;
    this.y = az * v.x - ax * v.z;
    this.z = ax * v.y - ay * v.x;
    return this;
  }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v: Vector3) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v: Vector3) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx*dx + dy*dy + dz*dz; }
  addScaledVector(v: Vector3, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  setFromMatrixColumn(_matrix: any, _index: number) { return this; }
  project(_camera: any) { return this; }
  toArray() { return [this.x, this.y, this.z]; }
}

// Phase I — Curve 지원 (CatmullRomCurve3 최소 구현: 선형 보간 approximation)
export class CatmullRomCurve3 {
  points: Vector3[];
  closed: boolean;
  constructor(points: Vector3[] = [], closed = false, _curveType = 'centripetal', _tension = 0.5) {
    this.points = points;
    this.closed = closed;
  }
  getPoints(divisions: number): Vector3[] {
    // Test용 최소 구현 — 실제 Catmull-Rom 보간 대신 piecewise linear
    const n = this.points.length;
    if (n === 0) return [];
    if (n === 1) return [this.points[0].clone()];
    const result: Vector3[] = [];
    const steps = Math.max(divisions, n);
    const lastIdx = this.closed ? n : n - 1;
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * lastIdx;
      const k = Math.min(Math.floor(u), lastIdx - 1);
      const t = u - k;
      const a = this.points[k];
      const b = this.points[(k + 1) % n];
      const p = new Vector3(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      );
      result.push(p);
    }
    return result;
  }
}

export class Plane {
  normal = new Vector3(0, 1, 0);
  constant = 0;
  setFromNormalAndCoplanarPoint(n: Vector3, p: Vector3) {
    this.normal.copy(n);
    this.constant = -n.dot(p);
    return this;
  }
}

export class Raycaster {
  ray = {
    origin: new Vector3(),
    direction: new Vector3(),
    intersectPlane(_plane: any, target: Vector3) { return target; },
  };
  setFromCamera(_coords: Vector2, _camera: any) {}
}

export class Color {
  r: number; g: number; b: number;
  private _hex = 0;
  constructor(c?: string | number) { this.r = 0; this.g = 0; this.b = 0; if (c !== undefined) this.set(c); }
  set(c: any) {
    if (typeof c === 'number') { this._hex = c; this.r = ((c >> 16) & 0xff) / 255; this.g = ((c >> 8) & 0xff) / 255; this.b = (c & 0xff) / 255; }
    return this;
  }
  setHex(h: number) { return this.set(h); }
  setRGB(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; this._hex = (Math.round(r*255)<<16)|(Math.round(g*255)<<8)|Math.round(b*255); return this; }
  getHex() { return this._hex; }
  copy(c: Color) { this.r = c.r; this.g = c.g; this.b = c.b; this._hex = c._hex; return this; }
}

export class BufferGeometry {
  attributes: Record<string, any> = {};
  index: any = null;
  setAttribute(name: string, attr: any) { this.attributes[name] = attr; return this; }
  setIndex(index: any) { this.index = index; }
  dispose() {}
  computeVertexNormals() {}
  computeBoundingSphere() {}
  computeBoundingBox() {}
  setFromPoints(_points: any[]) { return this; }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(_w?: number, _h?: number) { super(); }
}

export class Quaternion {
  x = 0; y = 0; z = 0; w = 1;
  setFromUnitVectors(_a: any, _b: any) { return this; }
  copy(q: Quaternion) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
}

export class BufferAttribute {
  array: any;
  itemSize: number;
  constructor(array: any, itemSize: number) { this.array = array; this.itemSize = itemSize; }
}

export class Material { dispose() {} }
export class MeshStandardMaterial extends Material {
  color = new Color();
  constructor(opts: any = {}) { super(); if (opts.color !== undefined) this.color.set(opts.color); }
}
export class MeshBasicMaterial extends Material {
  color = new Color();
  side: any; transparent = false; opacity = 1;
  depthTest = true; depthWrite = true;
  constructor(opts: any = {}) {
    super();
    if (opts.color !== undefined) this.color.set(opts.color);
    if (opts.side !== undefined) this.side = opts.side;
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }
}
export class LineBasicMaterial extends Material {
  color = new Color();
  transparent = false; opacity = 1;
  depthTest = true; depthWrite = true;
  constructor(opts: any = {}) {
    super();
    if (opts.color !== undefined) this.color.set(opts.color);
    if (opts.transparent !== undefined) this.transparent = opts.transparent;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.depthTest !== undefined) this.depthTest = opts.depthTest;
    if (opts.depthWrite !== undefined) this.depthWrite = opts.depthWrite;
  }
}
export class PointsMaterial extends Material { color = new Color(); size = 1; }

export class Object3D {
  children: Object3D[] = [];
  parent: Object3D | null = null;
  visible = true;
  userData: Record<string, any> = {};
  position = new Vector3();
  rotation = { x: 0, y: 0, z: 0 };
  scale = new Vector3(1, 1, 1);
  quaternion = new Quaternion();
  renderOrder = 0;
  add(...children: Object3D[]) {
    for (const child of children) {
      this.children.push(child);
      child.parent = this;
    }
  }
  remove(child: Object3D) {
    const i = this.children.indexOf(child);
    if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
  }
  traverse(callback: (obj: Object3D) => void) {
    callback(this);
    this.children.forEach(c => c.traverse(callback));
  }
  clone(recursive = true): Object3D {
    const c = new (this.constructor as any)();
    c.name = (this as any).name;
    c.visible = this.visible;
    c.userData = JSON.parse(JSON.stringify(this.userData ?? {}));
    c.position = new Vector3(this.position.x, this.position.y, this.position.z);
    c.scale = new Vector3(this.scale.x, this.scale.y, this.scale.z);
    c.rotation = { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z };
    if (recursive) {
      for (const child of this.children) {
        const cc = (child as any).clone ? (child as any).clone(true) : child;
        c.add(cc);
      }
    }
    return c;
  }
}

export class Mesh extends Object3D {
  geometry: BufferGeometry;
  material: Material;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material || new Material();
  }
}

export class Line extends Object3D {
  geometry: BufferGeometry;
  material: Material;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material || new Material();
  }
}

export class LineSegments extends Object3D {
  geometry: BufferGeometry;
  material: Material;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material || new Material();
  }
}

export class Points extends Object3D {
  geometry: BufferGeometry;
  material: Material;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material || new Material();
  }
}

export class Group extends Object3D {
  clear() { this.children.length = 0; return this; }
}

export class Scene extends Object3D {}

export class PerspectiveCamera extends Object3D {
  fov = 75;
  aspect = 1;
  near = 0.1;
  far = 1000;
  matrixWorld = { elements: new Float32Array(16) };
  projectionMatrix = { elements: new Float32Array(16) };
  updateProjectionMatrix() {}
}

export class WebGLRenderer {
  domElement = typeof document !== 'undefined' ? document.createElement('canvas') : ({} as any);
  setSize() {}
  setPixelRatio() {}
  render() {}
  dispose() {}
}

export const DoubleSide = 2;
export const FrontSide = 0;
export const BackSide = 1;
export const AdditiveBlending = 2;
