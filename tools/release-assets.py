#!/usr/bin/env python3
"""Build public release assets from the npm allowlist and the packaged preset."""
from pathlib import Path
import datetime
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

repo = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else repo / 'dist'
out.mkdir(parents=True, exist_ok=True)
pkg = json.loads((repo / 'package.json').read_text(encoding='utf-8'))
assert pkg['name'] == 'dsh-custom-mode'
# Invoke npm's JavaScript entry with Node, avoiding Windows shell/.cmd resolution.
node = shutil.which('node')
if node is None:
    raise RuntimeError('Node.js is required to build release assets')
npm_cli = subprocess.check_output([node, '-e', """
const fs = require('node:fs'), path = require('node:path');
const candidates = [process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
const found = candidates.find(file => file && fs.existsSync(file));
if (!found) { process.stderr.write('Cannot locate npm-cli.js alongside Node.js\\n'); process.exit(2); }
process.stdout.write(found);
"""], cwd=repo, text=True, encoding='utf-8').strip()
pack = json.loads(subprocess.check_output(
    [node, npm_cli, 'pack', '--ignore-scripts', '--json', '--pack-destination', str(out)],
    cwd=repo, text=True, encoding='utf-8'))[0]
tarball = out / pack['filename']
assert tarball.name == 'dsh-custom-mode-' + pkg['version'] + '.tgz'
# Commit time makes the preset ZIP repeatable locally and in the release workflow.
epoch = int(subprocess.check_output(['git', 'show', '-s', '--format=%ct', 'HEAD'], cwd=repo, text=True))
stamp = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)
manifest = dict(format='dsh-preset', version=1, id='custom', name='自定义模式',
                description='', sourceDshVersion='0.2.0-rc.2',
                exportedAt=stamp.strftime('%Y-%m-%dT%H:%M:%S.000Z'))
files = ['agent.cordis.yml', 'preset.yml', 'prompt.md', 'prompt-reader.mjs', 'prompt-tool.mjs']
preset = out / 'dsh-custom-mode.dshpreset'
with zipfile.ZipFile(preset, 'w', zipfile.ZIP_DEFLATED) as z:
    entries = [('manifest.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode())]
    entries += [('preset/' + name, (repo / 'preset' / name).read_bytes()) for name in files]
    for name, data in entries:
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, data)
checksums = ''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n'
                    for p in [tarball, preset])
(out / 'SHA256SUMS').write_text(checksums, encoding='utf-8')
print(checksums, end='')
