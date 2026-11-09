#!/usr/bin/env python3
"""Offline TMDB title collector. Credentials never appear in URLs, caches or reports."""
import argparse
import concurrent.futures
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import threading
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
API = 'https://api.themoviedb.org/3'


def title_key(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', value).lower()
                   if c.isalnum())


def names(value):
    return {title_key(n) for n in re.split(r'[,，、/;；]', value or '') if n.strip()}


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        temp = Path(handle.name)
    temp.replace(path)


def load_token():
    # Match Next.js precedence without evaluating shell or expanding arbitrary strings.
    env = {}
    for name in ['.env', '.env.local', '.env.development.local']:
        p = ROOT / name
        if p.exists():
            for line in p.read_text().splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('\"\'')
    return os.environ.get('TMDB_API_READ_ACCESS_TOKEN') or env.get('TMDB_API_READ_ACCESS_TOKEN')


class ApiError(Exception):
    pass


class Client:
    def __init__(self, token, cache, offline=False):
        self.token, self.cache, self.offline = token, cache, offline
        self.lock = threading.Lock()
        self.next_request = 0

    def get(self, endpoint, **params):
        query = urllib.parse.urlencode(sorted(params.items()))
        url = API + endpoint + ('?' + query if query else '')
        cache_key = hashlib.sha256(url.encode()).hexdigest()
        path = self.cache / (cache_key + '.json')
        cached = read_json(path, None)
        if cached and (self.offline or time.time() - cached['fetchedAt'] < 30 * 86400):
            return cached['data']
        if self.offline:
            raise ApiError('offline_cache_miss')
        for attempt in range(3):
            with self.lock:
                delay = max(0, self.next_request - time.monotonic())
                self.next_request = time.monotonic() + delay + 0.34
            if delay:
                time.sleep(delay)
            req = urllib.request.Request(url, headers={
                'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json',
                'User-Agent': 'HomeTV-TitleCollector/1.0',
            })
            try:
                with urllib.request.urlopen(req, timeout=15) as response:
                    data = json.load(response)
                write_json(path, {'fetchedAt': time.time(), 'url': url, 'data': data})
                return data
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    raise ApiError('authentication_failed') from None
                if error.code == 429 or error.code >= 500:
                    try:
                        delay = min(60, max(1, float(error.headers.get('Retry-After', 2 ** attempt))))
                    except (TypeError, ValueError):
                        delay = 2 ** attempt
                    time.sleep(delay)
                    continue
                raise ApiError('http_' + str(error.code)) from None
            except (OSError, ValueError, http.client.HTTPException):
                if attempt < 2:
                    time.sleep(2 ** attempt)
        raise ApiError('request_failed')


def identity_links(record):
    source = record.get('source') or ''
    tmdb = re.search(r'themoviedb\.org/(movie|tv)/(\d+)', source)
    imdb = re.search(r'imdb\.com/title/(tt\d+)', source)
    return (tmdb.group(1), int(tmdb.group(2))) if tmdb else None, imdb.group(1) if imdb else None


def credits_match(record, detail):
    credits = detail.get('credits') or {}
    directors = credits.get('crew', [])
    people = [(record.get('director'), [p for p in directors if p.get('job') == 'Director']),
              (record.get('cast'), credits.get('cast', []))]
    for local_names, remote in people:
        remote_names = {title_key(p.get(field, '')) for p in remote for field in ['name', 'original_name']}
        if names(local_names) & remote_names - {''}:
            return True
    return False


def extract_titles(detail, kind, tmdb_id):
    """Keep provenance per name; Chinese script conversion is not an identity proof."""
    base = f'{API}/{kind}/{tmdb_id}'
    titles = []
    def add(title, language, region, source):
        if isinstance(title, str) and 0 < len(title.strip()) <= 100:
            titles.append({'title': title.strip(), 'language': language, 'region': region, 'source': source})
    field = 'title' if kind == 'movie' else 'name'
    add(detail.get(field), 'zh', 'CN', base + '?language=zh-CN')
    add(detail.get('original_' + field), detail.get('original_language', ''), '', base)
    for entry in detail.get('translations', {}).get('translations', []):
        if entry.get('iso_639_1') in ('zh', 'en'):
            add(entry.get('data', {}).get(field), entry.get('iso_639_1'), entry.get('iso_3166_1', ''), base + '/translations')
    alt = detail.get('alternative_titles', {})
    for entry in alt.get('titles', alt.get('results', [])):
        if entry.get('iso_3166_1') in ('CN', 'TW', 'HK'):
            add(entry.get('title'), '', entry['iso_3166_1'], base + '/alternative_titles')
    unique = {}
    for entry in titles:
        unique.setdefault((entry['title'], entry['region']), entry)
    return list(unique.values())


def select_preferred(record, titles, override):
    requested = override.get('preferredTitle')
    if requested:
        if requested not in {t['title'] for t in titles}:
            raise ApiError('override_title_has_no_evidence')
        return requested
    # A localized API response can fall back to an English/original title.
    chinese = [t for t in titles if re.search(r'[\u3400-\u9fff]', t['title'])]
    mainland = [t for t in chinese if t['region'] == 'CN']
    return (mainland or chinese or [{'title': record['title']}])[0]['title']


def collect_record(client, record, override, trace=None):
    if override.get('skip'):
        return None, 'manually_excluded'
    direct, imdb = identity_links(record)
    if override.get('tmdbId'):
        if not override.get('evidence') or override.get('mediaType') not in ('movie', 'tv'):
            return None, 'override_requires_identity_evidence'
        direct = (override['mediaType'], int(override['tmdbId']))
    expected_type = record.get('mediaType', 'unknown')
    candidates = []
    method = 'manual_override' if override.get('tmdbId') else 'external_id'
    if direct:
        candidates = [direct]
    elif imdb:
        found = client.get('/find/' + imdb, external_source='imdb_id')
        candidates = [(kind, row['id']) for kind in ('movie', 'tv')
                      for row in found.get(kind + '_results', [])]
    else:
        method = 'title_year_credits'
        kinds = [expected_type] if expected_type in ('movie', 'tv') else ['movie', 'tv']
        for kind in kinds:
            year_param = 'primary_release_year' if kind == 'movie' else 'first_air_date_year'
            found = client.get('/search/' + kind, query=record['title'], language='zh-CN', **{year_param: record['year']})
            date = 'release_date' if kind == 'movie' else 'first_air_date'
            candidates += [(kind, row['id']) for row in found.get('results', [])
                           if str(row.get(date, ''))[:4] == str(record['year'])][:5]
    if not candidates:
        return None, 'not_found'
    accepted = []
    for kind, tmdb_id in set(candidates):
        candidate = {'id': f'tmdb:{kind}:{tmdb_id}', 'status': 'type_conflict'}
        if trace is not None:
            trace.append(candidate)
        if expected_type in ('movie', 'tv') and expected_type != kind:
            continue
        detail = client.get(f'/{kind}/{tmdb_id}', language='zh-CN', append_to_response='translations,alternative_titles,credits,external_ids')
        date = detail.get('release_date' if kind == 'movie' else 'first_air_date') or ''
        candidate.update({'title': detail.get('title') or detail.get('name'), 'date': date, 'status': 'year_conflict'})
        if date[:4] != str(record['year']):
            continue
        candidate['status'] = 'credits_unconfirmed'
        if method == 'title_year_credits' and not credits_match(record, detail):
            continue
        # An explicit conflicting IMDb ID must never be silently accepted.
        remote_imdb = detail.get('imdb_id') or detail.get('external_ids', {}).get('imdb_id')
        candidate['status'] = 'external_id_conflict'
        if imdb and remote_imdb and remote_imdb != imdb and not override.get('tmdbId'):
            continue
        titles = extract_titles(detail, kind, tmdb_id)
        candidate['status'] = 'title_unconfirmed'
        # Existing poster/source links can themselves be wrong. Automatic publication also
        # requires a matching title; a reviewed explicit ID override may resolve that gap.
        if not override.get('tmdbId') and title_key(record['title']) not in {title_key(t['title']) for t in titles}:
            continue
        preferred = select_preferred(record, titles, override)
        # Region/language evidence, rather than CJK characters alone, prioritizes Chinese
        # aliases ahead of a Japanese/Korean original when the displayed name is queried.
        ordered_titles = sorted(titles, key=lambda t: not (
            (t['language'] == 'zh' or t['region'] in ('CN', 'TW', 'HK'))
            and re.search(r'[\u3400-\u9fff]', t['title'])))
        candidate['status'] = 'matched'
        accepted.append({
            'id': f'tmdb:{kind}:{tmdb_id}', 'title': preferred, 'year': record['year'], 'mediaType': kind,
            'originalTitle': detail.get('original_title' if kind == 'movie' else 'original_name', ''),
            'aliases': list(dict.fromkeys([record['title']] + [t['title'] for t in ordered_titles if t['title'] != preferred])),
            'metadataKeys': [record['key']], 'titles': titles,
            'identityEvidence': [{'key': record['key'], 'method': method,
                                  'source': override.get('evidence') or record.get('source') or f'https://www.themoviedb.org/{kind}/{tmdb_id}'}],
        })
    if len(accepted) != 1:
        return None, 'ambiguous' if len(accepted) > 1 else 'identity_unconfirmed'
    return accepted[0], 'confirmed'


def merge_works(previous, collected, reviewed_keys=()):
    # Updating a metadata key removes its stale mapping; untouched work records survive partial runs.
    updated_keys = {k for work in collected for k in work['metadataKeys']} | set(reviewed_keys)
    by_id = {}
    for work in previous:
        retained = [k for k in work['metadataKeys'] if k not in updated_keys]
        if retained:
            by_id[work['id']] = {**work, 'metadataKeys': retained,
                                'identityEvidence': [e for e in work['identityEvidence'] if e['key'] in retained]}
    for work in collected:
        old = by_id.get(work['id'])
        if old:
            for field in ('metadataKeys', 'aliases'):
                work[field] = list(dict.fromkeys(old[field] + work[field]))
            for field in ('titles', 'identityEvidence'):
                work[field] = list({json.dumps(row, sort_keys=True): row for row in old[field] + work[field]}.values())
        by_id[work['id']] = work
    return sorted(by_id.values(), key=lambda work: work['id'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / '.data/tmdb/manifest.json')
    parser.add_argument('--key', action='append', help='Exact title|year; repeatable')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--offline', action='store_true', help='Use cached responses only')
    parser.add_argument('--apply', action='store_true', help='Publish confirmed entries; default is report only')
    args = parser.parse_args()
    token = load_token()
    if not token and not args.offline:
        parser.error('TMDB_API_READ_ACCESS_TOKEN is missing; put it in .env.local')
    if not args.manifest.exists():
        parser.error('Manifest missing; run node scripts/export-work-manifest.mjs first')
    records = read_json(args.manifest, [])
    if args.key:
        records = [r for r in records if r['key'] in args.key]
    records.sort(key=lambda r: (not any(identity_links(r)), r['key']))
    if args.limit:
        records = records[:args.limit]
    overrides = read_json(ROOT / 'config/work-title-overrides.json', {})
    client = Client(token or '', ROOT / '.data/tmdb/responses', args.offline)
    report, collected = [], []
    def collect(record):
        trace = []
        try:
            work, status = collect_record(client, record, overrides.get(record['key'], {}), trace)
            return record['key'], work, status, trace
        except ApiError as error:
            return record['key'], None, str(error), trace
        except Exception as error:
            # A malformed provider record must not prevent the remaining 1,000+ records from finishing.
            # Do not log exception messages: HTTP libraries may include sensitive request information.
            return record['key'], None, 'invalid_response_' + type(error).__name__, trace
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for future in concurrent.futures.as_completed([pool.submit(collect, r) for r in records]):
            key, work, status, trace = future.result()
            report.append({'key': key, 'status': status, **({'workId': work['id']} if work else {'candidates': trace})})
            if work:
                collected.append(work)
            if len(report) % 25 == 0:
                print(f'Processed {len(report)}/{len(records)}; confirmed {len(collected)}', flush=True)
    generated = datetime.now(timezone.utc).isoformat()
    counts = {s: sum(r['status'] == s for r in report) for s in sorted({r['status'] for r in report})}
    report_data = {'generatedAt': generated, 'counts': counts, 'records': sorted(report, key=lambda r: r['key'])}
    write_json(ROOT / '.data/tmdb/title-report.json', report_data)
    write_json(ROOT / '.data/tmdb/title-candidates.json', {'version': 1, 'works': collected})
    if args.apply:
        path = ROOT / 'src/lib/work-title-data.json'
        evidence_path = ROOT / 'docs/work-title-evidence.json'
        previous = read_json(evidence_path, read_json(path, {'works': []}))['works']
        reviewed = [r['key'] for r in report if r['status'] in ('confirmed', 'ambiguous', 'identity_unconfirmed', 'manually_excluded', 'not_found')]
        works = merge_works(previous, sorted(collected, key=lambda w: w['metadataKeys'][0]), reviewed)
        write_json(evidence_path, {'version': 1, 'works': works})
        # Do not ship per-name API URLs and audit evidence to every browser.
        fields = ('id', 'title', 'year', 'mediaType', 'originalTitle', 'aliases', 'metadataKeys')
        write_json(path, {'version': 1, 'works': [{k: work[k] for k in fields} for work in works]})
        write_json(ROOT / 'docs/work-title-collection-report.json', report_data)
    print(json.dumps({'processed': len(records), 'counts': counts, 'applied': args.apply}, ensure_ascii=False))
    if any(s in counts for s in ('authentication_failed', 'request_failed')):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
