/**
 * DXF Parser Type Declarations
 */

declare module 'dxf' {
  export function parseString(dxfText: string): DxfDocument;

  interface DxfDocument {
    header?: Record<string, any>;
    blocks?: any[];
    entities?: Entity[] | { value: Entity[] };
    objects?: any;
    tables?: Record<string, any>;
    [key: string]: any;
  }

  interface Entity {
    type: string;
    id?: string | number;
    start?: Vector3Like;
    end?: Vector3Like;
    center?: Vector3Like;
    radius?: number;
    startAngle?: number;
    endAngle?: number;
    vertices?: Vector3Like[];
    points?: Vector3Like[];
    closed?: boolean;
    [key: string]: any;
  }

  interface Vector3Like {
    x: number;
    y: number;
    z?: number;
  }
}

/**
 * dwgdxf Type Declarations
 */

declare module 'dwgdxf' {
  export interface ConvertOptions {
    wasmBase?: string;
  }

  export function convertDwgToDxf(
    dwg: Uint8Array | ArrayBuffer,
    options?: ConvertOptions
  ): Promise<Uint8Array>;

  export function init(options?: ConvertOptions): Promise<void>;

  export const CDN_WASM_BASE: string;
  export const LOCAL_WASM_BASE: string;
}

/**
 * @mlightcad/libredwg-web Type Declarations
 */

declare module '@mlightcad/libredwg-web' {
  export interface MainModule {
    [key: string]: any;
  }

  export class LibreDwg {
    static instance: any;
    private wasmInstance: any;
    private decoder?: TextDecoder;
    private constructor();

    static getInstance(): Promise<LibreDwg>;

    dwg_read_data(fileContent: string | ArrayBuffer, fileType: number): number | undefined;

    dwg_get_version_type(data: any): any;

    dwg_get_codepage(data: any): any;

    [key: string]: any;
  }

  export function createModule(): Promise<MainModule>;
}

/**
 * JSZip Type Declarations
 */

declare module 'jszip' {
  export default class JSZip {
    loadAsync(data: ArrayBuffer | Uint8Array | string): Promise<JSZip>;
    files: { [key: string]: JSZipObject };
    folder(name: string): JSZip | null;
  }

  export interface JSZipObject {
    async(type: 'string'): Promise<string>;
    async(type: 'arraybuffer'): Promise<ArrayBuffer>;
    dir: boolean;
    name: string;
  }
}
