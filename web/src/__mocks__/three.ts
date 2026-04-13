/**
 * Minimal Three.js mock for Vitest unit tests.
 * Only stubs what AXiA 3D actually uses.
 */

export class Vector2 {
  x: number; y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  copy(v: Vector2) { this.x = v.x; this.y = v.y; return this; }
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
  project(_camera: any) { return this; }
  toArray() { return [this.x, this.y, this.z]; }
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
  ray = { origin: new Vector3(), direction: new Vector3() };
  setFromCamera(_coords: Vector2, _camera: any) {}
}

export class Color {
  r: number; g: number; b: number;
  constructor(c?: string | number) { this.r = 0; this.g = 0; this.b = 0; if (c) this.set(c); }
  set(_c: any) { return this; }
}

export class BufferGeometry {
  attributes: Record<string, any> = {};
  index: any = null;
  setAttribute(name: string, attr: any) { this.attributes[name] = attr; return this; }
  setIndex(index: any) { this.index = index; }
  dispose() {}
  computeVertexNormals() {}
}

export class BufferAttribute {
  array: any;
  itemSize: number;
  constructor(array: any, itemSize: number) { this.array = array; this.itemSize = itemSize; }
}

export class Material { dispose() {} }
export class MeshStandardMaterial extends Material { color = new Color(); }
export class MeshBasicMaterial extends Material { color = new Color(); }
export class LineBasicMaterial extends Material { color = new Color(); }

export class Object3D {
  children: Object3D[] = [];
  parent: Object3D | null = null;
  visible = true;
  userData: Record<string, any> = {};
  position = new Vector3();
  rotation = { x: 0, y: 0, z: 0 };
  scale = new Vector3(1, 1, 1);
  add(child: Object3D) { this.children.push(child); child.parent = this; }
  remove(child: Object3D) {
    const i = this.children.indexOf(child);
    if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
  }
  traverse(callback: (obj: Object3D) => void) {
    callback(this);
    this.children.forEach(c => c.traverse(callback));
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

export class LineSegments extends Object3D {
  geometry: BufferGeometry;
  material: Material;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material || new Material();
  }
}

export class Group extends Object3D {}

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

export class Points extends Object3D {
  geometry: BufferGeometry;
  material: Material;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    this.geometry = geometry || new BufferGeometry();
    this.material = material || new Material();
  }
}

export const DoubleSide = 2;
export const FrontSide = 0;
export const BackSide = 1;
export const AdditiveBlending = 2;
