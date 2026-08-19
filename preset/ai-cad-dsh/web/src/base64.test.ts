// src/base64.test.ts
import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

describe('base64 ↔ Uint8Array', () => {
  it('roundtrip 保真', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 255, 65, 66, 67]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual([...bytes]);
  });

  it('解析真实 STEP base64 头', () => {
    // "ISO-10303-21;" 的 base64
    const head = base64ToBytes('SVNPLTEwMzAzLTIxOw==');
    expect(new TextDecoder().decode(head)).toBe('ISO-10303-21;');
  });
});
