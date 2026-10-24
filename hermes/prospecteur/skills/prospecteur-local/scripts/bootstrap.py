"""Explicit bootstrap: never run automatically on skill load."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
sys.dont_write_bytecode = True
from common import environment, locations


def main():
    kit = Path(__file__).resolve().parents[1]
    _, root = locations()
    env = environment()
    version = subprocess.check_output(['node', '--version'], env=env, text=True).strip()
    if tuple(map(int, version.lstrip('v').split('.')[:2])) < (24, 10):
        raise ValueError('Node >=24.10 requis.')
    manifest = json.loads((kit / 'SOURCE-MANIFEST.json').read_text())
    runtime = root / 'runtime'
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, expected in manifest['files'].items():
        source = kit / 'engine' / name
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise ValueError('Copie source altérée : ' + name)
        dest = runtime / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
    for name in ('package.json', 'package-lock.json', 'cli.ts'):
        source = kit / 'engine' / name
        if source.exists():
            shutil.copyfile(source, runtime / name)
    subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(root / 'npm-cache')], cwd=runtime, env=env, check=True)
    print(json.dumps({'ready': True, 'runtime': str(runtime), 'sourceCommit': manifest['sourceCommit']}))


if __name__ == '__main__':
    main()
