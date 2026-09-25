import subprocess, sys

# ① c-batch1: 讨价还价 from 叙事意图 to 交易折扣
p = 'src/sillytavern/card-workshop/c-batch1.test.ts'
raw = open(p, 'rb').read().decode('utf-8')
old = "  讨价还价: ['叙事意图'],"
new = "  讨价还价: ['交易折扣'],"
if raw.count(old) == 1:
    raw = raw.replace(old, new)
    open(p, 'wb').write(raw.encode('utf-8'))
    print('OK c-batch1 讨价还价')
else:
    print(f'SKIP c-batch1: {raw.count(old)} hits')

# ② talent-entry.test: add 交易折扣 to pool kind list
p = 'src/sillytavern/card-workshop/talent-entry.test.ts'
raw = open(p, 'rb').read().decode('utf-8')
old = "    '经验倍率',\n  ];"
if raw.count(old) == 1:
    raw = raw.replace(old, "    '经验倍率',\n    '交易折扣',\n  ];")
    open(p, 'wb').write(raw.encode('utf-8'))
    print('OK talent-entry.test 交易折扣')
else:
    print('SKIP talent-entry.test')

# Run tests to check
r = subprocess.run(
    ['npx', 'vitest', 'run', 'src/sillytavern/card-workshop/c-batch1.test.ts', 'src/sillytavern/card-workshop/talent-entry.test.ts'],
    capture_output=True, text=True, timeout=120, cwd='.'
)
for line in r.stdout.split('\n'):
    if '×' in line or 'Tests ' in line:
        print(line.strip())
