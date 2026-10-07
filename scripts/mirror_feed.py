"""Publish the existing Avito feed with byte-identical photos on GitHub Pages."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from xml.dom import minidom

MAX_PHOTO_BYTES = 25 * 1024 * 1024
MAX_FEED_BYTES = 8 * 1024 * 1024
MAX_SITE_BYTES = 750 * 1024 * 1024


class MirrorError(Exception):
    pass


def public_https(url):
    target = urlsplit(url)
    if (target.scheme != "https" or not target.hostname or target.username
            or target.password or target.port not in (None, 443)):
        raise MirrorError("Нужна публичная HTTPS-ссылка без пароля.")
    try:
        addresses = socket.getaddrinfo(target.hostname, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise MirrorError("Не удалось определить адрес сервера файлов.") from None
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise MirrorError("Внутренние адреса серверов не разрешены.")
    return url


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        public_https(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def download_bytes(url, limit):
    public_https(url)
    opener = build_opener(PublicRedirects())
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "Avito-Feed-Photo-Mirror/1.0"})
            with opener.open(request, timeout=30) as response:
                if int(response.headers.get("Content-Length", "0")) > limit:
                    raise MirrorError("Файл превышает допустимый размер.")
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise MirrorError("Файл превышает допустимый размер.")
                return data, response.headers.get_content_type()
        except HTTPError as error:
            code = error.code
            if attempt < 2 and (code == 429 or code >= 500):
                time.sleep(2 ** attempt)
                continue
            raise MirrorError(f"Сервер исходного файла ответил HTTP {code}. Предыдущий фид сохранён.") from None
        except (URLError, TimeoutError, OSError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise MirrorError("Исходный файл не скачался. Предыдущий фид сохранён.") from None


def image_extension(data, content_type):
    if len(data) > MAX_PHOTO_BYTES:
        raise MirrorError("Фотография больше 25 МБ.")
    if content_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        offset, header, pixels, end = 8, False, False, False
        while offset + 12 <= len(data):
            length = struct.unpack(">I", data[offset:offset + 4])[0]
            kind = data[offset + 4:offset + 8]
            next_offset = offset + 12 + length
            if next_offset > len(data):
                break
            if kind == b"IHDR" and length == 13 and offset == 8:
                width, height = struct.unpack(">II", data[offset + 8:offset + 16])
                header = width > 0 and height > 0
            pixels = pixels or kind == b"IDAT"
            if kind == b"IEND" and length == 0:
                end = True
                break
            offset = next_offset
        if header and pixels and end:
            return "png"
    if content_type == "image/jpeg" and data.startswith(b"\xff\xd8"):
        offset, dimensions, scan = 2, False, False
        while offset + 4 <= len(data) and data[offset] == 255:
            while offset < len(data) and data[offset] == 255:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            if offset + 2 > len(data):
                break
            length = struct.unpack(">H", data[offset:offset + 2])[0]
            if length < 2 or offset + length > len(data):
                break
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF) and length >= 8:
                height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
                dimensions = width > 0 and height > 0
            if marker == 0xDA:
                scan = True
                break
            offset += length
        if dimensions and scan and b"\xff\xd9" in data[-1024:]:
            return "jpg"
    raise MirrorError("Вместо целого JPG/PNG получен неподходящий файл. Публикация остановлена.")


def child_elements(parent, name):
    return [node for node in parent.childNodes if node.nodeType == node.ELEMENT_NODE and node.tagName == name]


def mirror_feed(xml, directory, base_url, downloader=download_bytes):
    directory = Path(directory)
    base_url = base_url.rstrip("/")
    parsed_base = urlsplit(base_url)
    if (parsed_base.scheme != "https" or not parsed_base.hostname or parsed_base.query
            or parsed_base.fragment or parsed_base.username or parsed_base.password):
        raise MirrorError("Не настроен адрес GitHub Pages.")
    if len(xml) > MAX_FEED_BYTES or b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
        raise MirrorError("Исходный XML слишком большой или содержит запрещённое объявление типа документа.")
    try:
        document = minidom.parseString(xml)
    except Exception:
        raise MirrorError("Исходный файл не является корректным XML.") from None
    root = document.documentElement
    if root.tagName != "Ads" or root.getAttribute("formatVersion") != "3" or root.getAttribute("target") != "Avito.ru":
        raise MirrorError("Исходный файл не соответствует Avito XML v3.")
    ids = set()
    images = []
    ads = child_elements(root, "Ad")
    for ad in ads:
        id_nodes = child_elements(ad, "Id")
        listing_id = "".join(node.data for node in id_nodes[0].childNodes if node.nodeType == node.TEXT_NODE).strip() if len(id_nodes) == 1 else ""
        if not listing_id or listing_id in ids:
            raise MirrorError("В XML отсутствует уникальный ID объявления.")
        ids.add(listing_id)
        photos = [image for group in child_elements(ad, "Images") for image in child_elements(group, "Image")]
        if not photos or len(photos) > 10 or any(not photo.getAttribute("url") for photo in photos):
            raise MirrorError("В объявлении нужны прямые ссылки на 1–10 фотографий.")
        images.extend(photos)
    media = directory / "media"
    media.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / "media-manifest.json"
    try:
        previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    except (OSError, ValueError):
        previous = {}
    mappings = {}
    for image in images:
        url = image.getAttribute("url")
        if url not in mappings:
            cached_name = previous.get(url, "")
            cached = media / cached_name
            valid_cache = False
            if isinstance(cached_name, str) and len(cached_name) in (68, 69) and cached_name.endswith((".jpg", ".png")) and cached.is_file() and cached.resolve().parent == media.resolve():
                data = cached.read_bytes()
                valid_cache = hashlib.sha256(data).hexdigest() == cached_name.split(".")[0]
                if valid_cache:
                    image_extension(data, "image/jpeg" if cached_name.endswith(".jpg") else "image/png")
            if valid_cache:
                filename = cached_name
            else:
                data, content_type = downloader(url, MAX_PHOTO_BYTES)
                extension = image_extension(data, content_type)
                filename = f"{hashlib.sha256(data).hexdigest()}.{extension}"
                (media / filename).write_bytes(data)
            mappings[url] = filename
        image.setAttribute("url", f"{base_url}/media/{mappings[url]}")
    if sum(file.stat().st_size for file in media.iterdir() if file.is_file()) > MAX_SITE_BYTES:
        raise MirrorError("Архив фото превысил 750 МБ. Нужен перенос в более вместительное хранилище.")
    output = document.toxml(encoding="UTF-8") + b"\n"
    # Only replace the feed after every photo has downloaded and passed validation.
    next_feed = directory / "avito.xml.next"
    next_feed.write_bytes(output)
    os.replace(next_feed, directory / "avito.xml")
    manifest_path.write_text(json.dumps({**previous, **mappings}, ensure_ascii=False, indent=2) + "\n")
    site = directory / "_site"
    site.mkdir(exist_ok=True)
    shutil.copytree(media, site / "media", dirs_exist_ok=True)
    shutil.copyfile(directory / "avito.xml", site / "avito.xml")
    (site / ".nojekyll").write_text("")
    (site / "index.html").write_text(f'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Файлы Avito Flow</title><body><h1>Файлы автозагрузки Авито</h1><p>Объявлений: {len(ads)}. Фотографий в текущем фиде: {len(mappings)}.</p><p><a href="avito.xml">Открыть XML-фид</a></p></body></html>')
    return {"listings": len(ads), "photos": len(mappings)}


def main():
    source = os.environ.get("SOURCE_FEED_URL", "")
    base_url = os.environ.get("PAGES_BASE_URL", "")
    if not source or not base_url:
        raise MirrorError("Не настроены SOURCE_FEED_URL или PAGES_BASE_URL.")
    xml, _ = download_bytes(source, MAX_FEED_BYTES)
    result = mirror_feed(xml, Path.cwd(), base_url)
    print(f"Готово: объявлений {result['listings']}, фотографий {result['photos']}.")


if __name__ == "__main__":
    try:
        main()
    except MirrorError as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Do not leak the secret source URL through urllib tracebacks.
        print("Ошибка обработки фида. Предыдущая публикация сохранена.", file=sys.stderr)
        sys.exit(1)
