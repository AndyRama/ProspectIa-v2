"""Tests locaux du client, sans application ni fournisseur réel."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from tempfile import TemporaryDirectory
from typing import cast

CLIENT = Path(__file__).resolve().parents[1] / 'scripts' / 'prospectia_client.py'

TOKEN = 'fixture-' + 'x' * 40  # synthetic credential, never used outside loopback

class LocalServer(ThreadingHTTPServer):
    calls: list
    reply_body: bytes
    reply_status: int
    reply_type: str
    redirect: str

class Handler(BaseHTTPRequestHandler):
    @property
    def fixture_server(self):
        return cast(LocalServer, self.server)
    def log_message(self, format, *args):
        pass
    def do_GET(self):
        self.fixture_server.calls.append((self.path, dict(self.headers), None))
        body = self.fixture_server.reply_body
        self.send_response(self.fixture_server.reply_status)
        self.send_header('Content-Type', self.fixture_server.reply_type)
        if self.fixture_server.redirect:
            self.send_header('Location', self.fixture_server.redirect)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
        self.fixture_server.calls.append((self.path, dict(self.headers), body))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true,"fixture":true}')

    def do_PATCH(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
        self.fixture_server.calls.append((self.path, dict(self.headers), body))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true,"method":"PATCH"}')

class ClientTests(unittest.TestCase):
    def setUp(self):
        self.server = LocalServer(('127.0.0.1', 0), Handler)
        self.server.calls = []
        self.server.reply_body = b'{"ok":true,"fixture":true}'
        self.server.reply_status = 200
        self.server.reply_type = 'application/json'
        self.server.redirect = ''
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = {'PROSPECTIA_URL': f'http://127.0.0.1:{self.server.server_port}', 'PROSPECTIA_AGENT_TOKEN': TOKEN}
    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_status_uses_dedicated_auth_and_scoped_route(self):
        result = self.invoke('--allow-local', 'status', env=self.connection)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"fixture": true', result.stdout)
        path, headers, body = self.server.calls[0]
        self.assertEqual(path, '/api/agent/status')
        self.assertEqual(headers['Authorization'], 'Bearer ' + TOKEN)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)

    def test_discovery_is_free_scoped_confirmed_and_keeps_request_id(self):
        request_id = 'e9606c4c-7b39-444f-8144-882dc289313c'
        result = self.invoke('--allow-local', 'discover', '--city', 'Bordeaux', '--activity', 'artisan', '--keyword', 'menuisier', '--engine', 'website', '--max', '25', '--request-id', request_id, '--confirm', env=self.connection)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        path, headers, body = self.server.calls[0]
        self.assertEqual(path, '/api/agent/discover')
        self.assertEqual(headers['X-Prospectia-Confirm'], 'write')
        self.assertNotIn('paid', body)
        self.assertEqual(body['max'], 25)
        self.assertEqual(body['requestId'], request_id)
        self.assertEqual(json.loads(result.stdout)['requestId'], request_id)

    def test_discovery_without_confirmation_never_calls_server(self):
        result = self.invoke('--allow-local', 'discover', '--city', 'Bordeaux', '--activity', 'artisan', env=self.connection)
        self.assertEqual(result.returncode, 2)
        self.assertIn('--confirm', result.stdout)
        self.assertFalse(self.server.calls)

    def test_discovery_bounds_and_literal_uuid_fail_before_network(self):
        for extra in [('--max', '26'), ('--max', '0'), ('--request-id', ' UUID-is-not-repaired ')]:
            result = self.invoke('--allow-local', 'discover', '--city', 'Bordeaux', '--activity', 'artisan', '--confirm', *extra, env=self.connection)
            self.assertEqual(result.returncode, 2)
        self.assertFalse(self.server.calls)

    def test_saved_work_read_routes_use_existing_ids(self):
        for args, route in [(('state',), '/state'), (('show', 'import-fixture'), '/prospects/import-fixture'), (('handoff', 'fixture-id'), '/handoffs/fixture-id')]:
            result = self.invoke('--allow-local', *args, env=self.connection)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(self.server.calls[-1][0], '/api/agent' + route)

    def test_prospect_writes_are_scoped_and_require_confirmation(self):
        for command, suffix in [('analyze', 'analyze'), ('drafts', 'drafts'), ('prepare', 'handoffs')]:
            result = self.invoke('--allow-local', command, 'import-fixture', env=self.connection)
            self.assertEqual(result.returncode, 2)
            self.assertIn('--confirm', result.stdout)
            count = len(self.server.calls)
            result = self.invoke('--allow-local', command, 'import-fixture', '--confirm', env=self.connection)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(len(self.server.calls), count + 1)
            path, headers, body = self.server.calls[-1]
            self.assertEqual(path, '/api/agent/prospects/import-fixture/' + suffix)
            self.assertEqual(body, {} if command == 'analyze' else {'engine': 'website'})

    def test_identifiers_cannot_escape_route_or_be_repaired(self):
        for identifier in ['..', '../state', 'x?secret', ' a ', 'x%2fstate', 'x\nheader']:
            result = self.invoke('--allow-local', 'show', identifier, env=self.connection)
            self.assertEqual(result.returncode, 2)
        self.assertFalse(self.server.calls)

    def invoke(self, *args, env=None):
        clean = {k: os.environ[k] for k in ('PATH', 'HOME', 'LANG', 'TMPDIR') if k in os.environ}
        if env:
            clean.update(env)
        return subprocess.run([sys.executable, str(CLIENT), *args], env=clean, capture_output=True, text=True)

    def test_remote_response_cannot_echo_tokens_or_sensitive_fields(self):
        self.server.reply_body = json.dumps({'note': 'echo ' + TOKEN, 'password': 'synthetic-secret', 'nested': {'apiKey': 'synthetic-key'}, 'safe': 'kept'}).encode()
        result = self.invoke('--allow-local', 'status', env=self.connection)
        self.assertEqual(result.returncode, 0)
        for private in (TOKEN, 'synthetic-secret', 'synthetic-key'):
            self.assertNotIn(private, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['safe'], 'kept')

    def test_redirect_is_not_followed_even_within_the_same_origin(self):
        self.server.reply_status = 302
        self.server.redirect = self.connection['PROSPECTIA_URL'] + '/credential-trap'
        result = self.invoke('--allow-local', 'status', env=self.connection)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(len(self.server.calls), 1)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)

    def test_url_and_key_validation_precede_network(self):
        for url in ['http://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/api', 'https://example.invalid?x=1', 'https://example.invalid#x', 'https://example.invalid:444', ' https://example.invalid', 'https://example.invalid\n']:
            result = self.invoke('status', env={**self.connection, 'PROSPECTIA_URL': url})
            self.assertEqual(result.returncode, 2)
            self.assertIn('"ok": false', result.stdout)
        for token in ['', 'short', TOKEN + '\n']:
            result = self.invoke('--allow-local', 'status', env={**self.connection, 'PROSPECTIA_AGENT_TOKEN': token})
            self.assertEqual(result.returncode, 2)
        self.assertFalse(self.server.calls)

    def test_loopback_http_requires_explicit_opt_in(self):
        result = self.invoke('status', env=self.connection)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.server.calls)

    def test_non_json_and_deep_json_fail_safely(self):
        for body in (b'<html>login</html>', b'[' * 1200 + b']' * 1200, b'{"x": NaN}'):
            self.server.reply_body = body
            result = self.invoke('--allow-local', 'status', env=self.connection)
            self.assertEqual(result.returncode, 2)
            self.assertIn('"ok": false', result.stdout)
            self.assertNotIn('Traceback', result.stderr)

    def test_http_errors_do_not_disclose_body_and_are_not_retried(self):
        self.server.reply_status = 500
        self.server.reply_body = (TOKEN + ' server-internal-synthetic-secret').encode()
        result = self.invoke('--allow-local', 'status', env=self.connection)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn('server-internal', result.stdout + result.stderr)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        self.assertEqual(len(self.server.calls), 1)

    def test_missing_connection_is_a_safe_structured_error(self):
        result = self.invoke('status')
        self.assertEqual(result.returncode, 2)
        self.assertIn('"ok": false', result.stdout)
        self.assertIn('PROSPECTIA_URL', json.loads(result.stdout)['error'])
        self.assertNotIn('Traceback', result.stderr)

    def test_personalized_draft_is_saved_by_patch_from_profile_workspace(self):
        with TemporaryDirectory(dir=os.environ.get('TMPDIR')) as home:
            workspace = Path(home) / 'workspace'
            workspace.mkdir()
            body_file = workspace / 'draft.txt'
            body_file.write_text('Bonjour, proposition synthétique à relire.', encoding='utf-8')
            env = {**self.connection, 'HERMES_HOME': home}
            result = self.invoke('--allow-local', 'edit-draft', 'draft-id', '--subject', 'Sujet synthétique', '--body-file', str(body_file), '--confirm', env=env)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['method'], 'PATCH')
            path, headers, body = self.server.calls[-1]
            self.assertEqual(path, '/api/agent/drafts/draft-id')
            self.assertEqual(body, {'subject': 'Sujet synthétique', 'body': body_file.read_text(encoding='utf-8')})
            self.assertEqual(headers['X-Prospectia-Confirm'], 'write')

    def test_draft_body_cannot_read_outside_active_profile_workspace(self):
        with TemporaryDirectory(dir=os.environ.get('TMPDIR')) as home:
            outside = Path(home) / 'private.txt'
            outside.write_text('synthetic-outside-value', encoding='utf-8')
            result = self.invoke('--allow-local', 'edit-draft', 'draft-id', '--subject', 'Sujet', '--body-file', str(outside), '--confirm', env={**self.connection, 'HERMES_HOME': home})
            self.assertEqual(result.returncode, 2)
            self.assertIn('"ok": false', result.stdout)
            self.assertNotIn('synthetic-outside-value', result.stdout + result.stderr)
        self.assertFalse(self.server.calls)

if __name__ == '__main__':
    unittest.main()
