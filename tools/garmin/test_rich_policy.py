"""Synthetic endpoint fixtures derived from verified field/unit shapes only."""
import tempfile
import unittest
from pathlib import Path
from extract_activity import extract, verify_bundle, read_json, ExtractionError
from rich_policy import decision
from test_extract_activity import StubGarmin


def charts():
    fields=[('directTimestamp','gmt'),('sumDuration','second'),('sumDistance','meter'),('directHeartRate','bpm')]
    return {'totalMetricsCount':3,'metricDescriptors':[{'key':key,'metricsIndex':i,'unit':{'key':unit}} for i,(key,unit) in enumerate(fields)],
            'activityDetailMetrics':[{'metrics':[1700000000000+i*1000,i,i*3,140]} for i in range(3)]}


class RichGarmin(StubGarmin):
    def __init__(self,sport='cycling'):
        super().__init__()
        self.data['activityTypeDTO']['typeKey']=sport
        self.data['summaryDTO'].update({'duration':2,'elapsedDuration':2,'distance':6})
        self.chart=charts()
    def rich_details(self,identifier):
        self.calls.append('charts')
        return self.chart
    def splits(self,identifier):
        self.calls.append('splits')
        return {'lapDTOs':[{'duration':2,'elapsedDuration':2,'distance':6}]}
    def sets(self,identifier):
        self.calls.append('sets')
        return {'exerciseSets':[{'setType':'ACTIVE'}]}


class RichPolicyTests(unittest.TestCase):
    def test_new_run_bike_strength_native_json_has_no_fit_or_fake_records(self):
        for sport in ('running','treadmill_running','track_running','trail_running','cycling','indoor_cycling','open_water_swimming','strength_training'):
            with self.subTest(sport=sport),tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
                transport=RichGarmin(sport)
                result=extract(transport,'12345',directory,automatic=True)
                self.assertNotIn('original',transport.calls)
                self.assertEqual(transport.calls,['metadata','charts','sets' if sport=='strength_training' else 'splits'])
                self.assertIsNone(result['bundle']['original'])
                self.assertEqual(result['bundle']['schema'],'sportos.garmin-single.v2')
                self.assertFalse(any(a['resourceType']=='records' for a in result['bundle']['resources']))
                self.assertTrue(verify_bundle(result['folder'],result['bundle']))
                transport.calls.clear()
                self.assertTrue(extract(transport,'12345',directory,automatic=True)['cached'])
                self.assertEqual(transport.calls,['metadata'])
                # Explicit full fetch after JSON must acquire original, not reuse JSON.
                transport.calls.clear()
                full=extract(transport,'12345',directory)
                self.assertIn('original',transport.calls)
                self.assertIsNotNone(full['bundle']['original'])

    def test_validated_pool_json_retains_active_and_idle_lengths_without_original(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport=RichGarmin('lap_swimming')
            transport.data['summaryDTO'].update({'poolLength':25,'unitOfPoolLength':{'unitKey':'meter'},'numberOfActiveLengths':1,'duration':2})
            transport.splits=lambda _: {'lapDTOs':[{'duration':2,'elapsedDuration':2,'lengthDTOs':[
                {'lengthIndex':1,'distance':25,'duration':1,'swimStroke':'FREESTYLE','totalNumberOfStrokes':15},
                {'lengthIndex':2,'distance':None,'duration':1,'swimStroke':None,'totalNumberOfStrokes':None}]}]}
            result=extract(transport,'12345',directory,automatic=True)
            self.assertIsNone(result['bundle']['original'])
            self.assertNotIn('original',transport.calls)

    def test_optional_sensors_and_sets_never_request_fit(self):
        for sport in ('cycling','running','strength_training'):
            with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
                transport=RichGarmin(sport)
                if sport=='strength_training': transport.sets=lambda _: {'availability':'unavailable'}
                result=extract(transport,'12345',directory,automatic=True)
                self.assertIsNone(result['bundle']['original'])
                self.assertNotIn('original',transport.calls)

    def test_capped_chart_pauses_and_pool_lengths_have_explicit_fit_fallback(self):
        for reason,sport in [('chart_sample_coverage_unverified','cycling'),('running_timer_transitions_unverified','running'),('pool_idle_length_semantics_unverified','lap_swimming')]:
            with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
                transport=RichGarmin(sport)
                if sport!='lap_swimming':transport.chart['totalMetricsCount']=10
                if sport=='running':transport.chart['activityDetailMetrics'][1]['metrics'][1]=.5
                result=extract(transport,'12345',directory,automatic=True)
                self.assertIn('original',transport.calls)
                detail=read_json(result['folder']/'detail-0.json')
                self.assertIn(reason,detail['acquisition']['fallbackReasons'])
                if sport!='lap_swimming':
                    self.assertEqual(transport.calls.count('charts'),1)
                    self.assertNotIn('detail',transport.calls)
                else:
                    self.assertNotIn('charts',transport.calls)
                    self.assertNotIn('splits',transport.calls)

    def test_nonallowlisted_sports_never_auto_download_fit_and_manual_walk_still_works(self):
        for sport in ('walking','rowing','indoor_rowing','stand_up_paddleboarding','unknown'):
            with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
                transport=RichGarmin(sport)
                with self.assertRaisesRegex(ExtractionError,'ON_DEMAND'):
                    extract(transport,'12345',directory,automatic=True)
                self.assertEqual(transport.calls,['metadata'])
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport=RichGarmin('walking')
            extract(transport,'12345',directory,force=True,automatic=True)
            self.assertIn('original',transport.calls)

    def test_changed_metadata_and_missing_chunk_repair_without_claiming_complete(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport=RichGarmin()
            first=extract(transport,'12345',directory,automatic=True)
            (first['folder']/'laps-0.json').unlink()
            transport.calls.clear()
            self.assertFalse(extract(transport,'12345',directory,automatic=True)['cached'])
            self.assertIn('splits',transport.calls)
            transport.data['summaryDTO']['distance']=7
            second=extract(transport,'12345',directory,automatic=True)
            self.assertNotEqual(first['bundle']['snapshot']['contentHash'],second['bundle']['snapshot']['contentHash'])

    def test_reobserving_old_fit_content_has_fresh_attempt_time_without_rewriting_history(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
            transport=RichGarmin()
            first=extract(transport,'12345',directory)
            bundle=first['bundle'];bundle['snapshot']['sourceUpdatedAt']='2000-01-01T00:00:00.000Z'
            (first['folder']/'bundle.json').write_text(__import__('json').dumps(bundle))
            renewed=extract(transport,'12345',directory,force=True)
            self.assertNotEqual(renewed['bundle']['snapshot']['sourceUpdatedAt'],'2000-01-01T00:00:00.000Z')
            self.assertEqual(read_json(first['folder']/'bundle.json')['snapshot']['sourceUpdatedAt'],'2000-01-01T00:00:00.000Z')
            self.assertEqual(renewed['bundle']['snapshot']['contentHash'],first['bundle']['snapshot']['contentHash'])

    def test_auth_and_rate_limit_do_not_trigger_original_or_retry(self):
        for code in ('GARMIN_RATE_LIMITED_RETRY_LATER','GARMIN_ACCESS_DENIED_REAUTHENTICATE'):
            with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
                transport=RichGarmin()
                def fail(_):raise ExtractionError(code)
                transport.rich_details=fail
                with self.assertRaisesRegex(ExtractionError,code):extract(transport,'12345',directory,automatic=True)
                self.assertNotIn('original',transport.calls)
