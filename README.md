# claude-calc

See what your Claude Code sessions would cost at pay-per-token API rates.

It reads the session logs Claude Code keeps in `~/.claude/projects`, prices
every API message, and shows the result in a local dashboard: spend over time,
cost per model split by token type, and projects you can expand down to
individual sessions.

## Install

```bash
pipx install claude-calc
```

or `pip install claude-calc`. Python 3.9 or newer, no other dependencies.

## Use

```bash
claude-calc
```

Starts the dashboard on http://localhost:8765 and opens it in your browser.
Logs are rescanned on every page load and on the Rescan button.

```bash
claude-calc report
```

Prints a plain-text summary instead.

Options:

| Flag | Meaning |
|---|---|
| `--port 9000` | serve on a different port |
| `--no-browser` | don't open a browser tab |
| `--projects-dir DIR` | read logs from somewhere other than `~/.claude/projects` |

## Pricing

Rates are `$/MTok` in `PRICES` inside `claude_calc/costlib.py`, as
`(input, output, cache_read, cache_write_5m, cache_write_1h)`. Messages are
deduplicated by API message id, and cache writes are billed at the 5-minute
or 1-hour rate depending on which the message used. Models with no rate are
skipped and listed at the bottom of the page.

## Develop

```bash
git clone https://github.com/hibrahem/claude-calc
cd claude-calc
python3 -m claude_calc.cli
```

Releases publish to PyPI from GitHub Actions when a `v*` tag is pushed.
