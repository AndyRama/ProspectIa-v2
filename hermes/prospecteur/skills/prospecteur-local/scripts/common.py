"""Profile-local paths and a deliberately small subprocess environment."""
import os
from pathlib import Path


def locations():
    home = Path(os.environ.get('HERMES_HOME', str(Path.home() / '.hermes'))).expanduser().absolute()
    root = home / 'workspace' / 'prospecteur'
    # Refuse pre-existing symlinks rather than write outside this profile.
    for target in (home, home / 'workspace', root, root / 'runtime', root / 'data'):
        if target.is_symlink():
            raise ValueError('Les chemins du profil ne doivent pas être des liens symboliques.')
    return home, root


def environment():
    home, root = locations()
    allowed = ('PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP')
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env['HERMES_HOME'] = str(home)
    env['DATA_DIR'] = str(root / 'data')
    return env
