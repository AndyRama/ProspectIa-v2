"""Client borné pour l'API dédiée ProspectIa, sans authentification de session."""
from __future__ import annotations
import argparse
import ipaddress
import json
import os
import re
from pathlib import Path
from uuid import uuid4
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_RESPONSE_BYTES = 10 * 1024 * 1024

class ClientError(Exception):
    """Erreur affichable sans identifiants ni corps de réponse distant."""

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def safe_result(value, token, depth=0):
    if depth > 64:
        raise ClientError('Réponse JSON trop imbriquée ; aucun résultat utilisé.')
    if isinstance(value, dict):
        return {key.replace(token, '[REDACTED]'): '[REDACTED]' if re.search(r'password|passwd|secret|token|cookie|authorization|api[_-]?key|encryption[_-]?key', key, re.I)
                else safe_result(item, token, depth + 1) for key, item in value.items()}
    if isinstance(value, list):
        return [safe_result(item, token, depth + 1) for item in value]
    if isinstance(value, str):
        return value.replace(token, '[REDACTED]')
    return value

def reject_constant(_value):
    raise ValueError('Non-finite JSON number')

def connection(allow_local=False):
    raw = os.environ.get('PROSPECTIA_URL', '')
    if not raw:
        raise ClientError('Configurer PROSPECTIA_URL dans ce profil.')
    try:
        parsed = urlsplit(raw)
        port = parsed.port
        local = parsed.hostname == 'localhost'
        if parsed.hostname:
            try:
                local = ipaddress.ip_address(parsed.hostname).is_loopback
            except ValueError:
                pass
        if (raw != raw.strip() or any(ord(c) < 33 for c in raw) or
                not parsed.hostname or parsed.username is not None or parsed.password is not None or
                parsed.query or parsed.fragment or parsed.path not in ('', '/') or
                (parsed.scheme != 'https' and not (allow_local and local and parsed.scheme == 'http')) or
                (parsed.scheme == 'https' and port not in (None, 443))):
            raise ValueError()
    except ValueError:
        raise ClientError('PROSPECTIA_URL doit désigner la racine HTTPS de votre application ; HTTP est réservé au loopback avec --allow-local.') from None
    token = os.environ.get('PROSPECTIA_AGENT_TOKEN', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,512}', token):
        raise ClientError('Configurer une clé PROSPECTIA_AGENT_TOKEN dédiée et valide dans ce profil.')
    return raw.rstrip('/'), token

def read_draft_body(filename):
    home = os.environ.get('HERMES_HOME')
    if not home:
        raise ClientError('HERMES_HOME requis pour lire un brouillon dans le profil actif.')
    workspace = (Path(home) / 'workspace').resolve()
    candidate = Path(filename)
    if not candidate.is_absolute():
        candidate = workspace / candidate
    try:
        candidate = candidate.resolve(strict=True)
        if not candidate.is_relative_to(workspace) or not candidate.is_file():
            raise ClientError('Le brouillon doit être un fichier du workspace du profil actif.')
        with candidate.open('rb') as source:
            raw = source.read(80001)
        if len(raw) > 80000:
            raise ClientError('Brouillon trop volumineux.')
        body = raw.decode('utf-8')
        if len(body) > 20000:
            raise ClientError('Brouillon limité à 20000 caractères.')
        return body
    except (OSError, UnicodeError):
        raise ClientError('Brouillon inaccessible ou encodage UTF-8 invalide.') from None

def request(path, *, allow_local=False, payload=None, confirm=False, method=None):
    base, token = connection(allow_local)
    headers = {'Accept': 'application/json'}
    headers['Authorization'] = f'Bearer {token}'
    data = None
    if payload is not None:
        if not confirm:
            raise ClientError('Écriture refusée : accord explicite et option --confirm requis.')
        data = json.dumps(payload, allow_nan=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
        headers['X-ProspectIA-Confirm'] = 'write'
    req = Request(base + '/api/agent' + path, data=data, headers=headers, method=method or ('POST' if data is not None else 'GET'))
    try:
        with build_opener(NoRedirect()).open(req, timeout=90) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ClientError('Réponse trop volumineuse ; aucun résultat partiel utilisé.')
            if response.headers.get_content_type() != 'application/json':
                raise ClientError('Réponse non JSON ; vérifier l’adresse et le déploiement de l’API.')
            value = json.loads(raw, parse_constant=reject_constant)
            if not isinstance(value, dict):
                raise ClientError('Réponse JSON inattendue ; objet API requis.')
            return safe_result(value, token)
    except HTTPError as exc:
        exc.close()
        raise ClientError(f'API refusée (HTTP {exc.code}) ; aucune nouvelle tentative automatique.') from None
    except (URLError, TimeoutError, OSError):
        raise ClientError('Connexion impossible ou expirée ; aucune nouvelle tentative automatique.') from None
    except (UnicodeError, ValueError, RecursionError):
        raise ClientError('Réponse JSON invalide ; aucun contenu distant exécuté.') from None

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-local', action='store_true', help='HTTP sur loopback uniquement, pour installation locale/test.')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status')
    commands.add_parser('state')
    for name in ('show', 'handoff', 'analyze', 'drafts', 'prepare'):
        command = commands.add_parser(name)
        command.add_argument('id')
        if name in ('analyze', 'drafts', 'prepare'):
            command.add_argument('--confirm', action='store_true')
        if name in ('drafts', 'prepare'):
            command.add_argument('--engine', choices=('website', 'menu', 'voice'), default='website')
    discover = commands.add_parser('discover')
    discover.add_argument('--city', required=True)
    discover.add_argument('--activity', required=True, choices=('all', 'restaurant', 'artisan', 'beauty', 'hotel', 'retail'))
    discover.add_argument('--keyword', default='')
    discover.add_argument('--engine', choices=('website', 'menu', 'voice'), default='website')
    discover.add_argument('--max', type=int, default=25)
    discover.add_argument('--request-id')
    discover.add_argument('--confirm', action='store_true')
    edit = commands.add_parser('edit-draft')
    edit.add_argument('id')
    edit.add_argument('--subject', required=True)
    edit.add_argument('--body-file', required=True)
    edit.add_argument('--confirm', action='store_true')
    args = parser.parse_args(argv)
    request_id = None
    try:
        if hasattr(args, 'id') and (args.id in ('.', '..') or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,500}', args.id)):
            raise ClientError('Identifiant invalide ; valeur non corrigée automatiquement.')
        if args.command == 'edit-draft':
            if not args.confirm:
                raise ClientError('Écriture refusée : accord explicite et option --confirm requis.')
            if len(args.subject) > 500:
                raise ClientError('Sujet limité à 500 caractères.')
            body = read_draft_body(args.body_file)
            _, token = connection(args.allow_local)
            if token in body or token in args.subject:
                raise ClientError('Clé technique détectée : brouillon non transmis.')
            result = request(f'/drafts/{args.id}', allow_local=args.allow_local,
                             payload={'subject': args.subject, 'body': body}, confirm=True, method='PATCH')
        elif args.command in ('analyze', 'drafts', 'prepare'):
            if not args.confirm:
                raise ClientError('Écriture refusée : accord explicite et option --confirm requis.')
            suffix = {'analyze': 'analyze', 'drafts': 'drafts', 'prepare': 'handoffs'}[args.command]
            payload = {} if args.command == 'analyze' else {'engine': args.engine}
            result = request(f'/prospects/{args.id}/{suffix}', allow_local=args.allow_local, payload=payload, confirm=True)
        elif args.command == 'discover':
            if not args.confirm:
                raise ClientError('Écriture refusée : accord explicite et option --confirm requis.')
            if not 1 <= args.max <= 25 or not 2 <= len(args.city) <= 200 or len(args.keyword) > 150:
                raise ClientError('Recherche refusée : ville valide, mot-clé borné et lot de 1 à 25 requis.')
            request_id = args.request_id or str(uuid4())
            if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', request_id):
                request_id = None
                raise ClientError('requestId UUID invalide ; identifiant non corrigé automatiquement.')
            payload = {'city': args.city, 'activity': args.activity, 'keyword': args.keyword,
                       'engine': args.engine, 'max': args.max, 'requestId': request_id}
            result = {'requestId': request_id, 'result': request('/discover', allow_local=args.allow_local, payload=payload, confirm=True)}
        else:
            path = '/prospects/' + args.id if args.command == 'show' else '/handoffs/' + args.id if args.command == 'handoff' else '/' + args.command
            result = request(path, allow_local=args.allow_local)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except ClientError as exc:
        error = {'ok': False, 'error': str(exc)}
        if request_id:
            error['requestId'] = request_id
        print(json.dumps(error, ensure_ascii=False))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
