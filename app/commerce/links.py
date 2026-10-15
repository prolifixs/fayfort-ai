"""P3 Find It links: spot a link in what the member typed or pasted, give it one canonical form so
the same item shared by 37 people is one row, and read a safe preview (oEmbed or Open Graph).

Fetching is defended against server-side request forgery: HTTPS only, public addresses only
(checked on every redirect), small responses, short timeouts.
"""
from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx

from app.config.settings import settings

URL_PATTERN = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)
TRACKING_PARAMS = {
    "igsh", "igshid", "si", "fbclid", "gclid", "mc_cid", "mc_eid", "_r", "_t", "is_from_webapp", "sender_device",
    "share_app_id", "share_link_id", "social_sharing", "tt_from", "u_code", "timestamp", "ref", "ref_src", "spm",
}
MAX_BYTES = 512 * 1024
USER_AGENT = "FayFortLinkPreview/1.0 (+https://fayfort.com)"


def find_url(text: str) -> str | None:
    match = URL_PATTERN.search(text or "")
    if not match:
        return None
    return match.group(0).rstrip(".,!?;:)]}")


def platform_for(host: str) -> str:
    host = host.lower()
    if host == "tiktok.com" or host.endswith(".tiktok.com"):
        return "tiktok"
    if host in ("instagram.com", "instagr.am") or host.endswith(".instagram.com"):
        return "instagram"
    return "web"


def canonical_url(url: str) -> str | None:
    """https, lower-case host without www/m, no fragment, tracking parameters removed."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return None
    host = parts.hostname.lower()
    for prefix in ("www.", "m.", "mobile."):
        if host.startswith(prefix) and host.count(".") >= 2:
            host = host[len(prefix):]
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    if len(path) > 1:
        path = path.rstrip("/")
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
             if k.lower() not in TRACKING_PARAMS and not k.lower().startswith("utm_")]
    if platform_for(host) in ("tiktok", "instagram"):
        query = []  # their item identity is in the path
    result = urlunsplit(("https", host, path, urlencode(sorted(query)), ""))
    return result if len(result) <= 2000 else None


def _public_host(host: str, resolver: Callable[[str], list[str]]) -> bool:
    try:
        addresses = resolver(host)
    except Exception:
        return False
    if not addresses:
        return False
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
                or ip.is_unspecified or (ip.version == 6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global)
                or not ip.is_global):
            return False
    return True


def _resolve(host: str) -> list[str]:
    return list({info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})


def safe_get(url: str, *, client: httpx.Client | None = None, resolver: Callable[[str], list[str]] = _resolve,
             accept: str = "text/html,application/xhtml+xml") -> tuple[str, str] | None:
    """GET a public HTTPS page; returns (final URL, text) or None. Follows at most 3 redirects, re-checking each."""
    owned = client is None
    http = client or httpx.Client(timeout=httpx.Timeout(6.0, connect=4.0), follow_redirects=False)
    try:
        current = url
        for _ in range(4):
            parts = urlsplit(current)
            if parts.scheme != "https" or not parts.hostname or not _public_host(parts.hostname, resolver):
                return None
            with http.stream("GET", current, headers={"User-Agent": USER_AGENT, "Accept": accept,
                                                       "Accept-Language": "en"}) as response:
                if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                    current = urljoin(current, response.headers["location"])
                    continue
                if response.status_code != 200:
                    return None
                content_type = response.headers.get("content-type", "")
                if not any(kind in content_type for kind in ("html", "json", "xml", "text")):
                    return None
                body = b""
                for chunk in response.iter_bytes():
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
                return current, body[:MAX_BYTES].decode(response.encoding or "utf-8", errors="replace")
        return None
    except (httpx.HTTPError, ValueError, UnicodeError):
        return None
    finally:
        if owned:
            http.close()


_META = re.compile(r"<meta\s+[^>]*>", re.IGNORECASE)
_ATTR = re.compile(r'([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')')
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def parse_open_graph(page: str, base_url: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for tag in _META.findall(page[:MAX_BYTES]):
        attrs = {m.group(1).lower(): (m.group(3) if m.group(3) is not None else m.group(4)) for m in _ATTR.finditer(tag)}
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        value = attrs.get("content")
        if key and value and key not in found:
            found[key] = html.unescape(value).strip()
    title = found.get("og:title") or found.get("twitter:title")
    if not title:
        match = _TITLE.search(page)
        title = html.unescape(match.group(1)).strip() if match else None
    image = found.get("og:image") or found.get("twitter:image")
    image = urljoin(base_url, image) if image else None
    return {key: value for key, value in {
        "title": title,
        "description": found.get("og:description") or found.get("description") or found.get("twitter:description"),
        "image_url": image if image and image.startswith("https://") else None,
        "site_name": found.get("og:site_name"),
        "price": found.get("product:price:amount") or found.get("og:price:amount"),
        "currency": found.get("product:price:currency") or found.get("og:price:currency"),
    }.items() if value}


@dataclass
class Preview:
    canonical_url: str
    platform: str
    status: str = "failed"
    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    author_name: str | None = None
    site_name: str | None = None
    extra: dict = field(default_factory=dict)

    def as_row(self) -> dict:
        def clip(value: str | None, size: int) -> str | None:
            return value[:size] if value else None
        return {"canonical_url": self.canonical_url, "platform": self.platform, "preview_status": self.status,
                "title": clip(self.title, 300), "description": clip(self.description, 1000),
                "image_url": self.image_url if self.image_url and self.image_url.startswith("https://") else None,
                "author_name": clip(self.author_name, 200), "site_name": clip(self.site_name, 200)}


def _oembed(endpoint: str, *, client: httpx.Client | None, resolver) -> dict | None:
    fetched = safe_get(endpoint, client=client, resolver=resolver, accept="application/json")
    if not fetched:
        return None
    try:
        data = json.loads(fetched[1])
        return data if isinstance(data, dict) else None
    except ValueError:
        return None


def fetch_preview(canonical: str, *, client: httpx.Client | None = None,
                  resolver: Callable[[str], list[str]] = _resolve) -> Preview:
    platform = platform_for(urlsplit(canonical).hostname or "")
    preview = Preview(canonical_url=canonical, platform=platform)
    data = None
    if platform == "tiktok":
        data = _oembed("https://www.tiktok.com/oembed?" + urlencode({"url": canonical}), client=client, resolver=resolver)
        preview.site_name = "TikTok"
    elif platform == "instagram" and settings.META_OEMBED_ACCESS_TOKEN.strip():
        data = _oembed("https://graph.facebook.com/v21.0/instagram_oembed?" + urlencode(
            {"url": canonical, "access_token": settings.META_OEMBED_ACCESS_TOKEN.strip(), "omitscript": "true"}),
            client=client, resolver=resolver)
        preview.site_name = "Instagram"
    if data:
        preview.title = str(data.get("title") or "").strip() or None
        preview.author_name = str(data.get("author_name") or "").strip() or None
        thumb = str(data.get("thumbnail_url") or "")
        preview.image_url = thumb if thumb.startswith("https://") else None
        preview.status = "ok" if preview.title or preview.image_url else "partial"
        return preview
    fetched = safe_get(canonical, client=client, resolver=resolver)
    if fetched:
        graph = parse_open_graph(fetched[1], fetched[0])
        preview.title = graph.get("title")
        preview.description = graph.get("description")
        preview.image_url = graph.get("image_url")
        preview.site_name = graph.get("site_name") or preview.site_name
        if graph.get("price"):
            preview.extra = {"price": graph.get("price"), "currency": graph.get("currency")}
        preview.status = "ok" if preview.title and preview.image_url else ("partial" if preview.title else "failed")
    if preview.status == "failed":
        # Never stuck: the card falls back to the link itself and what the member typed.
        preview.site_name = preview.site_name or (urlsplit(canonical).hostname or "")
    return preview
