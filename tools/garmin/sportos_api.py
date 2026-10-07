"""Owner comes exclusively from the SportOS authenticated session; never a CLI flag."""
import getpass
import json
import sys
from urllib.parse import urlsplit, unquote
import requests
from extract_activity import ExtractionError, encoded, read_json, verify_bundle

class SportOSApi:
    def __init__(self, base, web_origin):
        parsed = urlsplit(base)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1'))):
            raise ExtractionError('SPORTOS_API_REQUIRES_HTTPS_OR_LOOPBACK')
        self.base = base.rstrip('/')
        self.origin = web_origin
        self.session = requests.Session()
        self.issued_session = False
    def request(self, method, path, **kwargs):
        headers = {'Origin': self.origin}
        csrf = next((cookie.value for cookie in self.session.cookies if cookie.name == 'sportos_csrf'), None)
        if csrf:
            headers['x-sportos-csrf'] = unquote(csrf)
        response = self.session.request(method, self.base + path, headers=headers, timeout=(10, 60), allow_redirects=False, stream=True, **kwargs)
        try:
            if response.status_code >= 300:
                raise ExtractionError('SPORTOS_AUTH_OR_IMPORT_FAILED')
            body = bytearray()
            for chunk in response.iter_content(16384):
                body.extend(chunk)
                if len(body) > 1_000_000:
                    raise ExtractionError('SPORTOS_RESPONSE_TOO_LARGE')
            return json.loads(body)
        finally:
            response.close()
    def authenticate(self):
        try:
            self.request('GET', '/auth/session')
            return  # Explicit local dev-single-user API; no cookie/owner argument.
        except ExtractionError:
            pass
        config = self.request('GET', '/auth/config')
        if config.get('mode') != 'single-user' or not sys.stdin.isatty():
            raise ExtractionError('SPORTOS_INTERACTIVE_PASSWORD_LOGIN_OR_LOCAL_DEV_MODE_REQUIRED')
        username = input('SportOS username: ').strip()
        password = getpass.getpass('SportOS password (sent only to configured SportOS API): ')
        try:
            self.request('POST', '/auth/password', json={'username': username, 'password': password})
            self.issued_session = True
        finally:
            password = None
    def cache(self, identifier, metadata_hash):
        return self.request('GET', f'/garmin/local/cache/{identifier}', params={'metadataHash': metadata_hash}).get('current') is True
    def retain(self, folder, bundle):
        if not verify_bundle(folder, bundle):
            raise ExtractionError('INVALID_LOCAL_BUNDLE')
        snapshot = bundle['snapshot']
        for item in bundle['resources']:
            payload = read_json(folder / item['file'])
            envelope = {'snapshot': snapshot, 'resourceType': item['resourceType'], 'chunkIndex': item['chunkIndex'], 'payload': payload}
            data = encoded(envelope)
            if len(data) > 4_000_000:
                raise ExtractionError('RESOURCE_ENVELOPE_TOO_LARGE')
            self.request('POST', '/garmin/local/resource', files={'file': ('resource.json', data, 'application/json')})
        original = bundle['original']
        with (folder / original['file']).open('rb') as stream:
            self.request('POST', '/garmin/local/original', files={'file': ('activity.' + original['file'].split('.')[-1], stream, 'application/octet-stream')}, data={'snapshot': json.dumps(snapshot), 'resources': json.dumps([{'resourceType': item['resourceType'], 'chunkIndex': item['chunkIndex']} for item in bundle['resources']])})
        return self.request('POST', '/garmin/local/commit', json=snapshot)
    def close(self):
        try:
            if self.issued_session:
                try:
                    self.request('POST', '/auth/logout')
                except Exception:
                    pass  # Server sessions remain expiry-bounded; do not mask import diagnostics.
        finally:
            self.session.cookies.clear()
            self.session.close()
