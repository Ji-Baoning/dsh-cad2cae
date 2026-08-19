// src/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { publish, subscribe, getLatestCallId, getVersion, resetStore } from './store';

describe('store · 单卡片更新', () => {
  beforeEach(() => resetStore());

  it('初始无最新调用', () => {
    expect(getLatestCallId()).toBeNull();
    expect(getVersion()).toBe(0);
  });

  it('publish 记录最新调用并递增版本', () => {
    publish('call-1');
    expect(getLatestCallId()).toBe('call-1');
    expect(getVersion()).toBe(1);
    publish('call-2');
    expect(getLatestCallId()).toBe('call-2');
    expect(getVersion()).toBe(2);
  });

  it('重复 publish 同一调用不重复递增版本', () => {
    publish('call-1');
    publish('call-1');
    expect(getVersion()).toBe(1);
  });

  it('subscribe 收到版本变化通知', () => {
    const seen: number[] = [];
    const unsub = subscribe(() => seen.push(getVersion()));
    publish('call-1');
    publish('call-2');
    unsub();
    publish('call-3');
    expect(seen).toEqual([1, 2]);
  });
});
