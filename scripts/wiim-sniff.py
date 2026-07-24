"""
wiim-sniff.py — mitmproxy addon to reverse-engineer the WiiM Home app.

The app drives a WiiM/LinkPlay device over TWO protocols, and this addon
watches both so a single capture session shows everything:

  1. httpapi.asp  — LinkPlay's HTTP command API. Control stuff: source
     switching, EQ, subwoofer, presets, transport. Each call is diffed against
     the commands the dashboard already supports; anything NEW is flagged loud.

  2. UPnP / DLNA  — AVTransport + RenderingControl SOAP. This is where the app
     gets song info & album art (DIDL-Lite metadata: title/artist/album/
     albumArtURI). The addon catalogs every SOAP action, pulls the DIDL out of
     requests AND responses, logs GENA SUBSCRIBEs, and dumps the full action
     list from any SCPD service description it sees.

------------------------------------------------------------------------------
QUICK START
------------------------------------------------------------------------------
1. Capture session (run from the repo root):

       mitmweb  -s scripts/wiim-sniff.py      # browser UI at http://127.0.0.1:8081
   or  mitmdump -s scripts/wiim-sniff.py      # headless, logs straight to terminal

2. On the phone: WiFi -> Manual proxy -> <this-Mac-LAN-IP>:8080
3. Install the mitmproxy CA from http://mitm.it on the phone.
   iOS ALSO needs it enabled under Settings > General > About >
   Certificate Trust Settings, or HTTPS won't be decrypted.
4. TURN OFF mobile data on the phone for the session. The "phone switches to
   cellular after a while" gotcha is the OS connectivity check failing through
   the proxy -> it bails to cellular and the LAN traffic stops. Kill cellular
   data and there's no clock to race.
5. Drive the WiiM app (switch sources, tweak EQ, presets, sub, play tracks).
6. Ctrl-C to stop -> a summary table prints and is written to JSON.

NOTE on realtime events: GENA NOTIFY callbacks travel device->phone, which does
NOT pass through the phone's HTTP proxy, so they won't be captured. The app's
polled `GetInfoEx` / `GetPositionInfo` calls (phone->device) ARE captured, and
that's where the live track metadata comes from anyway.

No proxy / no CA shortcut: a lot of httpapi.asp calls are plain HTTP. Try
Wireshark first with filter `http.request` and just read the GET URLs.

------------------------------------------------------------------------------
OUTPUT
------------------------------------------------------------------------------
- Live log:  🆕 NEW httpapi command (warning), · known httpapi (info),
             ♪ UPnP SOAP action + any resolved track, ⇄ GENA SUBSCRIBE,
             📋 SCPD action list.
- WIIM_SNIFF_LOG     (default scripts/wiim-capture.jsonl): every matching flow,
                     one JSON object per line, for offline mining.
- WIIM_SNIFF_SUMMARY (default scripts/wiim-commands-summary.json): written on
                     exit — httpapi signatures (NEW flagged) + UPnP actions seen.

Config via env vars:
    WIIM_SNIFF_LOG       path to the JSONL flow log
    WIIM_SNIFF_SUMMARY   path to the summary JSON
    WIIM_SNIFF_MAXBODY   max body chars stored per flow (default 4000)

------------------------------------------------------------------------------
KNOWN httpapi PROVENANCE (keep in sync when the dashboard learns new commands)
------------------------------------------------------------------------------
    src/lib/wiim/constants.ts     -> Cmd.*    (status / transport / source / sub / presets)
    src/lib/wiim/eq-constants.ts  -> EqCmd.*  (LV2 graphic + parametric EQ)
    src/lib/wiim/commands.ts:126  -> "getbtstatus" (hardcoded)
"""

import html
import json
import logging
import os
import re
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlsplit

from mitmproxy import http

log = logging.getLogger("wiim-sniff")

# --- Known httpapi command signatures already supported by the dashboard ----
# A "signature" is the command verb, e.g. "getStatusEx". For container verbs
# the second `:`-segment is part of the signature (so a NEW sub-action of an
# otherwise-known verb still stands out) — see CONTAINER_VERBS.
KNOWN = {
    "getStatusEx", "getPlayerStatusEx", "getMetaInfo", "getHwErrorInfo",
    "getbtstatus", "getModeRename", "getAudioInputEnable",
    "getSoundCardModeSupportList", "getNewAudioOutputHardwareMode",
    "getSubLPF", "getPresetInfo",
    "setPlayerCmd:resume", "setPlayerCmd:pause", "setPlayerCmd:onepause",
    "setPlayerCmd:stop", "setPlayerCmd:next", "setPlayerCmd:prev",
    "setPlayerCmd:seek", "setPlayerCmd:vol", "setPlayerCmd:mute",
    "setPlayerCmd:loopmode", "setPlayerCmd:switchmode",
    "setAudioOutputHardwareMode",
    "setSubLPF:level", "setSubLPF:cross", "setSubLPF:phase",
    "setSubLPF:sub_delay", "setSubLPF:status", "setSubLPF:main_filter",
    "setSubLPF:sub_filter",
    "MCUKeyShortClick",
    "EQGetStat", "EQGetList", "EQOn", "EQOff", "EQLoad",
    "EQGetLV2BandEx", "EQGetLV2SourceBandEx", "EQSetLV2SourceBand",
    "EQChangeSourceFX", "EQSourceOff", "EQv2GetList", "EQv2SourceLoad",
    "EQSourceSave", "EQv2Delete", "EQv2Rename",
}
CONTAINER_VERBS = {"setPlayerCmd", "setSubLPF"}

LOG_PATH = os.environ.get("WIIM_SNIFF_LOG", "scripts/wiim-capture.jsonl")
SUMMARY_PATH = os.environ.get("WIIM_SNIFF_SUMMARY", "scripts/wiim-commands-summary.json")
MAX_BODY = int(os.environ.get("WIIM_SNIFF_MAXBODY", "4000"))

# DIDL-Lite metadata fields (matched after html-unescaping the SOAP body).
_DIDL = {
    "title": r"<dc:title>(.*?)</dc:title>",
    "artist": r"<upnp:artist[^>]*>(.*?)</upnp:artist>",
    "creator": r"<dc:creator>(.*?)</dc:creator>",
    "album": r"<upnp:album>(.*?)</upnp:album>",
    "albumArtURI": r"<upnp:albumArtURI[^>]*>(.*?)</upnp:albumArtURI>",
}
_UNKNOWN_VALS = {"", "unknow", "unknown", "not_implemented", "未知"}


# --- pure helpers (unit-tested) ---------------------------------------------
def _signature(command: str) -> str:
    """Reduce a full httpapi command to its dedupe/known-matching signature."""
    segs = command.split(":")
    verb = segs[0]
    if verb in CONTAINER_VERBS and len(segs) > 1:
        return f"{verb}:{segs[1]}"
    return verb


def _extract_command(req: http.Request) -> str | None:
    """Pull the decoded httpapi `command=` value, or None if not an httpapi call."""
    if not req.path.split("?", 1)[0].endswith("/httpapi.asp"):
        return None
    cmd = req.query.get("command")
    if cmd:
        return cmd
    vals = parse_qs(urlsplit(req.path).query, keep_blank_values=True).get("command")
    return unquote(vals[0]) if vals else None


def _soap_action(req: http.Request) -> tuple[str, str] | None:
    """Return (service, action) from a SOAP control request's SOAPACTION header."""
    sa = req.headers.get("SOAPACTION") or req.headers.get("SOAPAction")
    if not sa or "#" not in sa:
        return None
    urn, action = sa.strip().strip('"').rsplit("#", 1)
    m = re.search(r"service:([^:]+)", urn)
    return (m.group(1) if m else urn, action)


def _extract_didl(text: str | None) -> dict | None:
    """Pull title/artist/album/albumArtURI out of a (possibly escaped) blob."""
    if not text or ("albumArtURI" not in text and "dc:title" not in text):
        return None
    blob = html.unescape(text)
    out: dict[str, str] = {}
    for key, pat in _DIDL.items():
        m = re.search(pat, blob, re.S | re.I)
        if m:
            v = html.unescape(m.group(1)).strip()
            if v.lower() not in _UNKNOWN_VALS:
                out[key] = v
    if "artist" not in out and "creator" in out:
        out["artist"] = out["creator"]
    out.pop("creator", None)
    return out or None


def _scpd_actions(text: str | None) -> list[str] | None:
    """Action names declared in an SCPD service-description XML."""
    if not text or "<actionList" not in text:
        return None
    return re.findall(r"<action>\s*<name>\s*([^<\s]+)\s*</name>", text, re.I) or None


def _fmt_meta(meta: dict) -> str:
    bits = []
    if meta.get("title"):
        bits.append(meta["title"])
    if meta.get("artist"):
        bits.append(f"— {meta['artist']}")
    if meta.get("album"):
        bits.append(f"[{meta['album']}]")
    if meta.get("albumArtURI"):
        bits.append(f"art={meta['albumArtURI']}")
    return "  ".join(bits)


class WiimSniff:
    def __init__(self) -> None:
        self.httpapi: dict[str, dict] = {}   # sig -> {known,count,example,first_response}
        self.upnp: dict[str, dict] = {}      # "Service#Action" -> {count,last_meta,...}
        self.scpd: dict[str, list[str]] = {}  # service -> action names
        try:
            self._fh = open(LOG_PATH, "a", encoding="utf-8")
        except OSError as e:
            log.error(f"could not open {LOG_PATH}: {e}")
            self._fh = None
        log.info(
            f"wiim-sniff armed — httpapi.asp + UPnP/DLNA, {len(KNOWN)} known commands, "
            f"flows -> {LOG_PATH}"
        )

    # --- io --------------------------------------------------------------
    def _write(self, record: dict) -> None:
        if not self._fh:
            return
        record["ts"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self._fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._fh.flush()

    @staticmethod
    def _text(msg) -> str:
        try:
            return (msg.get_text(strict=False) or "").strip()
        except Exception:
            return ""

    # --- mitmproxy hook --------------------------------------------------
    def response(self, flow: http.HTTPFlow) -> None:
        req, res = flow.request, flow.response
        device = req.host
        client = flow.client_conn.peername[0] if flow.client_conn.peername else None

        # 1) httpapi.asp command --------------------------------------------------
        command = _extract_command(req)
        if command is not None:
            self._on_httpapi(command, device, client, res)
            return

        # 2) GENA SUBSCRIBE (event subscription handshake) -----------------------
        if req.method in ("SUBSCRIBE", "UNSUBSCRIBE"):
            self._on_subscribe(req, device, client, res)
            return

        # 3) UPnP SOAP control action --------------------------------------------
        sa = _soap_action(req)
        if sa is not None:
            self._on_soap(sa, req, device, client, res)
            return

        # 4) SCPD / device description (lists what the device CAN do) ------------
        #    Only inspect XML bodies — never decode album-art / binary responses.
        if "xml" in res.headers.get("content-type", "").lower():
            body = self._text(res)
            actions = _scpd_actions(body)
            if actions:
                self._on_scpd(req, device, client, res, body, actions)

    # --- handlers --------------------------------------------------------
    def _on_httpapi(self, command, device, client, res) -> None:
        sig = _signature(command)
        is_known = sig in KNOWN
        body = self._text(res)
        self._write({
            "kind": "httpapi", "client": client, "device": device,
            "command": command, "signature": sig, "known": is_known,
            "status": res.status_code,
            "content_type": res.headers.get("content-type", ""),
            "response": body[:MAX_BODY], "truncated": len(body) > MAX_BODY,
        })
        entry = self.httpapi.get(sig)
        if entry is None:
            preview = body[:200].replace("\n", " ")
            self.httpapi[sig] = {"known": is_known, "count": 1, "example": command,
                                 "first_response": preview}
            if is_known:
                log.info(f"· known   {sig}  ->  {command}")
            else:
                log.warning(
                    f"🆕 NEW httpapi command  {sig}\n"
                    f"      full: {command}\n"
                    f"      from: {device}  status {res.status_code}\n"
                    f"      resp: {preview or '(empty)'}"
                )
        else:
            entry["count"] += 1
            if len(command) > len(entry["example"]):
                entry["example"] = command

    def _on_soap(self, sa, req, device, client, res) -> None:
        service, action = sa
        sig = f"{service}#{action}"
        req_body = self._text(req)
        res_body = self._text(res)
        meta = _extract_didl(res_body) or _extract_didl(req_body)
        self._write({
            "kind": "upnp-soap", "client": client, "device": device,
            "service": service, "action": action, "status": res.status_code,
            "meta": meta,
            "request": req_body[:MAX_BODY], "response": res_body[:MAX_BODY],
        })
        entry = self.upnp.get(sig)
        if entry is None:
            self.upnp[sig] = {"count": 1, "last_meta": meta}
            line = f"♪ UPnP  {sig}"
            if meta:
                line += f"   {_fmt_meta(meta)}"
            log.info(line)
        else:
            entry["count"] += 1
            if meta:
                entry["last_meta"] = meta

    def _on_subscribe(self, req, device, client, res) -> None:
        path = req.path.split("?", 1)[0]
        sig = f"{req.method} {path}"
        self._write({
            "kind": "upnp-subscribe", "client": client, "device": device,
            "method": req.method, "path": path, "status": res.status_code,
            "sid": res.headers.get("SID", ""),
            "callback": req.headers.get("CALLBACK", ""),
        })
        entry = self.upnp.get(sig)
        if entry is None:
            self.upnp[sig] = {"count": 1, "last_meta": None}
            log.info(f"⇄ GENA  {sig}  (events the app listens for)")
        else:
            entry["count"] += 1

    def _on_scpd(self, req, device, client, res, body, actions) -> None:
        path = req.path.split("?", 1)[0]
        svc = path.rsplit("/", 1)[-1] or path
        self._write({
            "kind": "upnp-scpd", "client": client, "device": device,
            "path": path, "actions": actions,
        })
        if svc not in self.scpd:
            self.scpd[svc] = actions
            log.info(f"📋 SCPD {svc}: {len(actions)} actions  ->  {', '.join(actions)}")

    # --- shutdown summary ------------------------------------------------
    def done(self) -> None:
        if self._fh:
            self._fh.close()

        new = {s: e for s, e in self.httpapi.items() if not e["known"]}
        known = {s: e for s, e in self.httpapi.items() if e["known"]}

        out = ["", "=" * 70, "WIIM SNIFF SUMMARY", "=" * 70,
               f"httpapi: {len(self.httpapi)} distinct ({len(new)} NEW, {len(known)} known)  |  "
               f"UPnP: {len(self.upnp)} actions  |  SCPD services: {len(self.scpd)}"]
        if new:
            out += ["", "🆕 NEW httpapi — not supported by the dashboard yet:"]
            out += [f"   {s:<28} x{e['count']:<4} e.g. {e['example']}" for s, e in sorted(new.items())]
        if self.upnp:
            out += ["", "♪ UPnP actions / events seen:"]
            for s, e in sorted(self.upnp.items()):
                tail = f"   last: {_fmt_meta(e['last_meta'])}" if e.get("last_meta") else ""
                out.append(f"   {s:<40} x{e['count']}{tail}")
        if self.scpd:
            out += ["", "📋 Device-supported UPnP actions (from SCPD):"]
            for svc, acts in sorted(self.scpd.items()):
                out.append(f"   {svc}: {', '.join(acts)}")
        if known:
            out += ["", "· httpapi already supported:"]
            out += [f"   {s:<28} x{e['count']}" for s, e in sorted(known.items())]
        out.append("=" * 70)
        log.info("\n".join(out))

        try:
            with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
                json.dump({
                    "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "httpapi_new": new, "httpapi_known": known,
                    "upnp_actions": self.upnp, "scpd": self.scpd,
                }, f, ensure_ascii=False, indent=2)
            log.info(f"summary written to {SUMMARY_PATH}")
        except OSError as e:
            log.error(f"could not write {SUMMARY_PATH}: {e}")


addons = [WiimSniff()]
