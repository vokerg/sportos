import unittest
from types import SimpleNamespace
from activity_bridge import discover

class DiscoveryTests(unittest.TestCase):
    def test_compact_window_is_bounded_and_does_not_download_detail(self):
        calls = []
        def connectapi(url, params):
            calls.append(params)
            return [{'activityId': 123, 'activityType': {'typeKey': 'running'}, 'startTimeGMT': '2026-01-01 10:00:00', 'elapsedDuration': 1800, 'movingDuration': 1800, 'distance': 5000}]
        transport = SimpleNamespace(client=SimpleNamespace(connectapi=connectapi, garmin_connect_activities='/activities'))
        result = discover(transport, '2026-01-01T10:00:00Z')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['limit'], '100')
        self.assertEqual(calls[0]['startDate'], '2025-12-31')
        self.assertEqual(result['items'][0]['providerActivityId'], '123')
        self.assertFalse(result['truncated'])
    def test_unknown_nearby_records_and_full_page_require_review(self):
        rows = [{'activityId': 123, 'activityType': {'typeKey': 'unknown'}, 'startTimeGMT': '2026-01-01 10:00:00'}] * 100
        transport = SimpleNamespace(client=SimpleNamespace(connectapi=lambda *args, **kwargs: rows, garmin_connect_activities='/activities'))
        result = discover(transport, '2026-01-01T10:00:00Z')
        self.assertTrue(result['uncertain'])
        self.assertTrue(result['truncated'])
        self.assertEqual(result['items'], [])
