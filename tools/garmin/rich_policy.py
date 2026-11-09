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
    columns = {}
    indexes = set()
    for descriptor in descriptors:
        if not isinstance(descriptor, dict): return None
        key = descriptor.get('key'); index = descriptor.get('metricsIndex')
        if not isinstance(key, str) or key in columns or not isinstance(index, int) or index < 0 or index in indexes: return None
        indexes.add(index)
        if any(not isinstance(row, dict) or not isinstance(row.get('metrics'), list) or index >= len(row['metrics']) for row in rows): return None
        columns[key] = [row['metrics'][index] for row in rows]
    times = columns.get('directTimestamp', [])
    if len(times) != len(rows) or any(not number(t) for t in times) or any(b <= a or b-a > 30000 for a,b in zip(times,times[1:])):
        return None
    return columns


def decision(metadata, detail, splits, sets):
    sport = metadata.get('activityTypeDTO', {}).get('typeKey')
    summary = metadata.get('summaryDTO', {})
    reasons = []
    features = {'summary': 'available', 'original': 'on_demand'}
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
        good_laps = isinstance(laps, list) and 0 < len(laps) <= 100 and all(isinstance(lap, dict) and number(lap.get('duration')) and number(lap.get('elapsedDuration')) for lap in laps)
        features['laps'] = 'available' if good_laps else 'incomplete'
        if not good_laps: reasons.append('lap_timer_coverage_unverified')
        if sport in ('running','track_running','trail_running','treadmill_running'):
            # Do not infer pause transitions from speed, GPS or moving duration.
            # JSON with pauses currently lacks a verified native timer event
            # interpretation. Uninterrupted recordings can prove continuous time.
            duration = summary.get('duration'); elapsed = summary.get('elapsedDuration')
            timer = columns.get('sumDuration', []) if columns else []
            timestamps = columns.get('directTimestamp', []) if columns else []
            distance = columns.get('sumDistance', []) if columns else []
            continuous = number(duration) and number(elapsed) and abs(duration-elapsed) <= .1 and len(timer) == len(timestamps) == len(distance) and len(timer) >= 2
            if continuous:
                continuous = all(number(v) for v in timer+distance) and all(abs((b-a)-(y-x)/1000) <= .02 for a,b,x,y in zip(timer,timer[1:],timestamps,timestamps[1:])) and all(b>=a for a,b in zip(distance,distance[1:]))
            features['efforts'] = 'available' if continuous else 'incomplete'
            if not continuous: reasons.append('running_timer_transitions_unverified')
        if sport == 'lap_swimming':
            # Real-device comparison proves active durations/strokes, but the
            # sampled splits omit an explicit idle marker/timer-vs-elapsed field.
            # Keep FIT for pool lengths until idle/rest parity is established.
            features['poolLengths'] = 'incomplete'
            reasons.append('pool_idle_length_semantics_unverified')
        if sport not in ('lap_swimming','indoor_cycling','treadmill_running'):
            # No GPS on a legitimate workout is optional. When present, retain
            # the complete native chart geometry; existing Strava privacy wins.
            features['route'] = 'available' if columns and 'directLatitude' in columns and 'directLongitude' in columns else 'not_recorded'
    return {'version': VERSION, 'kind': 'fit' if reasons else 'json', 'features': features, 'fallbackReasons': reasons}
