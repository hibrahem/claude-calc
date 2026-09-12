"""Plain-text spend report, the same summary the original script printed."""
import calendar
import collections
import datetime

from .costlib import load


def forecast_line(by_month, today=None):
    """Run-rate forecast for the current month: spend so far / days elapsed * days in month."""
    today = today or datetime.date.today()
    key = today.strftime("%Y-%m")
    mtd = by_month.get(key, 0.0)
    days = calendar.monthrange(today.year, today.month)[1]
    if not mtd:
        return f"Forecast for {today:%B}: no spend yet"
    rate = mtd / today.day
    return (f"Forecast for {today:%B}: ${rate * days:,.2f}  "
            f"(${mtd:,.2f} so far, ${rate:,.2f}/day over {today.day} of {days} days)")


def efficiency_lines(rows, sessions):
    cr = sum(r["cr"] for r in rows)
    writes = sum(r["w5"] + r["w1"] for r in rows)
    w1 = sum(r["w1"] for r in rows)
    inp = sum(r["in"] for r in rows)
    cost = sum(r["cost"] for r in rows)
    ctx = [r["in"] + r["cr"] + r["w5"] + r["w1"] for r in rows]
    prompts = sum(s.get("prompts", 0) for s in sessions.values())
    denom = cr + writes + inp
    out = []
    out.append(f"cache hit rate        {cr / denom * 100:5.1f}%  (context tokens served from cache)" if denom else "cache hit rate        n/a")
    out.append(f"cost per prompt       ${cost / prompts:8,.2f}  ({prompts} prompts)" if prompts else "cost per prompt       n/a")
    if ctx:
        big = sum(1 for c in ctx if c > 150_000)
        out.append(f"avg context/message   {sum(ctx) / len(ctx):10,.0f} tokens, peak {max(ctx):,}")
        out.append(f"messages over 150k    {big:6d}  ({big / len(ctx) * 100:.0f}%)")
    if writes:
        out.append(f"cache writes at 1h    {w1 / writes * 100:5.1f}%  of write tokens")
    return out


def report(projects_dir=None):
    data = load(projects_dir) if projects_dir else load()
    rows = data["rows"]
    sessions = data["sessions"]

    by_model = collections.defaultdict(lambda: collections.Counter())
    by_proj = collections.defaultdict(float)
    by_month = collections.defaultdict(float)
    by_session = collections.defaultdict(float)
    for r in rows:
        c = by_model[r["model"]]
        c["msgs"] += 1
        for k in ("in", "out", "cr", "w5", "w1", "c_in", "c_out", "c_cr", "c_w", "cost"):
            c[k] += r[k]
        by_proj[sessions[r["session"]]["project"]] += r["cost"]
        by_month[r["ts"][:7]] += r["cost"]
        by_session[r["session"]] += r["cost"]

    total = sum(c["cost"] for c in by_model.values())
    print(f"Deduped API messages priced: {len(rows)}")
    print(f"\nTOTAL: ${total:,.2f}\n")
    if not rows:
        print("No priced messages found.")
        return
    print(f"{'model':28}{'msgs':>7}{'input':>12}{'output':>11}{'cache_rd':>13}{'cw_5m':>11}{'cw_1h':>12}{'cost':>11}")
    for mdl, c in sorted(by_model.items(), key=lambda x: -x[1]['cost']):
        print(f"{mdl:28}{c['msgs']:7d}{c['in']:12,d}{c['out']:11,d}{c['cr']:13,d}{c['w5']:11,d}{c['w1']:12,d}{c['cost']:11,.2f}")
    print("\nCost split by token type:")
    for k, lab in [("c_in", "uncached input"), ("c_out", "output"), ("c_cr", "cache reads"), ("c_w", "cache writes")]:
        v = sum(c[k] for c in by_model.values())
        print(f"  {lab:16}${v:9,.2f}  ({v/total*100:4.1f}%)")
    print("\nBy month:")
    for k in sorted(by_month):
        print(f"  {k}  ${by_month[k]:9,.2f}")
    print("\n" + forecast_line(by_month))
    print("\nEfficiency:")
    for line in efficiency_lines(rows, sessions):
        print("  " + line)
    print("\nBy project:")
    for k, v in sorted(by_proj.items(), key=lambda x: -x[1]):
        print(f"  ${v:9,.2f}  {k}")
    print("\nTop 10 sessions:")
    for k, v in sorted(by_session.items(), key=lambda x: -x[1])[:10]:
        s = sessions[k]
        print(f"  ${v:8,.2f}  {s['started'][:10]}  {k[:8]}  {s['project']}")
    if data["unknown"]:
        print("\nSkipped (unpriced) models, total tokens:", data["unknown"])
