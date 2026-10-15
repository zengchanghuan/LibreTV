import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sync_iptv_org as sync
from channel_names_zh import chinese_label, localize_metadata, split_metadata


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

    def test_chinese_suffix_keeps_original_metadata_and_url(self):
        raw = playlist().replace(b'English 0', b'BBC News (1080p)')
        self.run_sync(raw)
        text = self.output.read_text()
        self.assertIn('BBC News (1080p) ｜ BBC新闻频道', text)
        self.assertIn('tvg-id="en0" group-title="News"', text)
        self.assertIn('https://example.com/0.m3u8', text)

    def test_quoted_comma_is_metadata_not_channel_title(self):
        info = '#EXTINF:-1 http-user-agent="Mozilla/5.0 (KHTML, like Gecko)" tvg-id="DW.de@English",DW English (1080p)'
        prefix, name = split_metadata(info)
        self.assertEqual(name, 'DW English (1080p)')
        self.assertEqual(localize_metadata(info), prefix + name + ' ｜ 德国之声英语频道')

    def test_suffix_is_idempotent_and_does_not_include_quality_flags(self):
        info = '#EXTINF:-1,BBC News (1080p) [Geo-blocked]'
        localized = localize_metadata(info)
        self.assertEqual(localize_metadata(localized), localized)
        self.assertTrue(localized.endswith('｜ BBC新闻频道'))

    def test_unknown_call_sign_retained_with_chinese_description(self):
        self.assertEqual(chinese_label('KXYZ', 'News'), 'KXYZ 新闻频道')
        self.assertEqual(chinese_label('NewBrand', 'Movies'), 'NewBrand 电影频道')

    def test_abc_australia_not_mislabeled_as_american(self):
        label = chinese_label('ABC Kids', 'Kids', 'ABCKids.au@SD')
        self.assertIn('澳大利亚广播公司', label)
        self.assertNotIn('美国', label)


if __name__ == '__main__':
    unittest.main()
