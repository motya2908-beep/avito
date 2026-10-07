import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
from xml.dom import minidom

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).parents[1] / "scripts/mirror_feed.py")
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + b"\0\0\0\0"


PNG = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">II", 1, 1) + b"\x08\x02\0\0\0") + chunk(b"IDAT", b"pixels") + chunk(b"IEND", b"")
FEED = b'<?xml version="1.0"?><Ads formatVersion="3" target="Avito.ru"><Ad><Id>stable-1</Id><Description><![CDATA[Honey & natural <text>]]></Description><Images><Image url="https://example.com/photo.png"/></Images></Ad></Ads>'
BASE = "https://owner.github.io/avito"


class MirrorTests(unittest.TestCase):
    def test_rewrites_only_photo_and_reuses_identical_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            calls = []
            def downloader(url, limit):
                calls.append(url)
                return PNG, "image/png"
            self.assertEqual(mirror.mirror_feed(FEED, root, BASE, downloader), {"listings": 1, "photos": 1})
            document = minidom.parse(str(root / "avito.xml"))
            self.assertEqual(document.getElementsByTagName("Id")[0].firstChild.data, "stable-1")
            self.assertEqual(document.getElementsByTagName("Description")[0].firstChild.data, "Honey & natural <text>")
            self.assertIn(b"<![CDATA[", (root / "avito.xml").read_bytes())
            url = document.getElementsByTagName("Image")[0].getAttribute("url")
            self.assertTrue(url.startswith(BASE + "/media/"))
            self.assertEqual((root / "_site/media" / url.split("/")[-1]).read_bytes(), PNG)
            mirror.mirror_feed(FEED, root, BASE, downloader)
            self.assertEqual(len(calls), 1)

    def test_failed_photo_preserves_previous_feed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "avito.xml").write_bytes(b"previous feed")
            with self.assertRaises(mirror.MirrorError):
                mirror.mirror_feed(FEED, root, BASE, lambda *_: (b"<html>403</html>", "text/html"))
            self.assertEqual((root / "avito.xml").read_bytes(), b"previous feed")
            self.assertFalse((root / "_site").exists())

    def test_empty_feed_for_withdrawal_keeps_old_photo_urls_available(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            mirror.mirror_feed(FEED, root, BASE, lambda *_: (PNG, "image/png"))
            result = mirror.mirror_feed(b'<Ads formatVersion="3" target="Avito.ru"/>', root, BASE)
            self.assertEqual(result["listings"], 0)
            self.assertEqual(len(list((root / "_site/media").glob("*.png"))), 1)

    def test_bad_xml_and_incomplete_photo_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            for xml in (b"<html/>", b'<!DOCTYPE Ads><Ads/>', FEED.replace(b"stable-1", b"")):
                with self.assertRaises(mirror.MirrorError):
                    mirror.mirror_feed(xml, temporary, BASE)
            with self.assertRaises(mirror.MirrorError):
                mirror.image_extension(PNG[:-4], "image/png")


if __name__ == "__main__":
    unittest.main()
