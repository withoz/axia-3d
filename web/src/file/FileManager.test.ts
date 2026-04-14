import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileManager } from './FileManager';

// Stub Toast to prevent DOM access
vi.mock('../ui/Toast', () => ({
  Toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Stub debugLog
vi.mock('../utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
}));

/** Build a valid AXIA v2 binary file */
function createAxiaFile(metadata: any, snapshot: Uint8Array): Uint8Array {
  const json = JSON.stringify(metadata);
  const metaBytes = new TextEncoder().encode(json);
  const buf = new Uint8Array(12 + metaBytes.length + snapshot.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x41584941, true); // magic 'AXIA'
  view.setUint32(4, 2, true);          // version
  view.setUint32(8, metaBytes.length, true);
  buf.set(metaBytes, 12);
  buf.set(snapshot, 12 + metaBytes.length);
  return buf;
}

function createMockBridge() {
  return {
    exportSnapshot: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    importSnapshot: vi.fn().mockReturnValue(true),
  } as any;
}

describe('FileManager', () => {
  let bridge: ReturnType<typeof createMockBridge>;
  let fm: FileManager;

  beforeEach(() => {
    bridge = createMockBridge();
    fm = new FileManager(bridge);
  });

  // ── getCurrentFileName ──

  it('default filename is untitled.xia', () => {
    expect(fm.getCurrentFileName()).toBe('untitled.xia');
  });

  // ── setCurrentFileName ──

  it('setCurrentFileName adds .xia extension if missing', () => {
    fm.setCurrentFileName('myproject');
    expect(fm.getCurrentFileName()).toBe('myproject.xia');
  });

  it('setCurrentFileName keeps .xia if already present', () => {
    fm.setCurrentFileName('myproject.xia');
    expect(fm.getCurrentFileName()).toBe('myproject.xia');
  });

  // ── onFileChange ──

  it('onFileChange callback fires on successful load', async () => {
    const cb = vi.fn();
    fm.onFileChange(cb);

    const metadata = { version: 2, timestamp: '2026-01-01T00:00:00Z', name: 'test' };
    const snapshot = new Uint8Array([10, 20, 30]);
    const data = createAxiaFile(metadata, snapshot);

    await fm.loadFromArrayBuffer(data, 'test.xia');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  // ── loadFromArrayBuffer ──

  it('loadFromArrayBuffer parses valid AXIA v2 file', async () => {
    const metadata = { version: 2, timestamp: '2026-01-01T00:00:00Z', name: 'demo' };
    const snapshot = new Uint8Array([42, 43, 44]);
    const data = createAxiaFile(metadata, snapshot);

    const result = await fm.loadFromArrayBuffer(data);

    expect(result).toBe(true);
    expect(bridge.importSnapshot).toHaveBeenCalledTimes(1);
    // The snapshot passed to importSnapshot should match
    const passedSnapshot = bridge.importSnapshot.mock.calls[0][0] as Uint8Array;
    expect(Array.from(passedSnapshot)).toEqual([42, 43, 44]);
    // Filename derived from metadata name
    expect(fm.getCurrentFileName()).toBe('demo.xia');
  });

  it('loadFromArrayBuffer rejects too-small file', async () => {
    const tinyData = new Uint8Array([1, 2, 3]); // less than 12 bytes
    const result = await fm.loadFromArrayBuffer(tinyData);
    expect(result).toBe(false);
  });

  it('loadFromArrayBuffer rejects invalid magic', async () => {
    const badData = new Uint8Array(20);
    const view = new DataView(badData.buffer);
    view.setUint32(0, 0xDEADBEEF, true); // wrong magic
    view.setUint32(4, 2, true);
    view.setUint32(8, 0, true);

    const result = await fm.loadFromArrayBuffer(badData);
    expect(result).toBe(false);
  });

  // ── saveProject ──

  it('saveProject returns true on success', async () => {
    // Mock URL.createObjectURL and download
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    URL.revokeObjectURL = vi.fn();

    const result = await fm.saveProject('test.xia');
    expect(result).toBe(true);
    expect(bridge.exportSnapshot).toHaveBeenCalled();
    expect(fm.getCurrentFileName()).toBe('test.xia');

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it('saveProject returns false when snapshot is null', async () => {
    bridge.exportSnapshot.mockReturnValue(null);
    const result = await fm.saveProject();
    expect(result).toBe(false);
  });

  it('saveProject includes materials when materialLibrary is set', async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    URL.revokeObjectURL = vi.fn();

    const mockLib = {
      getCustom: vi.fn().mockReturnValue([{ id: 'mat1', name: 'Steel' }]),
    };
    fm.setMaterialLibrary(mockLib);

    const result = await fm.saveProject('with-materials.xia');
    expect(result).toBe(true);
    expect(mockLib.getCustom).toHaveBeenCalled();

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  // ── loadFromArrayBuffer with filename ──

  it('loadFromArrayBuffer sets filename from arg', async () => {
    const metadata = { version: 2, timestamp: '2026-01-01T00:00:00Z', name: 'demo' };
    const snapshot = new Uint8Array([42]);
    const data = createAxiaFile(metadata, snapshot);

    await fm.loadFromArrayBuffer(data, 'custom.xia');
    expect(fm.getCurrentFileName()).toBe('custom.xia');
  });

  // ── loadFromArrayBuffer with v1 format ──

  it('loadFromArrayBuffer handles metadata without name', async () => {
    const metadata = { version: 2, timestamp: '2026-01-01T00:00:00Z' };
    const snapshot = new Uint8Array([42]);
    const data = createAxiaFile(metadata as any, snapshot);

    const result = await fm.loadFromArrayBuffer(data);
    expect(result).toBe(true);
  });

  // ── multiple onFileChange callbacks ──

  it('supports multiple onFileChange callbacks', async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    fm.onFileChange(cb1);
    fm.onFileChange(cb2);

    const metadata = { version: 2, timestamp: '2026-01-01T00:00:00Z', name: 'test' };
    const data = createAxiaFile(metadata, new Uint8Array([1]));
    await fm.loadFromArrayBuffer(data, 'test.xia');

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  // ── setMaterialLibrary ──

  it('setMaterialLibrary does not throw', () => {
    expect(() => fm.setMaterialLibrary({ syncFromRust: vi.fn() })).not.toThrow();
  });
});
