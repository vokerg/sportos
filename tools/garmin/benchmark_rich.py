"""Opt-in local read-only endpoint benchmark; prints aggregate counters only.
Originals and native responses live only in a private temporary directory.
"""
import argparse
import json
import tempfile
import time
from pathlib import Path
from extract_activity import DEFAULT_HOME, ExtractionError, activity_id, encoded, extract, login


def benchmark(identifier, automatic):
    started=time.monotonic()
    transport=login(DEFAULT_HOME/'tokens')
    auth=time.monotonic()-started
    class Measured:
        def __init__(self):self.calls=[];self.bytes=0
        def __getattr__(self,key):
            method=getattr(transport,key)
            def call(*args,**kwargs):
                self.calls.append(key)
                value=method(*args,**kwargs)
                self.bytes+=len(value) if isinstance(value,bytes) else len(encoded(value))
                return value
            return call
    measured=Measured()
    with tempfile.TemporaryDirectory(prefix='sportos-rich-benchmark-',dir=Path(tempfile.gettempdir()).resolve()) as output:
        result=extract(measured,identifier,output,automatic=automatic)
        metadata=json.loads((result['folder']/'detail-0.json').read_text())
        return {'sport':metadata['metadata']['activityTypeDTO']['typeKey'],'mode':'after' if automatic else 'before',
                'seconds':round(time.monotonic()-started,3),'authSeconds':round(auth,3),'endpoints':measured.calls,
                'endpointCount':len(measured.calls),'responseBytes':measured.bytes,'fitDownloads':measured.calls.count('original'),
                'retainedBytes':sum(item['size'] for item in result['bundle']['files'])}


def benchmark_day(value, automatic):
    from fetch_day import fetch_day
    from rich_policy import AUTO_TYPES
    started=time.monotonic();auth=0;logins=0;endpoints=0;response_bytes=0;fit_downloads=0
    def session():
        nonlocal auth,logins
        clock=time.monotonic();transport=login(DEFAULT_HOME/'tokens');auth+=time.monotonic()-clock;logins+=1
        transport.client.client._api_session.count=0
        transport.client.client._api_session.byte_count=0
        return transport
    transport=session()
    day=fetch_day(transport,value)
    counters=transport.client.client._api_session
    endpoints+=counters.count;response_bytes+=counters.byte_count
    category=next((row for row in day['categories'] if row['category']=='activities'),{})
    if category.get('state')!='available':raise ExtractionError('BENCHMARK_DISCOVERY_UNAVAILABLE')
    discovery=json.loads((DEFAULT_HOME/'days'/category['sourceHash']/'payload.json').read_text())
    items=[row for row in discovery.get('items',[]) if (row.get('activityType') or {}).get('typeKey') in AUTO_TYPES]
    if not discovery.get('complete') or not 1<=len(items)<=4:raise ExtractionError('BENCHMARK_REQUIRES_ONE_TO_FOUR_ACTIVITIES')
    transport=None
    with tempfile.TemporaryDirectory(prefix='sportos-day-benchmark-',dir=Path(tempfile.gettempdir()).resolve()) as directory:
        for index,item in enumerate(items):
            if not automatic or transport is None:transport=session()
            original=transport.original
            def counted(identifier):
                nonlocal fit_downloads
                fit_downloads+=1;return original(identifier)
            transport.original=counted
            extract(transport,activity_id(item['activityId']),Path(directory)/str(index),automatic=automatic)
            transport.original=original
            if not automatic:
                counters=transport.client.client._api_session
                endpoints+=counters.count;response_bytes+=counters.byte_count;transport=None
        if transport:
            counters=transport.client.client._api_session
            endpoints+=counters.count;response_bytes+=counters.byte_count
    return {'mode':'after' if automatic else 'before','activities':len(items),'seconds':round(time.monotonic()-started,3),
            'authSeconds':round(auth,3),'logins':logins,'endpointCount':endpoints,'responseBytes':response_bytes,'fitDownloads':fit_downloads}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--activity-id',action='append')
    group.add_argument('--day')
    args=parser.parse_args()
    if args.activity_id and not 1<=len(args.activity_id)<=4:parser.error('Choose at most four representative activities.')
    operations=[(benchmark_day,args.day)] if args.day else [(benchmark,activity_id(raw)) for raw in args.activity_id]
    for operation,value in operations:
        for automatic in (False,True):
            try:print(json.dumps(operation(value,automatic)),flush=True)
            except Exception as error:print(json.dumps({'mode':'after' if automatic else 'before','failure':error.code if isinstance(error,ExtractionError) else 'GARMIN_BENCHMARK_FAILED'}),flush=True)

if __name__=='__main__':main()
