# claude-calc

Prices every Claude Code API message found in `~/.claude/projects/**/*.jsonl`
using pay-per-token rates, and shows the result as a CLI summary or a local web portal.

## Web portal

```bash
python3 serve.py
```

Open http://localhost:8765. No dependencies beyond Python 3 (Chart.js and the
font load from a CDN). Session logs are rescanned on every page load and on
the Rescan button.

- Total spend with a date range (presets or custom from/to) that scopes every section
- Spend over time, daily or monthly
- Cost per model, split into output / cache reads / cache writes / uncached input
- Projects sorted by cost; click one to see its sessions with their first prompt

Pass a port as the first argument to change it: `python3 serve.py 9000`.

## CLI

```bash
python3 cost.py
```

## Pricing

Rates are `$/MTok` in `PRICES` inside `costlib.py`:
`(input, output, cache_read, cache_write_5m, cache_write_1h)`.
Models without a rate are skipped and listed at the end of the output.
