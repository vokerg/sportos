"""Optional synthetic end-to-end check against a separately started local test API."""
import os
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
from urllib.parse import urlsplit
from extract_activity import extract
from sportos_api import SportOSApi
from test_extract_activity import StubGarmin

@unittest.skipUnless(os.environ.get('SPORTOS_GARMIN_TEST_API_BASE'), 'isolated local test API not configured')
class SyntheticApiPipelineTests(unittest.TestCase):
    def test_metadata_cache_and_noncanonical_retention(self):
        base = os.environ['SPORTOS_GARMIN_TEST_API_BASE']
        if urlsplit(base).hostname not in ('localhost', '127.0.0.1'):
            self.fail('Synthetic API tests require a loopback test deployment.')
        api = SportOSApi(base, 'http://localhost:4210')
        api.authenticate()
        try:
            before = api.request('GET', '/activities', params={'limit': '1'})['summary']['count']
            identifier = str(uuid4().int % 10**14 + 10**14)
            stub = StubGarmin(); stub.data = {**stub.data, 'activityId': int(identifier)}
            with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
                bundle = extract(stub, identifier, directory, remote_cache=api.cache)
                result = api.retain(bundle['folder'], bundle['bundle'])
                self.assertIsNone(result['activityId'])
                self.assertEqual(result['status'], 'unmatched')
                stub.calls.clear()
                again = extract(stub, identifier, directory, remote_cache=api.cache)
                self.assertTrue(again['remote'])
                self.assertEqual(stub.calls, ['metadata'])
                # Duplicate artifact upload retains the same primary UUID/version.
                replay = api.retain(bundle['folder'], bundle['bundle'])
                self.assertEqual(replay['id'], result['id'])
                self.assertFalse(replay['versionAdded'])
            after = api.request('GET', '/activities', params={'limit': '1'})['summary']['count']
            self.assertEqual(before, after)
        finally:
            api.close()
