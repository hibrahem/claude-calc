"""Plain-text spend report, the same summary the original script printed."""
import collections

from .costlib import load


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
    print("\nBy project:")
    for k, v in sorted(by_proj.items(), key=lambda x: -x[1]):
        print(f"  ${v:9,.2f}  {k}")
    print("\nTop 10 sessions:")
    for k, v in sorted(by_session.items(), key=lambda x: -x[1])[:10]:
        s = sessions[k]
        print(f"  ${v:8,.2f}  {s['started'][:10]}  {k[:8]}  {s['project']}")
    if data["unknown"]:
        print("\nSkipped (unpriced) models, total tokens:", data["unknown"])
