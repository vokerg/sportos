import datetime as dt
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import fitdecode
from extract_activity import (ExtractionError, extract, decode_fit, unpack_original,
                              normalized_summary, GarminTransport, digest, encoded, json_value)
from sportos_api import SportOSApi


def fixture_fit(developer=False, clock=False):
    # Synthetic FIT session/record messages. No personal/device export samples.
    def message(local, global_id, definitions, values):
        definition = bytes([0x40 | local, 0, 0]) + struct.pack('<H', global_id) + bytes([len(definitions)]) + b''.join(bytes(item) for item in definitions)
        return definition + bytes([local]) + values
    epoch = int((dt.datetime(2026, 10, 7, 10, tzinfo=dt.timezone.utc) - dt.datetime(1989, 12, 31, tzinfo=dt.timezone.utc)).total_seconds())
    body = message(0, 18, [(2, 4, 0x86), (7, 4, 0x86), (8, 4, 0x86), (9, 4, 0x86), (5, 1, 0)], struct.pack('<IIII B', epoch, 1800000, 1700000, 500000, 1))
    if developer:
        body += message(2, 207, [(3, 1, 0x02)], b'\x00')
        body += message(3, 206, [(0, 1, 0x02), (1, 1, 0x02), (2, 1, 0x02), (3, 16, 0x07), (8, 4, 0x07)], bytes([0, 0, 0x84]) + b'custom_dynamics\x00' + b'mm\x00\x00')
        definition = bytes([0x61, 0, 0]) + struct.pack('<H', 20) + bytes([3, 253, 4, 0x86, 3, 1, 0x02, 200, 2, 0x84, 1, 0, 2, 0])
        body += definition + bytes([1]) + struct.pack('<IBHH', epoch, 145, 42, 123)
    else:
        body += message(1, 20, [(253, 4, 0x86), (3, 1, 0x02), (200, 2, 0x84)], struct.pack('<IBH', epoch, 145, 42))
    if clock:
        body += message(4, 3, [(28, 4, 0x86)], struct.pack('<I', 23400))
    header = struct.pack('<BBHI4s', 14, 0x20, 2100, len(body), b'.FIT')
    header += struct.pack('<H', fitdecode.utils.compute_crc(header))
    return header + body + struct.pack('<H', fitdecode.utils.compute_crc(header + body))


def fixture_zip():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('nested/activity.fit', fixture_fit())
    return output.getvalue()


class StubGarmin:
    def __init__(self):
        self.calls = []
        self.data = {'activityId': 12345, 'activityTypeDTO': {'typeKey': 'running'}, 'summaryDTO': {'startTimeGMT': '2026-10-07T10:00:00.000', 'distance': 5000, 'movingDuration': 1750}}
        self.fail = None
    def metadata(self, identifier):
        self.calls.append('metadata')
        return self.data
    def original(self, identifier):
        self.calls.append('original')
        if self.fail:
            raise ExtractionError(self.fail)
        return fixture_zip()
    def details(self, identifier):
        self.calls.append('detail')
        return {'metricDescriptors': [], 'activityDetailMetrics': []}
    def sets(self, identifier):
        self.calls.append('sets')
        return {'exerciseSets': []}


class GarminExtractionTests(unittest.TestCase):
    def test_crc_strict_parser_retains_session_record_unknown_fields_without_guessing(self):
        records, counts, session = decode_fit(fixture_fit())
        self.assertEqual(counts, {'session': 1, 'record': 1})
        self.assertEqual(session['total_elapsed_time'], 1800)
        self.assertTrue(any(field['name'] == 'unknown_200' and field['rawValue'] == 42 for field in records[1]['fields']))
        summary = normalized_summary(StubGarmin().data, session)
        self.assertEqual(summary['elapsedTimeS'], 1800)
        self.assertEqual(summary['startTime'], '2026-10-07T10:00:00.000Z')
        with self.assertRaises(ExtractionError):
            decode_fit(fixture_fit()[:-1])
        with self.assertRaises(ExtractionError):
            decode_fit(fixture_fit()[:-1] + b'\xff')

    def test_clock_fields_and_binary_arrays_preserve_values_without_timezone_guessing(self):
        self.assertEqual(json_value(dt.time(6, 30)), '06:30:00')
        records, _, _ = decode_fit(fixture_fit(clock=True))
        profile = next(row for row in records if row['message'] == 'user_profile')
        clock = next(field for field in profile['fields'] if field['definition'] == 28)
        self.assertEqual(clock['value'], '06:30:00')
        self.assertEqual(clock['rawValue'], 23400)
        self.assertEqual(json_value(bytearray([1, 2])), {'encoding': 'hex', 'value': '0102'})

    def test_developer_sensor_field_preserves_definition_units_and_raw_value(self):
        records, _, _ = decode_fit(fixture_fit(developer=True))
        fields = next(row['fields'] for row in records if row['message'] == 'record')
        sensor = next(field for field in fields if field['name'] == 'custom_dynamics')
        self.assertEqual(sensor['developerIndex'], 0)
        self.assertEqual(sensor['units'], 'mm')
        self.assertEqual(sensor['rawValue'], 123)

    def test_duplicate_run_downloads_metadata_only_and_deleted_local_resource_refetches(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport = StubGarmin()
            first = extract(transport, '12345', directory)
            self.assertFalse(first['cached'])
            transport.calls.clear()
            second = extract(transport, '12345', directory)
            self.assertTrue(second['cached'])
            self.assertEqual(transport.calls, ['metadata'])
            (second['folder'] / 'activity.fit').unlink()
            transport.calls.clear()
            extract(transport, '12345', directory)
            self.assertNotIn('original', transport.calls)
            self.assertIn('detail', transport.calls)
            self.assertEqual((second['folder'] / 'bundle.json').stat().st_mode & 0o777, 0o600)

    def test_primary_auxiliary_cache_skips_rich_network_calls_and_force_refresh_bypasses(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport = StubGarmin()
            self.assertTrue(extract(transport, '12345', directory, remote_cache=lambda *_: True)['remote'])
            self.assertEqual(transport.calls, ['metadata'])
            transport.calls.clear()
            extract(transport, '12345', directory, force=True, remote_cache=lambda *_: True)
            self.assertEqual(transport.calls, ['metadata', 'original', 'detail', 'sets'])

    def test_failure_does_not_advance_cache_or_replace_prior_versions(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport = StubGarmin()
            first = extract(transport, '12345', directory)
            before = (Path(directory) / (digest(b'12345') + '.cache.json')).read_bytes()
            transport.data = {**transport.data, 'revision': 2}
            transport.fail = 'GARMIN_RATE_LIMITED_RETRY_LATER'
            with self.assertRaises(ExtractionError):
                extract(transport, '12345', directory)
            self.assertEqual((Path(directory) / (digest(b'12345') + '.cache.json')).read_bytes(), before)
            self.assertTrue((first['folder'] / 'activity.fit').is_file())

    def test_unsafe_and_multi_fit_archives_are_rejected(self):
        for names in [['../activity.fit'], ['/activity.fit'], ['a.fit', 'b.fit']]:
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as archive:
                for name in names:
                    archive.writestr(name, fixture_fit())
            with self.assertRaises(ExtractionError):
                unpack_original(output.getvalue())
        self.assertEqual(unpack_original(fixture_zip()), fixture_fit())

    def test_corrupt_or_unsupported_input_keeps_original_raw_bytes(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            stub = StubGarmin()
            stub.data['activityTypeDTO']['typeKey'] = 'unsupported_new_type'
            with self.assertRaises(ExtractionError):
                extract(stub, '12345', directory)
            self.assertTrue(list((Path(directory) / 'raw').glob('*/original.bin')))
            self.assertFalse(list(Path(directory).glob('*.cache.json')))

    def test_timezone_and_unsupported_semantics_are_explicit(self):
        metadata = StubGarmin().data
        session = {'total_elapsed_time': 1800, 'total_timer_time': 1700}
        metadata['summaryDTO'].pop('movingDuration')
        self.assertIsNone(normalized_summary(metadata, session)['movingTimeS'])
        metadata['activityTypeDTO']['typeKey'] = 'new_unknown_sport'
        with self.assertRaises(ExtractionError):
            normalized_summary(metadata, session)

    def test_no_owner_or_plain_http_remote_api_and_sdk_transport_is_bounded(self):
        with self.assertRaises(ExtractionError):
            SportOSApi('http://example.com', 'http://example.com')
        class SDK:
            class Client:
                _api_session = type('Session', (), {'close': lambda self: None})()
            client = Client()
        transport = GarminTransport(SDK())
        with self.assertRaises(ExtractionError):
            transport.client.client._api_session.request('GET', 'https://evil.example/activity')
        class Response:
            status_code = 429
            def close(self):
                pass
        with patch('requests.Session.request', return_value=Response()):
            with self.assertRaisesRegex(ExtractionError, 'RATE_LIMITED'):
                transport.client.client._api_session.request('GET', 'https://connectapi.garmin.com/activity')

class BoundedTransportTests(unittest.TestCase):
    def test_oversized_stream_and_redirect_stop_without_retry(self):
        class SDK:
            class Client:
                _api_session = type('Session', (), {'close': lambda self: None})()
            client = Client()
        class Response:
            status_code = 200
            def iter_content(self, size):
                yield b'x' * 4_000_001
            def close(self):
                pass
        sdk = GarminTransport(SDK())
        with patch('requests.Session.request', return_value=Response()) as network:
            with self.assertRaisesRegex(ExtractionError, 'TOO_LARGE'):
                sdk.client.client._api_session.request('GET', 'https://connectapi.garmin.com/activity')
            self.assertEqual(network.call_count, 1)
        response = Response(); response.status_code = 302
        with patch('requests.Session.request', return_value=response) as network:
            with self.assertRaisesRegex(ExtractionError, 'REDIRECT_REFUSED'):
                sdk.client.client._api_session.request('GET', 'https://connectapi.garmin.com/activity')
            self.assertEqual(network.call_count, 1)

if __name__ == '__main__':
    unittest.main()
