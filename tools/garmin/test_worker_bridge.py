import io
import json
import sys
import types
import unittest
from unittest.mock import patch
import worker_bridge

SESSION = {'di_token': 'synthetic-access', 'di_refresh_token': 'synthetic-refresh', 'di_client_id': 'synthetic-client'}
class FakeGarmin:
    def __init__(self, **kwargs):
        self.client = types.SimpleNamespace(dumps=lambda: json.dumps({**SESSION, 'di_token': 'synthetic-rotated'}))
    def login(self, value):
        assert json.loads(value) == SESSION

class WorkerBridgeTest(unittest.TestCase):
    def test_rejects_arbitrary_owner_path_password_or_operation_before_login(self):
        good = {'request': {'operation': 'day', 'date': '2026-03-29'}, 'session': SESSION}
        for bad in [{**good, 'owner': 'other'}, {**good, 'session': {**SESSION, 'password': 'secret'}}, {**good, 'request': {'operation': 'shell'}}, {**good, 'request': {'operation': 'day', 'date': '2026-03-29', 'url': 'https://invalid'}}]:
            with self.assertRaises(Exception):
                worker_bridge.request(bad)
    def test_private_protocol_returns_rotated_session_on_success_and_operation_failure(self):
        for fail in [False, True]:
            output = io.BytesIO()
            request = {'request': {'operation': 'day', 'date': '2026-03-29'}, 'session': SESSION}
            def execute(*_):
                if fail:
                    raise worker_bridge.ExtractionError('GARMIN_RATE_LIMITED_RETRY_LATER')
                return {'schema': 'synthetic'}
            with patch.dict(sys.modules, {'garminconnect': types.SimpleNamespace(Garmin=FakeGarmin)}), patch.object(worker_bridge, 'GarminTransport', lambda value: value), patch.object(worker_bridge, 'execute', execute), patch.object(sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode()))), patch.object(sys, 'stdout', types.SimpleNamespace(buffer=output)):
                if fail:
                    with self.assertRaises(SystemExit):
                        worker_bridge.main()
                else:
                    worker_bridge.main()
            decoded = json.loads(output.getvalue())
            self.assertEqual(decoded['session']['di_token'], 'synthetic-rotated')
            self.assertEqual(decoded['error'], 'GARMIN_RATE_LIMITED_RETRY_LATER' if fail else None)

if __name__ == '__main__':
    unittest.main()
