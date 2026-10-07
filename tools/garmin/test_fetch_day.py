import datetime as dt
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fetch_day import fetch_day, day_activities, calendar_date
from extract_activity import ExtractionError, read_json

class DayTests(unittest.TestCase):
    def client(self, **changes):
        values = {
            'get_user_summary': lambda date: {'calendarDate': date, 'totalSteps': 12345, 'totalDistanceMeters': 8000, 'totalKilocalories': 2400},
            'get_daily_weigh_ins': lambda date: {'dateWeightList': [
                {'calendarDate': date, 'timestampGMT': 1774738800000, 'weight': 70000, 'bodyFat': None},
                {'calendarDate': date, 'timestampGMT': 1774746000000, 'weight': 70500, 'muscleMass': None}]},
            'get_sleep_data': lambda date: {'dailySleepDTO': {'calendarDate': date, 'sleepTimeSeconds': 25000}},
            'get_heart_rates': lambda date: {}, 'get_hrv_data': lambda date: None,
            'get_stress_data': lambda date: {'avgStressLevel': 20},
            'get_body_battery': lambda start, end: [{'date': start, 'charged': 60}],
            'connectapi': lambda *args, **kwargs: [], 'garmin_connect_activities': '/activities'}
        values.update(changes)
        compact = values['connectapi']
        values['connectapi'] = lambda url, **kwargs: values['get_user_summary'](kwargs['params']['calendarDate']) if url == '/summary/synthetic' else compact(url, **kwargs)
        values['garmin_connect_daily_summary_url'] = '/summary'
        values['_require_display_name'] = lambda: 'synthetic'
        return SimpleNamespace(client=SimpleNamespace(**values))

    def test_exact_summary_multiple_measurements_and_unchanged_content_address(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp' if Path('/private/tmp').is_dir() else None) as directory, patch('fetch_day.DEFAULT_HOME', Path(directory)):
            first = fetch_day(self.client(), '2026-03-29')
            second = fetch_day(self.client(), '2026-03-29')
            self.assertEqual(first, second)
            summary = first['categories'][0]
            payload = read_json(Path(directory) / 'days' / summary['sourceHash'] / 'payload.json')
            self.assertEqual(payload['totalSteps'], 12345)
            weight = first['categories'][1]
            weights = read_json(Path(directory) / 'days' / weight['sourceHash'] / 'payload.json')
            self.assertEqual(len(weights['dateWeightList']), 2)
            self.assertIsNone(weights['dateWeightList'][1]['muscleMass'])
            changed = fetch_day(self.client(get_user_summary=lambda date: {'calendarDate': date, 'totalSteps': 12346}), '2026-03-29', ['summary'])
            self.assertNotEqual(summary['sourceHash'], changed['categories'][0]['sourceHash'])
            self.assertTrue((Path(directory) / 'days' / summary['sourceHash'] / 'payload.json').exists())

    def test_partial_unsupported_missing_private_and_auth_do_not_become_zero(self):
        def failure(_): raise RuntimeError('private upstream content must not be exposed')
        def unsupported(_): raise AttributeError()
        def auth(_): raise ExtractionError('GARMIN_ACCESS_DENIED_REAUTHENTICATE')
        with tempfile.TemporaryDirectory(dir='/private/tmp' if Path('/private/tmp').is_dir() else None) as directory, patch('fetch_day.DEFAULT_HOME', Path(directory)):
            result = fetch_day(self.client(get_sleep_data=failure, get_hrv_data=unsupported), '2026-03-29')
            states = {item['category']: item['state'] for item in result['categories']}
            self.assertEqual(states['summary'], 'available')
            self.assertEqual(states['sleep'], 'failed')
            self.assertEqual(states['heart_rate'], 'not_recorded')
            self.assertEqual(states['hrv'], 'unsupported')
            self.assertNotIn('private upstream', str(result))
            result = fetch_day(self.client(get_sleep_data=auth), '2026-03-29')
            self.assertEqual(result['categories'][0]['state'], 'available')
            self.assertTrue(all(x['state'] == 'authentication_required' for x in result['categories'][2:]))
            private = fetch_day(self.client(get_user_summary=lambda date: {'privacyProtected': True}), '2026-03-29', ['summary'])
            self.assertEqual(private['categories'][0]['state'], 'private')

    def test_local_midnight_and_dst_filter_use_provider_wall_date(self):
        calls = []
        rows = [
            {'activityId': 1, 'startTimeLocal': '2026-03-29 00:05:00', 'startTimeGMT': '2026-03-28 23:05:00'},
            {'activityId': 2, 'startTimeLocal': '2026-03-29 23:55:00', 'startTimeGMT': '2026-03-29 21:55:00'},
            {'activityId': 3, 'startTimeLocal': '2026-03-30 00:01:00', 'startTimeGMT': '2026-03-29 22:01:00'}]
        def compact(url, params): calls.append(params); return rows
        result = day_activities(self.client(connectapi=compact), dt.date(2026,3,29))
        self.assertEqual([x['activityId'] for x in result['items']], [1,2])
        self.assertTrue(result['complete'])
        self.assertEqual(calls[0], {'startDate': '2026-03-28', 'endDate': '2026-03-30', 'start':'0', 'limit':'100'})
        rows.append({'activityId':4,'startTimeGMT':'2026-03-29 10:00:00'})
        uncertain = day_activities(self.client(connectapi=compact), dt.date(2026,3,29))
        self.assertFalse(uncertain['complete'])
        self.assertEqual(len(uncertain['unresolvedItems']), 1)

    def test_count_size_date_and_category_bounds(self):
        rows = [{'activityId': x+1, 'startTimeLocal': '2026-03-29 10:00:00'} for x in range(100)]
        result = day_activities(self.client(connectapi=lambda *a,**kw:rows), dt.date(2026,3,29))
        self.assertFalse(result['complete']); self.assertEqual(len(result['items']),20)
        for value in ['2026-02-30','2026-3-29','2026-03-29T00:00:00Z',dt.date.today().isoformat()]:
            with self.assertRaises(ExtractionError): calendar_date(value)
        with self.assertRaises(ExtractionError): fetch_day(self.client(),'2026-03-29',['summary','summary'])
        with tempfile.TemporaryDirectory(dir='/private/tmp' if Path('/private/tmp').is_dir() else None) as directory, patch('fetch_day.DEFAULT_HOME', Path(directory)):
            result = fetch_day(self.client(get_stress_data=lambda date:{'data':'x'*4_000_001}), '2026-03-29', ['stress'])
            self.assertEqual(result['categories'], [{'category':'stress','state':'failed'}])
            result = fetch_day(self.client(get_daily_weigh_ins=lambda date:{'dateWeightList':[]}), '2026-03-29', ['weight'])
            self.assertEqual(result['categories'][0]['state'],'not_recorded')
