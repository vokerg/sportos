"""Fixed completed-day evidence reads through the existing bounded local transport."""
import datetime as dt
import json
from extract_activity import (DEFAULT_HOME, MAX_JSON, ExtractionError, activity_id,
                              digest, encoded, protected_directory, write_private)

CATEGORIES = ('summary', 'weight', 'sleep', 'heart_rate', 'hrv', 'stress', 'body_battery', 'activities')
MAX_ACTIVITIES = 20


def calendar_date(value):
    if not isinstance(value, str) or len(value) != 10:
        raise ExtractionError('INVALID_GARMIN_DATE')
    try:
        date = dt.date.fromisoformat(value)
    except ValueError:
        raise ExtractionError('INVALID_GARMIN_DATE') from None
    if date.isoformat() != value or date >= dt.date.today():
        raise ExtractionError('GARMIN_COMPLETED_DATE_REQUIRED')
    return date


def day_activities(transport, date):
    # One bounded compact request; SDK's get_activities_by_date pagination is not used.
    rows = transport.client.connectapi(transport.client.garmin_connect_activities, params={
        'startDate': (date - dt.timedelta(days=1)).isoformat(),
        'endDate': (date + dt.timedelta(days=1)).isoformat(), 'start': '0', 'limit': '100'})
    if not isinstance(rows, list) or len(rows) > 100:
        raise ExtractionError('INVALID_GARMIN_DISCOVERY')
    selected = []
    uncertain = len(rows) == 100
    identifiers = set()
    unresolved = []
    for row in rows:
        if not isinstance(row, dict):
            uncertain = True
            continue
        local = row.get('startTimeLocal')
        # Local wall date is authoritative; never infer Garmin timezone from UTC.
        try:
            if not isinstance(local, str):
                raise ValueError()
            wall = dt.datetime.fromisoformat(local.replace('Z', '+00:00'))
        except ValueError:
            uncertain = True
            unresolved.append(row)
            continue
        if wall.date() != date:
            continue
        try:
            identifier = activity_id(row.get('activityId', ''))
        except ExtractionError:
            uncertain = True
            unresolved.append(row)
            continue
        if identifier in identifiers:
            continue
        identifiers.add(identifier)
        selected.append(row)
    if len(selected) > MAX_ACTIVITIES:
        uncertain = True
    return {'items': selected[:MAX_ACTIVITIES], 'complete': not uncertain,
            'unresolvedItems': unresolved, 'deferredItems': selected[MAX_ACTIVITIES:]}


def classification(error):
    code = getattr(error, 'code', '')
    name = type(error).__name__
    if 'RATE_LIMIT' in code or name == 'GarminConnectTooManyRequestsError':
        return 'rate_limited'
    if 'REAUTHENTICATE' in code or 'LOGIN' in code or name == 'GarminConnectAuthenticationError':
        return 'authentication_required'
    if name == 'GarminConnectNotFoundError' or isinstance(error, AttributeError):
        return 'unsupported'
    return 'failed'


def fetch_day(transport, value, categories=None):
    date = calendar_date(value)
    categories = list(CATEGORIES) if categories is None else categories
    if not isinstance(categories, list) or not categories or len(set(categories)) != len(categories) or any(x not in CATEGORIES for x in categories):
        raise ExtractionError('INVALID_DAY_CATEGORIES')
    client = transport.client
    operations = {
        # Call the pinned summary endpoint directly so privacyProtected is retained
        # as private evidence rather than converted to an SDK auth exception.
        'summary': lambda: client.connectapi(f'{client.garmin_connect_daily_summary_url}/{client._require_display_name()}', params={'calendarDate': value}),
        'weight': lambda: client.get_daily_weigh_ins(value),
        'sleep': lambda: client.get_sleep_data(value),
        'heart_rate': lambda: client.get_heart_rates(value),
        'hrv': lambda: client.get_hrv_data(value),
        'stress': lambda: client.get_stress_data(value),
        'body_battery': lambda: client.get_body_battery(value, value),
        'activities': lambda: day_activities(transport, date),
    }
    results = []
    stopped = None
    for category in categories:
        if stopped:
            results.append({'category': category, 'state': stopped})
            continue
        try:
            payload = operations[category]()
            data = encoded(payload)
            if len(data) > MAX_JSON:
                raise ExtractionError('GARMIN_RESPONSE_TOO_LARGE')
            if payload is not None and not isinstance(payload, (dict, list)):
                raise ExtractionError('INVALID_DAY_PAYLOAD')
            state = 'private' if isinstance(payload, dict) and payload.get('privacyProtected') is True else 'available'
            if payload is None or payload == {} or payload == []:
                state = 'not_recorded'
            if category == 'weight' and isinstance(payload, dict) and payload.get('dateWeightList') == []:
                state = 'not_recorded'
            source_hash = digest(data)
            folder = protected_directory(DEFAULT_HOME / 'days' / source_hash)
            path = folder / 'payload.json'
            if path.exists() and (path.is_symlink() or digest(path.read_bytes()) != source_hash):
                raise ExtractionError('LOCAL_SOURCE_VERSION_CONFLICT')
            if not path.exists():
                write_private(path, data)
            results.append({'category': category, 'state': state, 'sourceHash': source_hash,
                            'byteSize': len(data)})
        except Exception as error:
            state = classification(error)
            results.append({'category': category, 'state': state})
            if state in ('authentication_required', 'rate_limited'):
                stopped = state
    return {'schema': 'sportos.garmin-day.v1', 'date': value, 'categories': results}
