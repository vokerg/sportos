"""User-initiated, single-activity Garmin extraction; never a bulk sync daemon."""
import argparse
import datetime as dt
import getpass
import hashlib
import io
import json
import logging
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
import tempfile
import zipfile

MAX_ORIGINAL = 20 * 1024 * 1024
MAX_JSON = 4_000_000
MAX_FRAMES = 200_000
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_HOME = Path.home() / '.local/share/sportos/garmin'
TYPE_MAP = {
    'walking': ('walk', 'outdoor'),
    'running': ('run', 'outdoor'), 'treadmill_running': ('run', 'treadmill'),
    'track_running': ('run', 'track'), 'trail_running': ('run', 'outdoor'),
    'cycling': ('bike', 'outdoor'), 'indoor_cycling': ('bike', 'indoor'),
    'lap_swimming': ('swim', 'indoor'), 'open_water_swimming': ('swim', 'outdoor'),
    'strength_training': ('workout', 'indoor'), 'indoor_rowing': ('rowing', 'indoor'),
    'rowing': ('rowing', 'outdoor'), 'stand_up_paddleboarding': ('sup', 'outdoor'),
}

class ExtractionError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def activity_id(value):
    if not re.fullmatch(r'[0-9]{1,20}', str(value)) or int(value) <= 0:
        raise ExtractionError('INVALID_ACTIVITY_ID')
    return str(int(value))

def protected_directory(path):
    path = Path(os.path.abspath(Path(path).expanduser()))
    for ancestor in [path, *path.parents]:
        if ancestor.is_symlink():
            raise ExtractionError('UNSAFE_LOCAL_DIRECTORY')
        if (ancestor / '.git').exists():
            raise ExtractionError('PRIVATE_DATA_MUST_STAY_OUTSIDE_REPOSITORY')
    if path == ROOT or ROOT in path.parents:
        raise ExtractionError('PRIVATE_DATA_MUST_STAY_OUTSIDE_REPOSITORY')
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.stat().st_uid != os.getuid():
        raise ExtractionError('UNSAFE_LOCAL_DIRECTORY')
    path.chmod(0o700)
    return path

def write_private(path, data):
    if path.is_symlink():
        raise ExtractionError('UNSAFE_LOCAL_FILE')
    fd, name = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def read_json(path, maximum=MAX_JSON):
    if path.is_symlink() or path.stat().st_size > maximum:
        raise ExtractionError('INVALID_LOCAL_ARTIFACT')
    with path.open('rb') as stream:
        return json.load(stream)

def json_value(value):
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {'encoding': 'hex', 'value': bytes(value).hex()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value

def unpack_original(data):
    """Bounded ZIP reader: preserve bytes, never extract provider-controlled paths."""
    if len(data) > MAX_ORIGINAL:
        raise ExtractionError('ORIGINAL_TOO_LARGE')
    if len(data) >= 12 and data[8:12] == b'.FIT':
        return data
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            if not members or len(members) > 16:
                raise ExtractionError('UNSUPPORTED_ORIGINAL_ARCHIVE')
            fits = []
            total = 0
            for member in members:
                name = PurePosixPath(member.filename)
                if name.is_absolute() or '..' in name.parts or '\\' in member.filename or '\x00' in member.filename or ':' in member.filename or stat.S_ISLNK(member.external_attr >> 16):
                    raise ExtractionError('UNSAFE_ORIGINAL_ARCHIVE')
                total += member.file_size
                if total > MAX_ORIGINAL or member.flag_bits & 1 or member.file_size > max(1024, member.compress_size * 200):
                    raise ExtractionError('UNSAFE_ORIGINAL_ARCHIVE')
                if not member.is_dir() and name.suffix.lower() == '.fit':
                    fits.append(member)
            if len(fits) != 1:
                raise ExtractionError('ORIGINAL_REQUIRES_ONE_FIT')
            fit = archive.read(fits[0])
            if len(fit) < 12 or fit[8:12] != b'.FIT':
                raise ExtractionError('INVALID_FIT')
            return fit
    except (zipfile.BadZipFile, RuntimeError, OSError):
        raise ExtractionError('INVALID_ORIGINAL_ARCHIVE') from None

def decode_fit(data):
    import fitdecode
    records = []
    counts = {}
    sessions = []
    decoded_size = 0
    try:
        with fitdecode.FitReader(io.BytesIO(data), check_crc=fitdecode.CrcCheck.RAISE,
                                 error_handling=fitdecode.ErrorHandling.RAISE) as reader:
            for frame in reader:
                if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                    continue
                if len(records) >= MAX_FRAMES:
                    raise ExtractionError('FIT_RECORD_LIMIT')
                fields = [{'name': field.name, 'definition': field.def_num,
                           'developerIndex': getattr(field.field, 'dev_data_index', None),
                           'units': field.units, 'value': json_value(field.value),
                           'rawValue': json_value(field.raw_value)} for field in frame.fields]
                item = {'message': frame.name, 'fields': fields}
                decoded_size += len(encoded(item))
                if decoded_size > 64 * 1024 * 1024:
                    raise ExtractionError('FIT_DECODED_SIZE_LIMIT')
                records.append(item)
                counts[frame.name] = counts.get(frame.name, 0) + 1
                if frame.name == 'session':
                    sessions.append({field.name: field.value for field in frame.fields})
    except ExtractionError:
        raise
    except Exception:
        raise ExtractionError('INVALID_OR_UNSUPPORTED_FIT') from None
    if len(sessions) != 1:
        raise ExtractionError('MULTISESSION_FIT_REQUIRES_REVIEW')
    return records, counts, sessions[0]

def metric(value, maximum):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > maximum:
        raise ExtractionError('INVALID_GARMIN_METRIC')
    return value

def normalized_summary(metadata, session):
    sport = metadata.get('activityTypeDTO', {}).get('typeKey')
    if sport not in TYPE_MAP:
        raise ExtractionError('UNSUPPORTED_GARMIN_SPORT')
    summary = metadata.get('summaryDTO')
    if not isinstance(summary, dict):
        raise ExtractionError('INVALID_GARMIN_METADATA')
    # Garmin names this field GMT; its documented field semantics supply UTC.
    start = summary.get('startTimeGMT')
    if not isinstance(start, str):
        raise ExtractionError('MISSING_UTC_START')
    try:
        instant = dt.datetime.fromisoformat(start.replace('Z', '+00:00'))
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=dt.timezone.utc)
        instant = instant.astimezone(dt.timezone.utc)
    except ValueError:
        raise ExtractionError('INVALID_UTC_START') from None
    elapsed = summary.get('elapsedDuration')
    if elapsed is None:
        elapsed = session.get('total_elapsed_time')
    # Timer duration is not necessarily moving time. Never substitute it here.
    moving = summary.get('movingDuration')
    distance = summary.get('distance')
    return {'activityType': TYPE_MAP[sport][0], 'subtype': TYPE_MAP[sport][1],
            'startTime': instant.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'elapsedTimeS': metric(elapsed, 604800), 'movingTimeS': metric(moving, 604800),
            'distanceM': metric(distance, 1000000)}

class GarminTransport:
    """Pinned SDK authentication, with bounded streamed API responses and no retries."""
    def __init__(self, client):
        import requests
        self.client = client
        class BoundedSession(requests.Session):
            count = 0
            last = 0
            def request(self, method, url, **kwargs):
                from urllib.parse import urlsplit
                parsed = urlsplit(url)
                if method != 'GET' or parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.garmin.com'):
                    raise ExtractionError('UNEXPECTED_GARMIN_ENDPOINT')
                self.count += 1
                if self.count > 20:
                    raise ExtractionError('GARMIN_REQUEST_LIMIT')
                time.sleep(max(0, 0.5 - (time.monotonic() - self.last)))
                self.last = time.monotonic()
                kwargs.update(stream=True, timeout=(10, 30), allow_redirects=False)
                response = super().request(method, url, **kwargs)
                maximum = MAX_ORIGINAL if '/download-service/' in parsed.path else MAX_JSON
                try:
                    if response.status_code == 429:
                        raise ExtractionError('GARMIN_RATE_LIMITED_RETRY_LATER')
                    if response.status_code in (401, 403):
                        # SDK may perform its supported one-time refresh on 401.
                        if response.status_code == 403:
                            raise ExtractionError('GARMIN_ACCESS_DENIED_REAUTHENTICATE')
                    if 300 <= response.status_code < 400:
                        raise ExtractionError('GARMIN_REDIRECT_REFUSED')
                    body = bytearray()
                    for chunk in response.iter_content(65536):
                        body.extend(chunk)
                        if len(body) > maximum:
                            raise ExtractionError('GARMIN_RESPONSE_TOO_LARGE')
                    response._content = bytes(body)
                    response._content_consumed = True
                    return response
                finally:
                    response.close()
        client.client._api_session.close()
        client.client._api_session = BoundedSession()
    def metadata(self, identifier):
        return self.client.get_activity(identifier)
    def original(self, identifier):
        return self.client.download_activity(identifier, self.client.ActivityDownloadFormat.ORIGINAL)
    def details(self, identifier):
        return self.client.get_activity_details(identifier, maxchart=2000, maxpoly=0)
    def sets(self, identifier):
        return self.client.get_activity_exercise_sets(identifier)

def login(tokenstore, interactive=False):
    from garminconnect import Garmin
    logging.disable(logging.CRITICAL)  # Upstream errors/logs may contain private responses.
    os.umask(0o077)
    tokens = protected_directory(tokenstore)
    for file in tokens.iterdir():
        if file.is_symlink() or not file.is_file() or file.stat().st_uid != os.getuid():
            raise ExtractionError('UNSAFE_TOKENSTORE')
        file.chmod(0o600)
    if interactive:
        if not sys.stdin.isatty():
            raise ExtractionError('LOGIN_REQUIRES_USER_TERMINAL')
        email = input('Garmin email (sent only to Garmin): ').strip()
        password = getpass.getpass('Garmin password: ')
        client = Garmin(email=email, password=password, prompt_mfa=lambda: getpass.getpass('Garmin MFA code: '), retry_attempts=0)
        password = None
    else:
        if not (tokens / 'garmin_tokens.json').is_file():
            raise ExtractionError('RUN_PNPM_GARMIN_LOGIN_FIRST')
        client = Garmin(retry_attempts=0)
    transport = GarminTransport(client)
    try:
        client.login(str(tokens))
    except ExtractionError:
        raise
    except Exception:
        raise ExtractionError('GARMIN_LOGIN_FAILED_REAUTHENTICATE') from None
    finally:
        if hasattr(client, 'password'):
            client.password = None
        if hasattr(client.client, 'password'):
            client.client.password = None
    for file in tokens.iterdir():
        if file.is_symlink() or not file.is_file():
            raise ExtractionError('UNSAFE_TOKENSTORE')
        file.chmod(0o600)
    return transport


def extract(transport, identifier, output, force=False, remote_cache=None):
    identifier = activity_id(identifier)
    output = protected_directory(output)
    metadata = transport.metadata(identifier)
    if not isinstance(metadata, dict) or activity_id(metadata.get('activityId', '')) != identifier:
        raise ExtractionError('GARMIN_ACTIVITY_ID_MISMATCH')
    metadata_bytes = encoded(metadata)
    if len(metadata_bytes) > MAX_JSON:
        raise ExtractionError('GARMIN_METADATA_TOO_LARGE')
    metadata_hash = digest(metadata_bytes)
    # Check auxiliary provenance/cache before original/detail/sets calls.
    if not force and remote_cache and remote_cache(identifier, metadata_hash):
        return {'cached': True, 'remote': True}
    cache_path = output / (digest(identifier.encode()) + '.cache.json')
    if not force and cache_path.exists():
        cache = read_json(cache_path)
        folder = output / cache.get('sourceHash', '')
        if cache.get('metadataHash') == metadata_hash and re.fullmatch('[a-f0-9]{64}', cache.get('sourceHash', '')) and (folder / 'bundle.json').is_file():
            bundle = read_json(folder / 'bundle.json')
            # A deleted/truncated resource must not be treated as a complete copy.
            if verify_bundle(folder, bundle):
                return {'cached': True, 'remote': False, 'folder': folder, 'bundle': bundle}
    original = None
    # Reuse raw-before-normalized retention after a parser fix or transient detail
    # failure. A force refresh still asks Garmin for the original explicitly.
    raw_root = output / 'raw'
    if not force and raw_root.is_dir() and not raw_root.is_symlink():
        for candidate in sorted(raw_root.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True)[:100]:
            meta_file = candidate / 'metadata.json'; original_file = candidate / 'original.bin'
            if candidate.is_symlink() or not re.fullmatch('[a-f0-9]{64}', candidate.name) or not meta_file.is_file() or not original_file.is_file() or original_file.is_symlink() or original_file.stat().st_size > MAX_ORIGINAL:
                continue
            if digest(encoded(read_json(meta_file))) == metadata_hash:
                retained = original_file.read_bytes()
                if digest(metadata_bytes + retained) == candidate.name:
                    original = retained
                    break
    if original is None:
        original = transport.original(identifier)
    if not isinstance(original, bytes) or len(original) > MAX_ORIGINAL:
        raise ExtractionError('ORIGINAL_TOO_LARGE')
    # Raw-before-normalized retention survives unsupported/corrupt FIT diagnostics.
    raw_folder = protected_directory(output / 'raw' / digest(metadata_bytes + original))
    for name, data in [('metadata.json', metadata_bytes), ('original.bin', original)]:
        if not (raw_folder / name).exists():
            write_private(raw_folder / name, data)
    fit = unpack_original(original)
    records, counts, session = decode_fit(fit)
    summary = normalized_summary(metadata, session)
    detail = transport.details(identifier)
    # Unsupported exercise-set endpoint is explicit; auth/rate limits are fatal.
    try:
        sets = transport.sets(identifier)
    except Exception as error:
        from garminconnect import GarminConnectNotFoundError
        if isinstance(error, GarminConnectNotFoundError):
            sets = {'availability': 'unavailable'}
        else:
            raise
    resources = [('detail', 0, {'metadataHash': metadata_hash, 'metadata': metadata, 'details': detail}), ('sets', 0, sets)]
    # Keep every FIT message and unknown/developer field in bounded chunks.
    chunk = []; size = 0; index = 0
    for record in records:
        record_size = len(encoded(record))
        if record_size > MAX_JSON:
            raise ExtractionError('FIT_FIELD_TOO_LARGE')
        if chunk and size + record_size + len(chunk) + 2 > 3_000_000:
            resources.append(('records', index, chunk)); index += 1; chunk = []; size = 0
        chunk.append(record); size += record_size
    if chunk:
        resources.append(('records', index, chunk))
    raw_files = [('original.zip' if original[:2] == b'PK' else 'original.fit', original), ('activity.fit', fit)]
    for kind, index, payload in resources:
        data = encoded(payload)
        if len(data) > MAX_JSON:
            raise ExtractionError('GARMIN_RESOURCE_TOO_LARGE')
        raw_files.append((f'{kind}-{index}.json', data))
    hashes = [(name, digest(data)) for name, data in raw_files]
    source_hash = digest(encoded(hashes))
    folder = protected_directory(output / source_hash)
    files = []
    for name, data in raw_files:
        target = folder / name
        if target.exists() and digest(target.read_bytes()) != digest(data):
            raise ExtractionError('LOCAL_SOURCE_VERSION_CONFLICT')
        if not target.exists():
            write_private(target, data)
        files.append({'file': name, 'sha256': digest(data), 'size': len(data)})
    snapshot = {'providerActivityId': identifier, 'contentHash': source_hash, 'origin': 'connect',
                'sourceUpdatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'), 'summary': summary}
    bundle = {'schema': 'sportos.garmin-single.v1', 'snapshot': snapshot, 'metadataHash': metadata_hash,
              'files': files, 'resources': [{'resourceType': kind, 'chunkIndex': index, 'file': f'{kind}-{index}.json'} for kind, index, _ in resources],
              'counts': counts, 'original': files[0]}
    if (folder / 'bundle.json').exists():
        bundle = read_json(folder / 'bundle.json')
    else:
        write_private(folder / 'bundle.json', encoded(bundle))
    write_private(cache_path, encoded({'metadataHash': metadata_hash, 'sourceHash': source_hash}))
    return {'cached': False, 'remote': False, 'folder': folder, 'bundle': bundle}


def verify_bundle(folder, bundle):
    if folder.is_symlink() or bundle.get('schema') != 'sportos.garmin-single.v1' or len(bundle.get('files', [])) > 100:
        return False
    total = 0
    for item in bundle.get('files', []):
        name = item.get('file', '')
        if not re.fullmatch(r'(original\.(zip|fit)|activity\.fit|(detail|sets|records)-[0-9]{1,5}\.json)', name):
            return False
        target = folder / name
        if target.is_symlink() or not target.is_file() or target.stat().st_size > MAX_ORIGINAL:
            return False
        total += target.stat().st_size
        if total > 100 * 1024 * 1024 or target.stat().st_size != item.get('size') or digest(target.read_bytes()) != item.get('sha256'):
            return False
    hashes = [(item['file'], item['sha256']) for item in bundle.get('files', [])]
    return digest(encoded(hashes)) == folder.name == bundle.get('snapshot', {}).get('contentHash')


def main():
    class LocalParser(argparse.ArgumentParser):
        def error(self, message):
            self.exit(2, 'INVALID_GARMIN_ARGUMENTS: use --help.\n')
    parser = LocalParser(description=__doc__)
    parser.add_argument('command', choices=['login', 'activity'])
    parser.add_argument('--activity-id')
    parser.add_argument('--tokenstore', default=str(DEFAULT_HOME / 'tokens'))
    parser.add_argument('--output', default=str(DEFAULT_HOME / 'sources'))
    parser.add_argument('--force-refresh', action='store_true')
    parser.add_argument('--import', dest='import_to_sportos', action='store_true')
    parser.add_argument('--api-base', default='http://127.0.0.1:3010')
    parser.add_argument('--web-origin', default='http://localhost:4210')
    args = parser.parse_args()
    try:
        if args.command == 'login':
            login(args.tokenstore, interactive=True)
            print('Garmin login ready. Protected local tokens saved; password not retained.')
            return
        identifier = activity_id(args.activity_id or '')
        api = None
        if args.import_to_sportos:
            from sportos_api import SportOSApi
            api = SportOSApi(args.api_base, args.web_origin)
        try:
            if api:
                api.authenticate()
            result = extract(login(args.tokenstore), identifier, args.output, args.force_refresh, api.cache if api else None)
            if result.get('remote'):
                print('Current Garmin resources are already retained in SportOS; skipped original/detail downloads.')
                return
            if api:
                state = api.retain(result['folder'], result['bundle'])
                print(json.dumps({'status': state['status'], 'linked': state['activityId'] is not None, 'cached': result['cached']}))
            else:
                print(json.dumps({'retainedLocally': True, 'cached': result['cached'], 'messageCounts': result['bundle']['counts'], 'bytes': sum(item['size'] for item in result['bundle']['files'])}))
        finally:
            if api:
                api.close()
    except KeyboardInterrupt:
        print('Cancelled. Prior retained versions remain intact.', file=sys.stderr)
        raise SystemExit(130) from None
    except ExtractionError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print('GARMIN_EXTRACTION_FAILED: no partial import was promoted; retry or reauthenticate locally.', file=sys.stderr)
        raise SystemExit(1) from None

if __name__ == '__main__':
    main()
