import unittest
from collect_work_titles import collect_record, extract_titles, merge_works, select_preferred, ApiError


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, endpoint, **params):
        self.calls.append((endpoint, params))
        return self.responses[endpoint]


class TitleCollectionTests(unittest.TestCase):
    def setUp(self):
        self.record = {'key': '旧译名|2012', 'title': '旧译名', 'year': 2012, 'mediaType': 'movie',
                       'source': 'https://www.imdb.com/title/tt123/'}
        self.detail = {'id': 1, 'title': '常用名', 'original_title': 'Original', 'original_language': 'en',
                       'imdb_id': 'tt123', 'release_date': '2012-01-01',
                       'alternative_titles': {'titles': [{'title': '旧译名', 'iso_3166_1': 'CN'}]},
                       'translations': {'translations': [{'iso_639_1': 'zh', 'iso_3166_1': 'TW', 'data': {'title': '地區譯名'}}]}}

    def client(self):
        return FakeClient({'/find/tt123': {'movie_results': [{'id': 1}]}, '/movie/1': self.detail})

    def test_external_id_resolves_titles_and_keeps_provenance(self):
        work, status = collect_record(self.client(), self.record, {})
        self.assertEqual(status, 'confirmed')
        self.assertEqual(work['id'], 'tmdb:movie:1')
        self.assertEqual(work['title'], '常用名')
        self.assertIn('旧译名', work['aliases'])
        self.assertIn('地區譯名', work['aliases'])
        self.assertTrue(all(t['source'].startswith('https://api.themoviedb.org/') for t in work['titles']))

    def test_rejects_conflicting_year_type_and_external_identity(self):
        for field, value in [('release_date', '2019-01-01'), ('release_date', None), ('imdb_id', 'tt999')]:
            before = self.detail[field]
            self.detail[field] = value
            self.assertIsNone(collect_record(self.client(), self.record, {})[0])
            self.detail[field] = before
        self.record['mediaType'] = 'tv'
        self.assertIsNone(collect_record(self.client(), self.record, {})[0])

    def test_title_and_year_alone_are_not_enough(self):
        self.record.pop('source')
        client = FakeClient({'/search/movie': {'results': [{'id': 1, 'release_date': '2012-01-01'}]}, '/movie/1': self.detail})
        self.assertEqual(collect_record(client, self.record, {})[1], 'identity_unconfirmed')
        self.record['director'] = '导演甲'
        self.detail['credits'] = {'crew': [{'name': '导演甲', 'job': 'Director'}]}
        self.assertEqual(collect_record(client, self.record, {})[1], 'confirmed')

    def test_multiple_matching_works_require_review(self):
        self.record.pop('source'); self.record['cast'] = '演员甲'
        self.detail['credits'] = {'cast': [{'name': '演员甲'}]}
        client = FakeClient({'/search/movie': {'results': [{'id': i, 'release_date': '2012-01-01'} for i in [1, 2]]},
                             '/movie/1': self.detail, '/movie/2': self.detail})
        self.assertEqual(collect_record(client, self.record, {})[1], 'ambiguous')

    def test_shared_actor_and_year_do_not_validate_a_different_title(self):
        self.record.pop('source'); self.record['cast'] = '演员甲'; self.record['title'] = '另一部片'
        self.detail['credits'] = {'cast': [{'name': '演员甲'}]}
        client = FakeClient({'/search/movie': {'results': [{'id': 1, 'release_date': '2012-01-01'}]}, '/movie/1': self.detail})
        self.assertEqual(collect_record(client, self.record, {})[1], 'identity_unconfirmed')

    def test_existing_external_id_with_a_conflicting_title_requires_review(self):
        self.record['title'] = '另一部同年电影'
        self.assertEqual(collect_record(self.client(), self.record, {})[1], 'identity_unconfirmed')
        work, status = collect_record(self.client(), self.record, {
            'tmdbId': 1, 'mediaType': 'movie', 'evidence': 'https://example.org/reviewed-identity'})
        self.assertEqual(status, 'confirmed')
        self.assertEqual(work['id'], 'tmdb:movie:1')

    def test_chinese_alias_precedes_original_japanese_title(self):
        self.detail['original_title'] = '日本語の原題'
        self.detail['original_language'] = 'ja'
        work, status = collect_record(self.client(), self.record, {})
        self.assertEqual(status, 'confirmed')
        self.assertLess(work['aliases'].index('地區譯名'), work['aliases'].index('日本語の原題'))

    def test_override_cannot_introduce_unverified_names_or_ids(self):
        titles = extract_titles(self.detail, 'movie', 1)
        self.assertEqual(select_preferred(self.record, titles, {'preferredTitle': '旧译名'}), '旧译名')
        with self.assertRaises(ApiError):
            select_preferred(self.record, titles, {'preferredTitle': '虚构译名'})
        self.assertEqual(collect_record(self.client(), self.record, {'tmdbId': 2, 'mediaType': 'movie'})[1], 'override_requires_identity_evidence')

    def test_partial_updates_preserve_other_records_and_replace_stale_identity(self):
        work, _ = collect_record(self.client(), self.record, {})
        other = {**work, 'id': 'tmdb:movie:2', 'metadataKeys': ['其他|2012'], 'identityEvidence': [{'key': '其他|2012'}]}
        replacement = {**work, 'id': 'tmdb:movie:3'}
        result = merge_works([work, other], [replacement])
        self.assertEqual([w['id'] for w in result], ['tmdb:movie:2', 'tmdb:movie:3'])
        self.assertEqual(merge_works(result, [replacement]), result)


if __name__ == '__main__':
    unittest.main()
