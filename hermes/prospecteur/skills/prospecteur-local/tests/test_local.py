"""No network provider calls: isolated real SQLite, separate CLI processes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

KIT = Path(__file__).resolve().parents[1]

class LocalTest(unittest.TestCase):
    def test_01_bootstrap_empty_isolated_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / 'profile'
            env = {**os.environ, 'HERMES_HOME': str(home), 'TURSO_DATABASE_URL': 'libsql://do-not-connect.invalid', 'APIFY_TOKEN': 'not-a-secret'}
            result = subprocess.run([sys.executable, str(KIT / 'scripts/bootstrap.py')], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            runtime = home / 'workspace/prospecteur/runtime'
            self.assertTrue((runtime / 'node_modules/tsx').is_dir())
            self.assertFalse(list(home.rglob('*.sqlite')))
            self.assertFalse((KIT / 'node_modules').exists())
            self.assertFalse((KIT / 'runtime').exists())

BUSINESS = {'name': 'Atelier Andy', 'services': 'Sites web', 'zone': 'Bordeaux', 'tone': 'Sobre', 'prices': 'Sur devis', 'website': '', 'instagram': '', 'facebook': '', 'userName': 'Andy'}

class RuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        cls.base = Path(cls.storage.name)
        env = {**os.environ, 'HERMES_HOME': str(cls.base / 'install')}
        subprocess.run([sys.executable, str(KIT / 'scripts/bootstrap.py')], env=env, capture_output=True, check=True)
        cls.runtime = cls.base / 'install/workspace/prospecteur/runtime'

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / 'home'

    def cli(self, command, payload=None, home=None, fixture=False):
        env = {**os.environ, 'HERMES_HOME': str(home or self.home), 'DATA_DIR': '/must-not-be-used', 'TURSO_DATABASE_URL': 'libsql://production.invalid', 'TURSO_AUTH_TOKEN': 'forbidden', 'APIFY_TOKEN': 'forbidden', 'APP_SECRET': 'forbidden'}
        args = ['node', '--import', 'tsx']
        if fixture:
            args += ['--import', str(KIT / 'tests/provider.mjs')]
        args += [str(self.runtime / 'cli.ts'), command]
        if payload is not None:
            args.append(json.dumps(payload))
        result = subprocess.run(args, cwd=self.runtime, env=env, capture_output=True, text=True)
        return result.returncode, json.loads(result.stdout or '{}'), result.stderr

    def ok(self, command, payload=None, **kwargs):
        code, data, err = self.cli(command, payload, **kwargs)
        self.assertEqual(code, 0, (data, err))
        return data

    def test_02_business_gate_validation_persistence_and_home_isolation(self):
        status = self.ok('status')
        self.assertFalse(status['businessInitialized'])
        self.assertEqual(status['prospects'], 0)
        self.assertNotEqual(self.cli('discover', {'city': 'Bordeaux'})[0], 0)
        self.assertNotEqual(self.cli('init-business', {'name': 'incomplete'})[0], 0)
        self.ok('init-business', BUSINESS)
        self.assertTrue(self.ok('status')['businessInitialized'])
        self.assertFalse(self.ok('status', home=Path(self.tmp.name)/'other')['businessInitialized'])
        self.assertTrue((self.home / 'workspace/prospecteur/data/prospectai.sqlite').is_file())
        self.assertNotEqual(self.cli('reset')[0], 0)
        self.assertNotEqual(self.cli('sql', {'query': 'DELETE FROM prospects'})[0], 0)

    def test_03_discovery_bounds_free_idempotence_and_pools(self):
        self.ok('init-business', BUSINESS)
        query = {'city': 'Bordeaux', 'activity': 'artisan', 'keyword': '', 'engine': 'voice', 'max': 25, 'requestId': 'batch-1'}
        for max_value in [0, -1, 26, 1.5, '2', True]:
            self.assertNotEqual(self.cli('discover', {**query, 'max': max_value}, fixture=True)[0], 0)
        self.assertNotEqual(self.cli('discover', {**query, 'paid': True}, fixture=True)[0], 0)
        self.assertNotEqual(self.cli('discover', {**query, 'requestId': '../bad'}, fixture=True)[0], 0)
        first = self.ok('discover', query, fixture=True)
        self.assertEqual(len(first['prospects']), 25)
        self.assertEqual(first['search']['cost'], 0)
        self.assertFalse(first['search']['query']['paid'])
        calls = self.home / 'workspace/prospecteur/calls.jsonl'
        count = len(calls.read_text().splitlines())
        repeat = self.ok('discover', query, fixture=True)
        self.assertTrue(repeat['cached'])
        self.assertEqual(first['search']['ids'], repeat['search']['ids'])
        second = self.ok('discover', {**query, 'requestId':'batch-2'}, fixture=True)
        self.assertEqual(len(second['prospects']), 5)
        self.assertEqual(len(calls.read_text().splitlines()), count)
        self.assertEqual(len(self.ok('list')['prospects']), 30)
        self.assertEqual(self.ok('show', {'id': first['prospects'][0]['id']})['prospect']['id'], first['prospects'][0]['id'])
        self.assertEqual(self.ok('status')['prospects'], 30)

    def test_04_single_business_no_replace_even_with_existing_records(self):
        self.ok('init-business', BUSINESS)
        self.ok('init-business', BUSINESS)  # exact retry, not an edit
        code, data, _ = self.cli('init-business', {**BUSINESS, 'name': 'Other client'})
        self.assertNotEqual(code, 0)
        self.assertIn('profil', data['error'])
        import sqlite3
        db = self.home / 'workspace/prospecteur/data/prospectai.sqlite'
        with sqlite3.connect(db) as connection:
            self.assertEqual(json.loads(connection.execute("SELECT data FROM settings WHERE key='prospecteur:business'").fetchone()[0]), BUSINESS)
            connection.execute("DELETE FROM settings WHERE key='prospecteur:business'")
            connection.execute("INSERT INTO prospects VALUES ('existing', '{}')")
        self.assertNotEqual(self.cli('init-business', BUSINESS)[0], 0)

    def test_05_audit_drafts_handoff_and_permanent_block(self):
        self.ok('init-business', BUSINESS)
        found = self.ok('discover', {'city':'Bordeaux', 'activity':'artisan', 'engine':'website', 'max':2, 'requestId':'flow'}, fixture=True)
        pid = found['prospects'][0]['id']
        audited = self.ok('analyze', {'id':pid}, fixture=True)['prospect']
        self.assertEqual(audited['audit']['title'], 'Atelier test')
        drafts = self.ok('drafts', {'id':pid})['drafts']
        self.assertEqual(len(drafts), 3)
        self.assertIn('Atelier Andy', drafts[0]['body'])
        handoff = self.ok('handoff', {'id':pid})
        self.assertEqual(handoff['dossier']['myBusiness'], BUSINESS)
        self.assertEqual(handoff['dossier']['prospect']['audit']['title'], 'Atelier test')
        self.assertIn('SOURCES À VÉRIFIER', handoff['prompt'])
        self.assertEqual(len(self.ok('show', {'id':pid})['drafts']), 3)
        self.ok('block', {'id':pid, 'doNotContact':True})
        self.assertTrue(self.ok('show', {'id':pid})['prospect']['doNotContact'])
        self.assertNotEqual(self.cli('block', {'id':pid, 'doNotContact':False})[0], 0)
        calls = self.home / 'workspace/prospecteur/calls.jsonl'
        before = calls.read_text()
        for cmd in ['analyze', 'drafts', 'handoff']:
            code, data, _ = self.cli(cmd, {'id':pid}, fixture=True)
            self.assertNotEqual(code, 0)
            self.assertIn('contacter', data['error'])
        self.assertEqual(calls.read_text(), before)
        self.assertEqual(self.ok('show', {'id':pid})['drafts'], [])
        self.assertEqual(self.ok('show', {'id':pid})['handoffs'], [])
        # Demo fixture inserted directly in test-only SQLite, not through a public import command.
        import sqlite3
        demo = {**audited, 'id':'demo-test', 'demo':True}
        with sqlite3.connect(self.home / 'workspace/prospecteur/data/prospectai.sqlite') as db:
            db.execute('INSERT INTO prospects VALUES (?,?)', (demo['id'], json.dumps(demo)))
        for cmd in ['analyze', 'drafts', 'handoff']:
            self.assertNotEqual(self.cli(cmd, {'id':demo['id']}, fixture=True)[0], 0)
        self.assertEqual(calls.read_text(), before)

    def test_06_public_wrapper_is_sanitized_and_never_autoinstalls(self):
        env = {**os.environ, 'HERMES_HOME':str(self.base / 'install'), 'NODE_OPTIONS':'--require /not-allowed-secret-loader', 'TURSO_DATABASE_URL':'libsql://production.invalid', 'DATA_DIR':'/must-not-be-used'}
        result = subprocess.run([sys.executable, str(KIT / 'scripts/prospecteur.py'), 'status'], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)['businessInitialized'])
        env['HERMES_HOME'] = str(self.home)
        missing = subprocess.run([sys.executable, str(KIT / 'scripts/prospecteur.py'), 'status'], env=env, capture_output=True, text=True)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('bootstrap', missing.stdout)
        self.assertFalse(self.home.exists())

    def test_07_business_text_is_never_migrated_by_native_defaults(self):
        original = {**BUSINESS, 'services':'Un agent vocal et des sites web'}
        self.ok('init-business', original)
        again = self.ok('init-business', original)
        self.assertEqual(again['business'], original)

    def test_08_cannot_initialize_over_orphaned_pool_settings(self):
        self.ok('status')
        import sqlite3
        with sqlite3.connect(self.home / 'workspace/prospecteur/data/prospectai.sqlite') as db:
            db.execute('INSERT INTO settings VALUES (?,?)', ('discoveryPool:orphan', '{"remaining":[]}'))
        code, data, _ = self.cli('init-business', BUSINESS)
        self.assertNotEqual(code, 0)
        self.assertIn('profil', data['error'])

    def test_09_portable_manifest_and_skill_contract(self):
        import hashlib
        import re
        manifest = json.loads((KIT / 'SOURCE-MANIFEST.json').read_text())
        self.assertEqual(manifest['sourceCommit'], '16278988dca04c59f298ff9cbaea8a23f4b8edb7')
        self.assertEqual(len(manifest['files']), 14)
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((KIT / 'engine' / name).read_bytes()).hexdigest(), digest)
        self.assertFalse((KIT / 'engine/server/index.ts').exists())
        for name in ['apify.ts', 'mail.ts']:
            self.assertFalse((KIT / 'engine/server/services' / name).exists())
        self.assertTrue((KIT / 'SKILL.md').is_file(), 'Documentation du skill absente')
        content = (KIT / 'SKILL.md').read_text()
        self.assertTrue(content.startswith('---\n'))
        match = re.search(r'^description: (.+)$', content, re.M)
        assert match is not None
        description = match[1].strip('"')
        self.assertLessEqual(len(description), 60)
        self.assertTrue(description.endswith('.'))
        self.assertIn('AndyRama, Hermes Agent', content)
        for name in ['SKILL.md', 'README.md', 'scripts/bootstrap.py', 'scripts/common.py', 'scripts/prospecteur.py', 'engine/cli.ts']:
            text = (KIT / name).read_text()
            self.assertNotRegex(text, r'/opt/data|(?<![A-Z_])/workspace/|/home/[a-z]')
        package = json.loads((KIT / 'engine/package.json').read_text())
        lock = json.loads((KIT / 'engine/package-lock.json').read_text())
        for name, version in package['dependencies'].items():
            self.assertEqual(lock['packages']['node_modules/'+name]['version'], version)
        self.assertFalse((KIT / 'engine/node_modules').exists())

    def test_11_identifiers_are_not_silently_trimmed(self):
        self.ok('init-business', BUSINESS)
        query = {'city': 'Bordeaux', 'activity': 'artisan', 'engine': 'website', 'max': 1, 'requestId': ' exact-id '}
        code, data, _ = self.cli('discover', query, fixture=True)
        self.assertNotEqual(code, 0, data)
        self.assertEqual(self.ok('status')['prospects'], 0)

    def test_10_wrapper_does_not_write_cache_into_skill(self):
        import shutil
        copy = Path(self.tmp.name) / 'portable/scripts'
        shutil.copytree(KIT / 'scripts', copy, ignore=shutil.ignore_patterns('__pycache__'))
        env = {**os.environ, 'HERMES_HOME':str(self.base / 'install')}
        env.pop('PYTHONDONTWRITEBYTECODE', None)
        env.pop('PYTHONPYCACHEPREFIX', None)
        result = subprocess.run([sys.executable, str(copy / 'prospecteur.py'), 'status'], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((copy / '__pycache__').exists())

if __name__ == '__main__':
    unittest.main()
