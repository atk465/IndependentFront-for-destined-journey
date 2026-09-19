// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { migrateLegacyKeys } from './storage-migration';

describe('migrateLegacyKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('新键缺席时把第一个非空旧值搬过来，并清掉全部旧键', () => {
    localStorage.setItem('legacy-a', 'A');
    localStorage.setItem('legacy-b', 'B');

    migrateLegacyKeys('current', ['legacy-a', 'legacy-b']);

    expect(localStorage.getItem('current')).toBe('A');
    expect(localStorage.getItem('legacy-a')).toBeNull();
    expect(localStorage.getItem('legacy-b')).toBeNull();
  });

  it('新键已有值时新值赢，只清理旧键', () => {
    localStorage.setItem('current', 'new');
    localStorage.setItem('legacy-a', 'old');

    migrateLegacyKeys('current', ['legacy-a']);

    expect(localStorage.getItem('current')).toBe('new');
    expect(localStorage.getItem('legacy-a')).toBeNull();
  });

  it('旧键全部缺席时是无害空转', () => {
    migrateLegacyKeys('current', ['legacy-a']);

    expect(localStorage.getItem('current')).toBeNull();
  });

  it('旧键值为空串时照搬（忠实迁移用户存过的值）', () => {
    localStorage.setItem('legacy-empty', '');

    migrateLegacyKeys('current', ['legacy-empty']);

    // 空串也算「在场」——搬空串等价于用户存过空值，照搬
    expect(localStorage.getItem('current')).toBe('');
    expect(localStorage.getItem('legacy-empty')).toBeNull();
  });
});
