"""Versioned native Connect capability gates. Never manufactures FIT messages.

Charts contain already decoded values: unit.factor describes the wire profile,
not a scale to apply again. Only centimeter dynamics need conversion at readers.
"""
import math

VERSION = 1
AUTO_TYPES = {'running', 'treadmill_running', 'track_running', 'trail_running',
              'cycling', 'indoor_cycling', 'lap_swimming', 'open_water_swimming', 'strength_training'}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def chart_columns(detail):
    if not isinstance(detail, dict) or detail.get('pendingData') is True:
        return None
    descriptors = detail.get('metricDescriptors'); rows = detail.get('activityDetailMetrics')
    if not isinstance(descriptors, list) or not isinstance(rows, list) or not 2 <= len(rows) <= 150000:
        return None
    if detail.get('totalMetricsCount') != len(rows):
        return None  # A decimated chart is not equivalent retained telemetry.
    units = {'directTimestamp':'gmt','sumDuration':'second','sumElapsedDuration':'second','sumDistance':'meter','directSpeed':'mps','directLatitude':'dd','directLongitude':'dd','directElevation':'meter','directHeartRate':'bpm','directRunCadence':'stepsPerMinute','directBikeCadence':'rpm','directPower':'watt','directGroundContactTime':'ms','directVerticalOscillation':'centimeter'}
    columns = {}
    indexes = set()
    for descriptor in descriptors:
        if not isinstance(descriptor, dict): return None
        key = descriptor.get('key'); index = descriptor.get('metricsIndex')
        if not isinstance(key, str) or key in columns or type(index) is not int or index < 0 or index in indexes: return None
        if key in units and (descriptor.get('unit') or {}).get('key') != units[key]: return None
        indexes.add(index)
        if any(not isinstance(row, dict) or not isinstance(row.get('metrics'), list) or index >= len(row['metrics']) for row in rows): return None
        columns[key] = [row['metrics'][index] for row in rows]
    times = columns.get('directTimestamp', [])
    if len(times) != len(rows) or any(not number(t) or t<0 or t>7258118400000 or t-times[0]>604800000 for t in times) or any(b <= a for a,b in zip(times,times[1:])):
        return None
    return columns


def decision(metadata, detail, splits, sets):
    sport = metadata.get('activityTypeDTO', {}).get('typeKey')
    summary = metadata.get('summaryDTO', {})
    reasons = []
    features = {'summary': 'available', 'original': 'on_demand'}
    optional_gaps = ['total_work_unit_unverified'] if summary.get('totalWork') is not None else []
    features['metrics'] = 'partial' if optional_gaps else 'available'
    if sport not in AUTO_TYPES:
        return {'version': VERSION, 'kind': 'summary', 'features': features, 'fallbackReasons': []}
    columns = chart_columns(detail)
    features['timeline'] = 'available' if columns else 'incomplete'
    if not columns: reasons.append('chart_sample_coverage_unverified')
    # Strength has no consumed laps or route. Set classification remains the
    # existing fail-closed normalizer; missing sets never imply zero or need FIT.
    if sport == 'strength_training':
        features['strength'] = 'available' if isinstance(sets, dict) and isinstance(sets.get('exerciseSets'), list) and sets['exerciseSets'] else 'incomplete'
    else:
        laps = splits.get('lapDTOs') if isinstance(splits, dict) else None
        good_laps = isinstance(laps, list) and 0 < len(laps) <= 100 and all(isinstance(lap, dict) and number(lap.get('duration')) and 0<=lap['duration']<=604800 and number(lap.get('elapsedDuration')) and 0<=lap['elapsedDuration']<=604800 for lap in laps)
        features['laps'] = 'available' if good_laps else 'incomplete'
        if not good_laps: reasons.append('lap_timer_coverage_unverified')
        if sport in ('running','track_running','trail_running','treadmill_running'):
            # Do not infer pause transitions from speed, GPS or moving duration.
            # Cumulative timer deltas prove wholly active or wholly stopped
            # intervals. Mixed transitions and unrecorded active gaps fail closed.
            timer = columns.get('sumDuration', []) if columns else []
            timestamps = columns.get('directTimestamp', []) if columns else []
            distance = columns.get('sumDistance', []) if columns else []
            continuous = len(timer) == len(timestamps) == len(distance) and len(timer) >= 2 and all(number(v) for v in timer+distance)
            if continuous:
                for a,b,x,y,d,e in zip(timer,timer[1:],timestamps,timestamps[1:],distance,distance[1:]):
                    active=b-a; elapsed=(y-x)/1000
                    if e<d or not (abs(active)<=.000001 or (elapsed<=30 and abs(active-elapsed)<=.000001)):
                        continuous=False;break
            features['efforts'] = 'available' if continuous else 'incomplete'
            if not continuous: reasons.append('running_timer_transitions_unverified')
        if sport == 'lap_swimming':
            # Real-device comparison proves active durations/strokes, but the
            # sampled splits omit an explicit idle marker/timer-vs-elapsed field.
            # Keep FIT for pool lengths until idle/rest parity is established.
            covered=pool_lengths_covered(summary,splits)
            features['poolLengths'] = 'available' if covered else 'incomplete'
            if not covered: reasons.append('pool_idle_length_semantics_unverified')
        if sport not in ('lap_swimming','indoor_cycling','treadmill_running'):
            # No GPS on a legitimate workout is optional. When present, retain
            # the complete native chart geometry; existing Strava privacy wins.
            features['route'] = 'available' if columns and 'directLatitude' in columns and 'directLongitude' in columns else 'not_recorded'
    return {'version': VERSION, 'kind': 'fit' if reasons else 'json', 'features': features, 'fallbackReasons': reasons, 'optionalGaps':optional_gaps}


def mandatory_preflight(metadata):
    """Known unsupported semantics need no expensive speculative JSON probes."""
    sport=(metadata.get('activityTypeDTO') or {}).get('typeKey')
    summary=metadata.get('summaryDTO') or {}
    if sport=='lap_swimming' and (summary.get('poolLength')!=25 or (summary.get('unitOfPoolLength') or {}).get('unitKey')!='meter'):
        return {'version':VERSION,'kind':'fit','features':{'summary':'available','poolLengths':'incomplete','original':'on_demand'},'fallbackReasons':['pool_idle_length_semantics_unverified']}
    return None


def pool_lengths_covered(summary, splits):
    # Verified real-device shape: idle rows omit or null distance,
    # stroke and strokes; active rows carry one full pool distance. Missing
    # fields are accepted only with exact active counts, sequence and duration checks.
    if summary.get('poolLength') != 25 or (summary.get('unitOfPoolLength') or {}).get('unitKey') != 'meter': return False
    laps=splits.get('lapDTOs') if isinstance(splits,dict) else None
    if not isinstance(laps,list) or not 1<=len(laps)<=100:return False
    rows=[]; active=0
    for lap in laps:
        lengths=lap.get('lengthDTOs') if isinstance(lap,dict) else None
        if not isinstance(lengths,list) or not lengths:return False
        for row in lengths:
            if not isinstance(row,dict) or not number(row.get('duration')) or not 0<row['duration']<=86400:return False
            if row.get('distance') == 25:active+=1
            elif not all(row.get(key) is None for key in ('distance','swimStroke','totalNumberOfStrokes')):return False
            rows.append(row)
        if not number(lap.get('duration')) or abs(sum(row['duration'] for row in lengths)-lap['duration'])>.1:return False
    if not 1<=len(rows)<=2000:return False
    if [row.get('lengthIndex') for row in rows]!=list(range(1,len(rows)+1)):return False
    return summary.get('numberOfActiveLengths')==active and number(summary.get('duration')) and abs(sum(row['duration'] for row in rows)-summary['duration'])<=.1
