"""Explicit local UI bridge. Fixed stdin operations; never prompts for credentials."""
import datetime as dt
import json
import sys
from extract_activity import DEFAULT_HOME, ExtractionError, activity_id, encoded, extract, login, normalized_summary


def discover(transport, start):
    instant = dt.datetime.fromisoformat(start.replace('Z', '+00:00'))
    if instant.tzinfo is None:
        raise ExtractionError('INVALID_UTC_START')
    instant = instant.astimezone(dt.timezone.utc)
    # A fixed bounded date window covers Garmin-local versus canonical UTC dates.
    params = {'startDate': (instant - dt.timedelta(days=1)).date().isoformat(),
              'endDate': (instant + dt.timedelta(days=1)).date().isoformat(), 'start': '0', 'limit': '100'}
    rows = transport.client.connectapi(transport.client.garmin_connect_activities, params=params)
    if not isinstance(rows, list) or len(rows) > 100:
        raise ExtractionError('INVALID_GARMIN_DISCOVERY')
    items = []
    uncertain = False
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get('activityType'), dict) and row['activityType'].get('typeKey') == 'walking':
            continue
        try:
            summary = normalized_summary({'activityTypeDTO': row.get('activityType', {}), 'summaryDTO': row}, {})
            delta = abs((dt.datetime.fromisoformat(summary['startTime'].replace('Z', '+00:00')) - instant).total_seconds())
            if delta <= 120:
                items.append({'providerActivityId': activity_id(row.get('activityId', '')), 'summary': summary})
        except (ExtractionError, AttributeError, ValueError):
            # Unsupported observations are never evidence for selecting a winner.
            try:
                value = dt.datetime.fromisoformat(row['startTimeGMT'].replace('Z', '+00:00'))
                if value.tzinfo is None:
                    value = value.replace(tzinfo=dt.timezone.utc)
                uncertain |= abs((value - instant).total_seconds()) <= 120
            except (KeyError, TypeError, ValueError):
                uncertain = True
    return {'items': items, 'truncated': len(rows) == 100, 'uncertain': uncertain}


def main():
    try:
        data = sys.stdin.buffer.read(16385)
        if len(data) > 16384:
            raise ExtractionError('INVALID_BRIDGE_INPUT')
        request = json.loads(data)
        if not isinstance(request, dict) or request.get('operation') not in ('discover', 'extract', 'day'):
            raise ExtractionError('INVALID_BRIDGE_INPUT')
        allowed = {'discover': {'operation', 'startTime'}, 'extract': {'operation', 'providerActivityId', 'refresh'}, 'day': {'operation', 'date', 'categories'}}[request['operation']]
        if set(request) - allowed or ('refresh' in request and not isinstance(request['refresh'], bool)):
            raise ExtractionError('INVALID_BRIDGE_INPUT')
        if request['operation'] == 'day':
            from fetch_day import calendar_date
            calendar_date(request.get('date'))
        transport = login(str(DEFAULT_HOME / 'tokens'))
        if request.get('operation') == 'discover':
            result = discover(transport, request['startTime'])
        elif request.get('operation') == 'day':
            from fetch_day import fetch_day
            result = fetch_day(transport, request['date'], request.get('categories'))
        elif request.get('operation') == 'extract':
            result = extract(transport, activity_id(request['providerActivityId']), DEFAULT_HOME / 'sources', request.get('refresh') is True)
            result = {'folder': str(result['folder']), 'bundle': result['bundle']}
        else:
            raise ExtractionError('INVALID_BRIDGE_INPUT')
        sys.stdout.buffer.write(encoded(result))
    except ExtractionError as error:
        sys.stdout.buffer.write(encoded({'error': error.code}))
        raise SystemExit(1) from None
    except Exception:
        sys.stdout.buffer.write(encoded({'error': 'GARMIN_LOGIN_OR_FETCH_FAILED'}))
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
