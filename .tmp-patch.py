import sys

def patch(path, edits, label):
    b = open(path, 'rb').read()
    crlf = b'\r\n' in b
    text = b.decode('utf-8').replace('\r\n', '\n')
    for i, (old, new) in enumerate(edits):
        n = text.count(old)
        assert n == 1, f'{label} #{i}: 命中 {n} 次\n---old---\n{old[:300]}'
        text = text.replace(old, new, 1)
    open(path, 'wb').write(text.replace('\n', '\r\n' if crlf else '\n').encode('utf-8'))
    print(f'OK  {label}（{"CRLF" if crlf else "LF"}）')

# ── card-craft-plan: expMult param + apply
patch('src/sillytavern/card-workshop/card-craft-plan.ts', [
    # Add param to interface
    (
        "  /** 技能蓝本（S「支配者倒影」）：从败仗里抄来的敌方招式。",
        "  /** 通用经验倍率（C「快速成长」等；缺省 1） */\n  expMult?: number;\n  /** 技能蓝本（S「支配者倒影」）：从败仗里抄来的敌方招式。",
    ),
    # Apply multiplier
    (
        "  const exp = craftExpFor(card.cardTier, rating);",
        "  const exp = Math.round(craftExpFor(card.cardTier, rating) * Math.max(1, input.expMult ?? 1));",
    ),
], 'card-craft-plan expMult')

# ── store: pass expMult
patch('src/ui/stores/game-store.ts', [
    (
        "      talents: playerChar.talents?.list ?? [],\n      lift: {",
        "      talents: playerChar.talents?.list ?? [],\n      expMult: strengthOf('经验倍率', 'expMult'),\n      lift: {",
    ),
], 'store expMult')
