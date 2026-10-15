import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sync_iptv_org as sync
from channel_names_zh import clean_channel_name, chinese_label, localize_metadata, split_metadata


def playlist(count=120):
    return ('#EXTM3U\n' + ''.join(
        f'#EXTINF:-1 tvg-id="en{i}" group-title="News",English {i}\nhttps://example.com/{i}.m3u8\n'
        for i in range(count))).encode()


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / 'english.m3u'
        self.state = self.root / 'state'
        self.curated = self.root / 'verified.m3u'
        self.curated.write_bytes(b'curated 27 channels')

    def run_sync(self, raw):
        return sync.synchronize(self.output, self.state, fetch=lambda: raw)

    def test_english_endpoint_and_preserve_curated(self):
        self.assertEqual(sync.UPSTREAM, 'https://iptv-org.github.io/iptv/languages/eng.m3u')
        self.assertEqual(self.run_sync(playlist())['channels'], 120)
        self.assertEqual(self.curated.read_bytes(), b'curated 27 channels')

    def test_deduplicate_and_ignore_unsupported_protocols(self):
        raw = playlist() + b'#EXTINF:-1,Duplicate\nhttps://example.com/1.m3u8\n#EXTINF:-1,UDP\nudp://example.com:1234\n'
        self.assertEqual(self.run_sync(raw)['channels'], 120)

    def test_html_truncated_and_empty_keep_last_good(self):
        self.run_sync(playlist())
        old = self.output.read_bytes()
        for raw in (b'<html>error</html>', b'#EXTM3U\n', playlist() + b'#EXTINF:-1,missing\n'):
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                self.run_sync(raw)
            self.assertEqual(self.output.read_bytes(), old)
        self.assertFalse(json.loads((self.state / 'last-result.json').read_text())['ok'])
        self.assertTrue(json.loads((self.state / 'last-success.json').read_text())['ok'])

    def test_network_failure_keeps_last_good(self):
        self.run_sync(playlist())
        old = self.output.read_bytes()
        def fail():
            raise TimeoutError('upstream timeout')
        with self.assertRaises(TimeoutError):
            sync.synchronize(self.output, self.state, fetch=fail)
        self.assertEqual(self.output.read_bytes(), old)

    def test_sharp_drop_keeps_last_good(self):
        self.run_sync(playlist(300))
        old = self.output.read_bytes()
        with self.assertRaises(ValueError):
            self.run_sync(playlist(120))
        self.assertEqual(self.output.read_bytes(), old)

    def test_unchanged_does_not_replace_published_file(self):
        self.run_sync(playlist())
        inode = self.output.stat().st_ino
        self.assertFalse(self.run_sync(playlist())['changed'])
        self.assertEqual(self.output.stat().st_ino, inode)

    def test_changed_retains_one_previous_version(self):
        self.run_sync(playlist())
        old = self.output.read_bytes()
        self.assertTrue(self.run_sync(playlist(121))['changed'])
        self.assertEqual((self.state / 'previous.m3u').read_bytes(), old)

    def test_failed_atomic_replace_keeps_published_file(self):
        self.run_sync(playlist())
        old = self.output.read_bytes()
        original = sync.os.replace
        def replace(source, target):
            if Path(target) == self.output:
                raise OSError('disk full')
            return original(source, target)
        with patch.object(sync.os, 'replace', side_effect=replace), self.assertRaises(OSError):
            self.run_sync(playlist(121))
        self.assertEqual(self.output.read_bytes(), old)

    def test_corrupt_status_is_rebuilt_without_replacing_valid_playlist(self):
        for invalid in ['{', 'null', '[]', '42', '"text"']:
            with self.subTest(invalid=invalid):
                self.run_sync(playlist())
                inode = self.output.stat().st_ino
                (self.state / 'last-success.json').write_text(invalid)
                self.assertFalse(self.run_sync(playlist())['changed'])
                self.assertEqual(self.output.stat().st_ino, inode)
                self.assertTrue(json.loads((self.state / 'last-success.json').read_text())['ok'])

    def test_failure_with_corrupt_status_is_recorded_and_next_run_recovers(self):
        self.run_sync(playlist())
        (self.state / 'last-success.json').write_text('{')
        def fail():
            raise TimeoutError('offline')
        with self.assertRaises(TimeoutError):
            sync.synchronize(self.output, self.state, fetch=fail)
        self.assertFalse(json.loads((self.state / 'last-result.json').read_text())['ok'])
        self.assertTrue(self.run_sync(playlist())['ok'])

    def test_corrupt_output_restores_backup_even_when_upstream_is_offline(self):
        self.run_sync(playlist())
        old = self.output.read_bytes()
        self.run_sync(playlist(121))
        self.output.write_bytes(b'truncated')
        def fail():
            raise TimeoutError('offline')
        with self.assertRaises(TimeoutError):
            sync.synchronize(self.output, self.state, fetch=fail)
        self.assertEqual(self.output.read_bytes(), old)
        self.assertEqual((self.state / 'previous.m3u').read_bytes(), old)
        result = json.loads((self.state / 'last-result.json').read_text())
        self.assertFalse(result['ok'])
        self.assertTrue(result['recoveredBackup'])
        self.assertTrue(self.run_sync(playlist(122))['ok'])

    def test_missing_output_restores_backup_and_keeps_drop_guard(self):
        self.run_sync(playlist(300))
        old = self.output.read_bytes()
        self.run_sync(playlist(301))
        self.output.unlink()
        with self.assertRaisesRegex(ValueError, 'dropped'):
            self.run_sync(playlist(120))
        self.assertEqual(self.output.read_bytes(), old)

    def test_bad_output_without_valid_backup_recovers_from_valid_upstream(self):
        self.run_sync(playlist())
        self.output.write_bytes(b'broken')
        (self.state / 'previous.m3u').write_bytes(b'also broken')
        self.assertTrue(self.run_sync(playlist(121))['changed'])
        self.assertEqual(sync.normalize(self.output.read_bytes())[1], 121)
        self.assertEqual(self.curated.read_bytes(), b'curated 27 channels')

    def test_invalid_backup_is_not_published(self):
        self.run_sync(playlist())
        self.output.write_bytes(b'broken')
        (self.state / 'previous.m3u').write_bytes(b'also broken')
        with self.assertRaises(ValueError):
            self.run_sync(b'<html>offline</html>')
        self.assertEqual(self.output.read_bytes(), b'broken')

    def test_status_write_failure_does_not_mask_original_error(self):
        self.run_sync(playlist())
        def fail():
            raise TimeoutError('original network error')
        with patch.object(sync, 'atomic_write', side_effect=OSError('disk full')), patch('sys.stderr'), self.assertRaisesRegex(TimeoutError, 'original network error'):
            sync.synchronize(self.output, self.state, fetch=fail)

    def test_chinese_suffix_keeps_original_metadata_and_url(self):
        raw = playlist().replace(b'English 0', b'BBC News (1080p)')
        self.run_sync(raw)
        text = self.output.read_text()
        self.assertIn('BBC News ｜ BBC新闻频道', text)
        self.assertIn('tvg-id="en0" group-title="News"', text)
        self.assertIn('https://example.com/0.m3u8', text)

    def test_quoted_comma_is_metadata_not_channel_title(self):
        info = '#EXTINF:-1 http-user-agent="Mozilla/5.0 (KHTML, like Gecko)" tvg-id="DW.de@English",DW English (1080p)'
        prefix, name = split_metadata(info)
        self.assertEqual(name, 'DW English (1080p)')
        self.assertEqual(localize_metadata(info), prefix + 'DW English ｜ 德国之声英语频道')

    def test_suffix_is_idempotent_and_does_not_include_quality_flags(self):
        info = '#EXTINF:-1,BBC News (1080p) [Not 24/7;Geo-blocked]'
        localized = localize_metadata(info)
        self.assertEqual(localize_metadata(localized), localized)
        self.assertTrue(localized.endswith('｜ BBC新闻频道'))

    def test_only_stream_annotations_are_removed(self):
        self.assertEqual(clean_channel_name('BBC News Africa (1080p) [Not 24/7]'), 'BBC News Africa')
        self.assertEqual(clean_channel_name('湖南卫视 4K（HEVC）'), '湖南卫视')
        for name in ['France 24', 'BBC One', '3ABN Canada', 'Channel 4', 'ABC (Australia)']:
            self.assertEqual(clean_channel_name(name), name)

    def test_unknown_call_sign_retained_with_chinese_description(self):
        self.assertEqual(chinese_label('KXYZ', 'News'), 'KXYZ 新闻频道')
        self.assertEqual(chinese_label('NewBrand', 'Movies'), 'NewBrand 电影频道')

    def test_abc_australia_not_mislabeled_as_american(self):
        label = chinese_label('ABC Kids', 'Kids', 'ABCKids.au@SD')
        self.assertIn('澳大利亚广播公司', label)
        self.assertNotIn('美国', label)


if __name__ == '__main__':
    unittest.main()
