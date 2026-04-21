import { describe, it, expect, beforeEach } from 'vitest';
import { Clipboard } from './Clipboard';

describe('Clipboard', () => {
  let clip: Clipboard;
  beforeEach(() => { clip = new Clipboard(); });

  it('starts empty', () => {
    expect(clip.get()).toBeNull();
    expect(clip.hasContents()).toBe(false);
  });

  it('stores face IDs on copy', () => {
    clip.copy('faces', [1, 2, 3]);
    const c = clip.get();
    expect(c?.kind).toBe('faces');
    expect(c?.ids).toEqual([1, 2, 3]);
    expect(clip.hasContents()).toBe(true);
  });

  it('empty copy clears contents', () => {
    clip.copy('faces', [1, 2]);
    clip.copy('faces', []);
    expect(clip.hasContents()).toBe(false);
  });

  it('copies defensively (source mutation does not affect buffer)', () => {
    const src = [1, 2, 3];
    clip.copy('faces', src);
    src.push(99);
    expect(clip.get()?.ids).toEqual([1, 2, 3]);
  });

  it('clear removes contents', () => {
    clip.copy('faces', [42]);
    clip.clear();
    expect(clip.hasContents()).toBe(false);
  });

  it('timestamp is recorded', () => {
    const before = Date.now();
    clip.copy('faces', [1]);
    const after = Date.now();
    const ts = clip.get()?.timestamp ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
