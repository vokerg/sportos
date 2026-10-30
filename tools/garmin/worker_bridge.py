"""Private worker-only stdin protocol; session state never reaches API responses.
No password login, filesystem-selected session, owner, shell command or URL input.
"""
import json
import logging
import sys
from activity_bridge import execute
from extract_activity import GarminTransport, ExtractionError, encoded

SESSION_KEYS = {'di_token', 'di_refresh_token', 'di_client_id'}

def session(value):
    if not isinstance(value, dict) or set(value) != SESSION_KEYS or any(not isinstance(v, str) or not v or len(v) > 40000 for v in value.values()):
        raise ExtractionError('INVALID_GARMIN_SESSION')
    return value

def request(value):
    if not isinstance(value, dict) or set(value) != {'request', 'session'}:
        raise ExtractionError('INVALID_WORKER_INPUT')
    operation = value['request']
    if not isinstance(operation, dict) or operation.get('operation') not in ('discover', 'extract', 'day'):
        raise ExtractionError('INVALID_WORKER_INPUT')
    allowed = {'discover': {'operation', 'startTime'}, 'extract': {'operation', 'providerActivityId', 'refresh'}, 'day': {'operation', 'date', 'categories'}}[operation['operation']]
    if set(operation) - allowed or ('refresh' in operation and not isinstance(operation['refresh'], bool)):
        raise ExtractionError('INVALID_WORKER_INPUT')
    if operation['operation'] == 'day':
        from fetch_day import calendar_date
        calendar_date(operation.get('date'))
    return operation, session(value['session'])

def main():
    logging.disable(logging.CRITICAL)
    client = None
    result = None
    error = None
    try:
        data = sys.stdin.buffer.read(131073)
        if len(data) > 131072:
            raise ExtractionError('INVALID_WORKER_INPUT')
        operation, credentials = request(json.loads(data))
        from garminconnect import Garmin
        client = Garmin(retry_attempts=0)
        transport = GarminTransport(client)
        client.login(json.dumps(credentials))
        result = execute(operation, transport)
    except ExtractionError as exc:
        error = exc.code
    except Exception:
        error = 'GARMIN_LOGIN_OR_FETCH_FAILED'
    # The pinned SDK supports inline sessions and in-memory export. No temporary
    # token files, profiles or passwords are written on a worker machine.
    updated = None
    if client is not None:
        try:
            updated = session(json.loads(client.client.dumps()))
        except Exception:
            pass
    sys.stdout.buffer.write(encoded({'result': result, 'session': updated, 'error': error}))
    if error:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
