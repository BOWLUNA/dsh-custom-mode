#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 .github/workflows/*.yml —— 用**真正的** YAML 解析器，而不是手搓的启发式。

为什么需要它（2026-10-01 实测）：
    改 `.dshpreset` 的 manifest 时，新插的几行写成 4 格缩进，而同一个 `run: |` 里的内容用的是 10 格。
    YAML 的块标量遇到比**块首行**更浅的缩进就结束，后面的行被当成 YAML 解析 ⇒ 整个工作流语法错。
    代价特别高：本地跑测试、跑渲染闸门都看不见，**只有下一次打 tag 时才会发现**，
    而那一刻你已经在发布了。

顺带校验第二件事：`run:` 里 `<<'TAG'` heredoc 的内容按 tag 去缩进之后，必须是**语法正确**的
Python —— YAML 合法不等于里面的代码合法，而那段代码同样只在发布时才跑。

用法（CI 与本地都跑）：
    python3 tools/verify-workflows.py
"""
import io
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print('需要 pyyaml：pip install pyyaml', file=sys.stderr)
    sys.exit(2)

REPO = Path(__file__).resolve().parent.parent
WORKFLOWS = REPO / '.github' / 'workflows'

problems = []
checked = 0

for path in sorted(WORKFLOWS.glob('*.yml')) + sorted(WORKFLOWS.glob('*.yaml')):
    checked += 1
    text = io.open(path, encoding='utf8').read()

    # ① 用真解析器：任何块标量缩进写浅、键写错位，都会在这里露出来。
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as error:
        where = ''
        mark = getattr(error, 'problem_mark', None)
        if mark is not None:
            where = ' @ %d:%d' % (mark.line + 1, mark.column + 1)
        problems.append('%s: YAML 解析失败%s —— %s' % (path.name, where, str(error).split('\n')[0]))
        continue

    # ② heredoc 里的代码真编译一次。
    for job in (doc.get('jobs') or {}).values():
        for step in job.get('steps') or []:
            run = step.get('run')
            if not isinstance(run, str):
                continue
            for match in re.finditer(r"<<'?([A-Za-z_][A-Za-z0-9_]*)'?[^\n]*\n(.*?)\n\s*\1\s*$", run, re.S | re.M):
                tag, body = match.group(1), match.group(2)
                body = '\n'.join(line.strip() if line.strip() == '' else line for line in body.split('\n'))
                indent = min((len(line) - len(line.lstrip()) for line in body.split('\n') if line.strip()), default=0)
                dedented = '\n'.join(line[indent:] if line.strip() else '' for line in body.split('\n'))
                if tag == 'ZIP' or 'import ' in dedented or 'def ' in dedented:
                    try:
                        compile(dedented, '<%s:%s>' % (path.name, tag), 'exec')
                    except SyntaxError as error:
                        problems.append('%s: heredoc «%s» 里的 Python 语法错 —— %s (行 %s)' % (path.name, tag, error.msg, error.lineno))

print('校验 %d 个工作流文件' % checked)
for line in problems:
    print('  ✗ ' + line)
print('结果: %s' % ('全部通过' if not problems else '%d 处问题' % len(problems)))
sys.exit(0 if not problems else 1)
