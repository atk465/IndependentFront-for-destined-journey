/**
 * asset-import-plan.test.ts — 导入计划器的规则钉子 (Asset System v1)
 *
 * 这是全项目**测试密度最高**的模块（§9）: 计划器是一个纯同步函数，所以设计文档
 * 里每一条决策都能变成对普通数据的断言 —— 没有 IndexedDB、没有 fflate、没有
 * crypto。一条规则一个 it，表格的每一行都在这儿有钉子。
 */

import { describe, expect, it } from 'vitest';
import { allocateVariantSlot, planImport } from './asset-import-plan';
import type { DecodedEntry, ExistingRows, ImportManifest } from './asset-import-plan';
import type { AssetType } from './types';

// ═══════════════════════════════════════════════════════════
// 夹具
// ═══════════════════════════════════════════════════════════

/** 字节内容与断言无关（计划器不看字节），固定一个共享实例即可 */
const BYTES = new Uint8Array([1, 2, 3]);

function entry(path: string, hash?: string): DecodedEntry {
  return hash === undefined ? { path, bytes: BYTES } : { path, bytes: BYTES, hash };
}

function noRows(): ExistingRows {
  return { assets: [] };
}

let idSeq = 0;
function assetRow(
  name: string,
  type: AssetType,
  variant?: string,
  hash?: string,
): ExistingRows['assets'][number] {
  idSeq += 1;
  const row: ExistingRows['assets'][number] = { id: `a${idSeq}`, name, type };
  if (variant !== undefined) row.variant = variant;
  if (hash !== undefined) row.hash = hash;
  return row;
}

/** 只取断言关心的三元组，读起来比整行 diff 清楚 */
function slots(
  plan: ReturnType<typeof planImport>,
): { name: string; type: string; variant?: string }[] {
  return plan.assets.map((a) => ({ name: a.name, type: a.type, variant: a.variant }));
}

// ═══════════════════════════════════════════════════════════
// §5.1 路由
// ═══════════════════════════════════════════════════════════

describe('路由 (§5.1)', () => {
  it('mp4 落素材（视频）', () => {
    const plan = planImport([entry('苏婉_头像.mp4')], noRows());
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0].mime).toBe('video/mp4');
  });

  it('不认识的扩展名 → unknown-extension', () => {
    const plan = planImport(
      [entry('源文件.psd'), entry('说明.pdf'), entry('图标.svg'), entry('没有扩展名')],
      noRows(),
    );
    expect(plan.skips.map((s) => s.reason)).toEqual([
      'unknown-extension',
      'unknown-extension',
      'unknown-extension',
      'unknown-extension',
    ]);
    expect(plan.summary.assetsAdded).toBe(0);
  });

  it('svg 刻意被排除（§2.4：能带脚本的文档格式）', () => {
    const plan = planImport([entry('苏婉_头像.svg')], noRows());
    expect(plan.skips[0].reason).toBe('unknown-extension');
  });

  it('__MACOSX / dotfile / 目录条目 → noise', () => {
    const plan = planImport(
      [
        entry('__MACOSX/苏婉_头像.png'),
        entry('__MACOSX/._苏婉_头像.png'),
        entry('.DS_Store'),
        entry('assets/'),
      ],
      noRows(),
    );
    expect(plan.skips.map((s) => s.reason)).toEqual(['noise', 'noise', 'noise', 'noise']);
    expect(plan.summary.noise).toBe(4);
  });

  it('dotfile 只看 basename —— 隐藏目录下的正常媒体照样导入', () => {
    const plan = planImport([entry('.hidden/苏婉_头像.png')], noRows());
    expect(plan.assets).toHaveLength(1);
    expect(plan.skips).toHaveLength(0);
  });

});

// ═══════════════════════════════════════════════════════════
// §2.2 / D7 媒体规则
// ═══════════════════════════════════════════════════════════

describe('媒体规则 (D7)', () => {
  it('mp4 在 立绘 上被拒 —— 抠像立牌需要 alpha', () => {
    const plan = planImport([entry('苏婉_立绘.mp4')], noRows());
    expect(plan.assets).toHaveLength(0);
    expect(plan.skips).toEqual([{ kind: 'skip', path: '苏婉_立绘.mp4', reason: 'mp4-on-立绘' }]);
  });

  it('mp4 在 头像（圆形裁切）与 立绘bg（整幅铺满）上都允许', () => {
    const plan = planImport([entry('苏婉_头像.mp4'), entry('苏婉_立绘bg.mp4')], noRows());
    expect(plan.skips).toHaveLength(0);
    expect(plan.assets.map((a) => a.type)).toEqual(['头像', '立绘bg']);
  });

  it('立绘 上的图片（含 animated WebP 的扩展名）照常通过', () => {
    const plan = planImport([entry('苏婉_立绘.webp'), entry('苏婉_立绘_微笑.png')], noRows());
    expect(plan.assets).toHaveLength(2);
    expect(plan.skips).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// §2.3 / D16 命名不变式
// ═══════════════════════════════════════════════════════════

describe('命名不变式 (D16)', () => {
  it('name 里含类型 token → naming-invariant，计入 namingConflicts', () => {
    const plan = planImport([entry('苏婉_头像_立绘.png')], noRows());
    expect(plan.assets).toHaveLength(0);
    expect(plan.skips).toEqual([
      { kind: 'skip', path: '苏婉_头像_立绘.png', reason: 'naming-invariant' },
    ]);
    expect(plan.summary.namingConflicts).toBe(1);
  });

  it('名字为空（整串就是 token / 前导下划线）也归 naming-invariant', () => {
    const plan = planImport([entry('头像.png'), entry('_头像.png')], noRows());
    expect(plan.skips.map((s) => s.reason)).toEqual(['naming-invariant', 'naming-invariant']);
    expect(plan.summary.namingConflicts).toBe(2);
  });

  it('立绘bg 绝不被当成 立绘 + 变体 bg（整段相等，非子串）', () => {
    const plan = planImport([entry('苏婉_立绘bg.png')], noRows());
    expect(slots(plan)).toEqual([{ name: '苏婉', type: '立绘bg', variant: undefined }]);
  });

  it('名字自己可以带下划线（右锚定保留）', () => {
    const plan = planImport([entry('圣殿_内庭_头像.png')], noRows());
    expect(slots(plan)).toEqual([{ name: '圣殿_内庭', type: '头像', variant: undefined }]);
  });

  it('类型 token 可省，缺省 头像（D1 零仪式路径）', () => {
    const plan = planImport([entry('苏婉.png')], noRows());
    expect(slots(plan)).toEqual([{ name: '苏婉', type: '头像', variant: undefined }]);
  });
});

// ═══════════════════════════════════════════════════════════
// §5.3 / D11 碰撞编号 —— 分配表逐行
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// §6.1 整批分配（不是逐条）
// ═══════════════════════════════════════════════════════════

describe('整批分配 (§6.1)', () => {
  it('空库里三条同名条目 → base / 2 / 3', () => {
    const plan = planImport(
      [entry('苏婉_头像.png', 'h1'), entry('苏婉_头像.png', 'h2'), entry('苏婉_头像.png', 'h3')],
      noRows(),
    );
    expect(plan.assets.map((a) => a.variant)).toEqual([undefined, '2', '3']);
  });

  it('同批内具名变体撞车也逐级换号', () => {
    const plan = planImport(
      [
        entry('苏婉_头像_微笑.png', 'h1'),
        entry('苏婉_头像_微笑.png', 'h2'),
        entry('苏婉_头像_微笑.png', 'h3'),
      ],
      noRows(),
    );
    expect(plan.assets.map((a) => a.variant)).toEqual(['微笑', '微笑 2', '微笑 3']);
  });

});

// ═══════════════════════════════════════════════════════════
// §4.4 / D12 去重
// ═══════════════════════════════════════════════════════════

describe('去重 (§4.4 / D12)', () => {
  it('🔴 去重不是全局的 —— 同一张占位图给 30 个角色必须 30 次都成功', () => {
    const names = Array.from({ length: 30 }, (_, i) => `角色${i}`);
    const plan = planImport(
      names.map((n) => entry(`${n}_头像.png`, 'SAME')),
      noRows(),
    );
    expect(plan.assets).toHaveLength(30);
    expect(plan.summary.duplicatesSkipped).toBe(0);
  });

  it('同一包里两份字节相同的拷贝，第二份被去重', () => {
    const plan = planImport(
      [entry('a/苏婉_头像.png', 'SAME'), entry('b/苏婉_头像.png', 'SAME')],
      noRows(),
    );
    expect(plan.assets).toHaveLength(1);
    expect(plan.summary.duplicatesSkipped).toBe(1);
  });

});

// ═══════════════════════════════════════════════════════════
// §4.4 无哈希降级
// ═══════════════════════════════════════════════════════════

describe('无哈希降级 (hash-unavailable)', () => {
  it('全部带哈希时不告警', () => {
    const plan = planImport([entry('苏婉_头像.png', 'h1'), entry('战斗.mp3', 'h2')], noRows());
    expect(plan.warnings).not.toContain('hash-unavailable');
  });

  it('被跳过的噪音/未知扩展名不触发哈希告警（它们从不参与去重）', () => {
    const plan = planImport([entry('源文件.psd'), entry('.DS_Store')], noRows());
    expect(plan.warnings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// §5.2 / D10 清单
// ═══════════════════════════════════════════════════════════

describe('清单 (§5.2 / D10)', () => {
  it('🔴 清单改不了名字，也改不了类型 —— 身份只认文件名', () => {
    const hostile = {
      assets: {
        '苏婉_头像.png': {
          name: '林月',
          type: '立绘',
          variant: '微笑',
          ext: 'mp4',
          credit: '画师A',
        },
      },
    } as unknown as ImportManifest;
    const plan = planImport([entry('苏婉_头像.png')], noRows(), hostile);
    expect(slots(plan)).toEqual([{ name: '苏婉', type: '头像', variant: undefined }]);
    expect(plan.assets[0].ext).toBe('png');
    // 允许的字段照样生效 —— 证明清单确实被读了，不是整份被忽略
    expect(plan.assets[0].credit).toBe('画师A');
  });

  it('清单里有、包里没有的键静默容忍；包里有、清单里没有的条目照常导入', () => {
    const manifest: ImportManifest = {
      assets: { '不存在的文件_头像.png': { credit: 'X' } },
    };
    const plan = planImport([entry('苏婉_头像.png')], noRows(), manifest);
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0].credit).toBeUndefined();
  });

  it('清单键按 basename 匹配（与拍平口径一致）', () => {
    const manifest: ImportManifest = { assets: { '苏婉_头像.png': { credit: '画师A' } } };
    const plan = planImport([entry('assets/角色/苏婉_头像.png')], noRows(), manifest);
    expect(plan.assets[0].credit).toBe('画师A');
  });

  // ── 取景（2026-07-29 追加）: 显示元数据可以进清单，身份仍然不行 ──

  it('取景随清单进计划', () => {
    const manifest: ImportManifest = {
      assets: { '苏婉_头像.png': { framing: { x: 20, y: 80, scale: 1.75 } } },
    };
    const plan = planImport([entry('苏婉_头像.png')], noRows(), manifest);
    expect(plan.assets[0].framing).toEqual({ x: 20, y: 80, scale: 1.75 });
  });

  it('🔴 敌意取景当场夹逼: NaN / 越界都进不了计划', () => {
    const manifest = {
      assets: {
        'A_头像.png': { framing: { x: Number.NaN, y: 0, scale: 1 } },
        'B_头像.png': { framing: { x: 1e9, y: -50, scale: 999 } },
      },
    } as unknown as ImportManifest;
    const plan = planImport([entry('A_头像.png'), entry('B_头像.png')], noRows(), manifest);
    expect(plan.assets[0].framing).toEqual({ x: 50, y: 0, scale: 1 });
    const b = plan.assets[1].framing!;
    expect(b.x).toBeLessThanOrEqual(100);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.scale).toBeLessThanOrEqual(3);
  });

  it('🔴 非对象的取景一律丢掉 —— 不悄悄翻译成一个默认取景', () => {
    for (const bad of ['居中', 42, [1, 2, 3], null, true]) {
      const manifest = {
        assets: { '苏婉_头像.png': { framing: bad } },
      } as unknown as ImportManifest;
      const plan = planImport([entry('苏婉_头像.png')], noRows(), manifest);
      expect(plan.assets[0].framing, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('🔴 加了 framing 之后，清单**依然**改不了名字与类型', () => {
    const hostile = {
      assets: {
        '苏婉_头像.png': {
          name: '林月',
          type: '立绘',
          variant: '微笑',
          framing: { x: 10, y: 10, scale: 2 },
        },
      },
    } as unknown as ImportManifest;
    const plan = planImport([entry('苏婉_头像.png')], noRows(), hostile);
    expect(slots(plan)).toEqual([{ name: '苏婉', type: '头像', variant: undefined }]);
    expect(plan.assets[0].framing).toEqual({ x: 10, y: 10, scale: 2 });
  });

});

// ═══════════════════════════════════════════════════════════
// §2 / §12 漏写类型 token 的启发式
// ═══════════════════════════════════════════════════════════

describe('疑似漏写类型 (§2 / §12)', () => {
  it('结论与包内顺序无关（复查在全批规划之后）', () => {
    const forward = planImport([entry('苏婉_头像.png'), entry('苏婉_微笑.png')], noRows());
    const backward = planImport([entry('苏婉_微笑.png'), entry('苏婉_头像.png')], noRows());
    expect(forward.warnings).toContain('suspect-missing-type');
    expect(backward.warnings).toContain('suspect-missing-type');
  });

  it('合法的下划线名字（圣殿_内庭）不误报', () => {
    const plan = planImport([entry('圣殿_内庭_头像.png')], noRows());
    expect(plan.warnings).not.toContain('suspect-missing-type');
  });
});

// ═══════════════════════════════════════════════════════════
// 摘要 & 告警
// ═══════════════════════════════════════════════════════════

describe('摘要与告警', () => {
  it('本模块永不产出 oversize / suspect-filename-encoding（分层在 asset-zip）', () => {
    const plan = planImport(
      [entry('苏婉_头像.png', 'h1'), entry('Ã¦ÂÂ˜Ã¦ÂÂ—.mp3', 'h2')],
      noRows(),
    );
    expect(plan.skips.some((s) => s.reason === 'oversize')).toBe(false);
    expect(plan.warnings).not.toContain('suspect-filename-encoding');
  });

  it('告警数组顺序固定（不漏 Set 的插入序）', () => {
    const plan = planImport([entry('苏婉_微笑.png'), entry('苏婉_头像.png')], noRows());
    expect(plan.warnings).toEqual(['hash-unavailable', 'suspect-missing-type']);
  });
});

// ═══════════════════════════════════════════════════════════
// 确定性 & 幂等
// ═══════════════════════════════════════════════════════════

describe('确定性 (§6.1)', () => {
  const mixed: DecodedEntry[] = [
    entry('__MACOSX/._x.png'),
    entry('assets/苏婉_头像.png', 'h1'),
    entry('assets/苏婉_头像.png', 'h2'),
    entry('苏婉_头像_微笑.png', 'h3'),
    entry('苏婉_立绘.mp4', 'h4'),
    entry('audio/战斗.mp3', 'h5'),
    entry('audio/战斗.mp3', 'h6'),
    entry('说明.txt'),
  ];
  const existing: ExistingRows = {
    assets: [assetRow('苏婉', '头像', undefined, 'h0'), assetRow('苏婉', '头像', '微笑', 'h9')],
  };

  it('同一输入跑两次得到深度相等的计划', () => {
    const a = planImport(mixed, existing);
    const b = planImport(mixed, existing);
    expect(a).toEqual(b);
  });

});

describe('幂等 (§9 round-trip 的一半)', () => {
  /** 把一份计划变成"库里已有的行"，模拟 store 照单写完之后的状态 */
  function commit(plan: ReturnType<typeof planImport>, into: ExistingRows): ExistingRows {
    const assets = [...into.assets];
    for (const a of plan.assets) {
      const row = assetRow(a.name, a.type, a.variant, a.entry.hash);
      assets.push(row);
    }
    return { assets };
  }

  const pack: DecodedEntry[] = [
    entry('苏婉_头像.png', 'a1'),
    entry('苏婉_头像_微笑.png', 'a2'),
    entry('苏婉_立绘.webp', 'a3'),
    entry('林月_头像.jpg', 'a4'),
    entry('战斗主题.mp3', 't1'),
    entry('宁静.ogg', 't2'),
  ];

  it('没有哈希时幂等不成立（诚实降级的代价，写下来防止有人以为它坏了）', () => {
    const noHash = pack.map((e) => entry(e.path));
    const after = commit(planImport(noHash, noRows()), noRows());
    const second = planImport(noHash, after);
    expect(second.summary.assetsAdded).toBe(4);
    expect(second.warnings).toContain('hash-unavailable');
  });
});

// ═══════════════════════════════════════════════════════════
// allocateVariantSlot —— 分配器的非文件名入口（改名 / 设为主图共用同一套政策）
// ═══════════════════════════════════════════════════════════

describe('allocateVariantSlot', () => {
  const row = (name: string, type: AssetType, variant?: string) =>
    variant === undefined ? { name, type } : { name, type, variant };

  it('base 位空着就占 base；被占则 max+1（base 隐含算 1 号）', () => {
    expect(allocateVariantSlot('苏婉', '头像', undefined, [])).toEqual({});
    expect(allocateVariantSlot('苏婉', '头像', undefined, [row('苏婉', '头像')])).toEqual({
      variant: '2',
      renumberedFrom: '',
    });
    expect(
      allocateVariantSlot('苏婉', '头像', undefined, [
        row('苏婉', '头像'),
        row('苏婉', '头像', '2'),
        row('苏婉', '头像', '5'),
      ]),
    ).toEqual({ variant: '6', renumberedFrom: '' });
  });

  it('具名变体撞车换号、绝不嵌套', () => {
    const existing = [row('苏婉', '头像', '微笑'), row('苏婉', '头像', '微笑 2')];
    expect(allocateVariantSlot('苏婉', '头像', '微笑', existing)).toEqual({
      variant: '微笑 3',
      renumberedFrom: '微笑',
    });
  });

  it('只看同一个 (name, type)：别的名字/类型不占位', () => {
    const existing = [row('苏婉', '立绘'), row('林清', '头像')];
    expect(allocateVariantSlot('苏婉', '头像', undefined, existing)).toEqual({});
  });

  it('名字里的分隔符不再改变归属 —— 文件名那条路会在这里拍平成另一个组', () => {
    // 这正是 store 侧曾经的缺陷: `圣殿/内庭_头像.png` 经 basenameOf 变成 `内庭_头像.png`，
    // 于是与真正的 `圣殿/内庭` 组对不上，两行都以为 base 位空着。
    const existing = [row('圣殿/内庭', '头像')];
    expect(allocateVariantSlot('圣殿/内庭', '头像', undefined, existing)).toEqual({
      variant: '2',
      renumberedFrom: '',
    });
    // 而 `内庭` 是另一个组，互不影响
    expect(allocateVariantSlot('内庭', '头像', undefined, existing)).toEqual({});
  });
});
