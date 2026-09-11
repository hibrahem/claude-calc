"""Scan Claude Code session logs and price every API message.

Shared by the CLI (cost.py) and the web portal (serve.py).
"""
import collections
import glob
import json
import os

# $/MTok: (input, output, cache_read, cache_write_5m, cache_write_1h)
PRICES = {
    "claude-fable-5-1": (10, 50, 0.25, 12.5, 20),
    "claude-fable-5":   (10, 50, 1.00, 12.5, 20),
    "claude-opus-5":    (5, 25, 0.50, 6.25, 10),
    "claude-opus-4-8":  (5, 25, 0.50, 6.25, 10),
    "claude-sonnet-5":  (2, 10, 0.20, 2.5, 4),
    "claude-haiku-4-5": (1, 5, 0.10, 1.25, 2),
}

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")


def price(model):
    if model.startswith("claude-haiku-4-5"):
        return PRICES["claude-haiku-4-5"]
    return PRICES.get(model)


def _first_text(content):
    """Return the first plain-text piece of a user message, or ''."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                return part.get("text", "")
    return ""


def _display_project(cwd, dirname):
    home = os.path.expanduser("~")
    if cwd:
        if cwd.startswith(home + "/"):
            return cwd[len(home) + 1:]
        return cwd
    # Fallback: undo the "-Users-name-..." encoding of the directory name.
    encoded_home = home.replace("/", "-")
    if dirname.startswith(encoded_home + "-"):
        return dirname[len(encoded_home) + 1:].replace("-", "/")
    return dirname


def load(projects_dir=PROJECTS_DIR):
    """Return {"rows": [...], "sessions": {...}, "unknown": {...}, "pricing": {...}}.

    rows: one record per deduplicated assistant API message.
    sessions: sessionId -> {"project", "started", "title"}.
    unknown: model -> total tokens for models with no price.
    """
    seen = {}
    sessions = {}
    pattern = os.path.join(projects_dir, "**", "*.jsonl")
    for path in glob.glob(pattern, recursive=True):
        dirname = os.path.basename(os.path.dirname(path))
        with open(path, errors="replace") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                kind = d.get("type")
                sid = d.get("sessionId")
                if kind == "user" and sid and not d.get("isSidechain"):
                    meta = sessions.setdefault(sid, {
                        "project": _display_project(d.get("cwd"), dirname),
                        "started": d.get("timestamp", ""),
                        "title": "",
                    })
                    if not meta["title"]:
                        text = _first_text((d.get("message") or {}).get("content"))
                        text = " ".join(text.split())
                        if text and not text.startswith("<"):
                            meta["title"] = text[:140]
                    continue
                if kind != "assistant":
                    continue
                m = d.get("message") or {}
                u = m.get("usage")
                mid = m.get("id")
                if not u or not mid:
                    continue
                seen[mid] = (d, u, m.get("model", ""), dirname)

    rows = []
    unknown = collections.Counter()
    for mid, (d, u, model, dirname) in seen.items():
        pr = price(model)
        inp = u.get("input_tokens", 0) or 0
        out = u.get("output_tokens", 0) or 0
        cr = u.get("cache_read_input_tokens", 0) or 0
        cc = u.get("cache_creation") or {}
        w5 = cc.get("ephemeral_5m_input_tokens")
        w1 = cc.get("ephemeral_1h_input_tokens")
        if w5 is None and w1 is None:
            w5 = u.get("cache_creation_input_tokens", 0)
            w1 = 0
        w5 = w5 or 0
        w1 = w1 or 0
        if pr is None:
            unknown[model] += inp + out + cr + w5 + w1
            continue
        sid = d.get("sessionId")
        ts = d.get("timestamp", "")
        meta = sessions.setdefault(sid, {
            "project": _display_project(d.get("cwd"), dirname),
            "started": ts,
            "title": "",
        })
        if ts and (not meta["started"] or ts < meta["started"]):
            meta["started"] = ts
        rows.append({
            "ts": ts,
            "model": model,
            "session": sid,
            "in": inp, "out": out, "cr": cr, "w5": w5, "w1": w1,
            "c_in": inp * pr[0] / 1e6,
            "c_out": out * pr[1] / 1e6,
            "c_cr": cr * pr[2] / 1e6,
            "c_w": (w5 * pr[3] + w1 * pr[4]) / 1e6,
        })
    for r in rows:
        r["cost"] = r["c_in"] + r["c_out"] + r["c_cr"] + r["c_w"]
        for k in ("c_in", "c_out", "c_cr", "c_w", "cost"):
            r[k] = round(r[k], 6)
    rows.sort(key=lambda r: r["ts"])
    # Only keep sessions that have priced rows.
    used = {r["session"] for r in rows}
    sessions = {k: v for k, v in sessions.items() if k in used}
    return {
        "rows": rows,
        "sessions": sessions,
        "unknown": {k: v for k, v in unknown.items() if v},
        "pricing": {k: list(v) for k, v in PRICES.items()},
    }
