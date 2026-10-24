"""Only supported entry point; no install, credentials or arbitrary paths."""
import json
import subprocess
import sys
sys.dont_write_bytecode = True
from common import environment, locations


def main():
    _, root = locations()
    runtime = root / 'runtime'
    if not (runtime / 'cli.ts').is_file() or not (runtime / 'node_modules/tsx').is_dir():
        print(json.dumps({'error': 'Runtime absent : lancez explicitement scripts/bootstrap.py.'}))
        return 1
    return subprocess.run(['node', '--import', 'tsx', str(runtime / 'cli.ts'), *sys.argv[1:]], cwd=runtime, env=environment()).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
