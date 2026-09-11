import argparse
import os
import sys

from . import __version__


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="claude-calc",
        description="Price your Claude Code session logs and view the spend in a local dashboard.",
    )
    p.add_argument("--version", action="version", version=f"claude-calc {__version__}")
    p.add_argument("--projects-dir", metavar="DIR",
                   help="folder holding the session logs (default: ~/.claude/projects)")
    sub = p.add_subparsers(dest="cmd")

    s = sub.add_parser("serve", help="start the dashboard (default)")
    s.add_argument("-p", "--port", type=int, default=8765)
    s.add_argument("--no-browser", action="store_true", help="don't open a browser tab")

    sub.add_parser("report", help="print a plain-text summary")

    args = p.parse_args(argv)
    projects_dir = os.path.expanduser(args.projects_dir) if args.projects_dir else None
    if projects_dir and not os.path.isdir(projects_dir):
        p.error(f"no such directory: {projects_dir}")

    if args.cmd == "report":
        from .report import report
        report(projects_dir)
        return 0

    from .server import serve
    port = getattr(args, "port", 8765)
    open_browser = not getattr(args, "no_browser", False)
    try:
        serve(port=port, open_browser=open_browser, projects_dir=projects_dir)
    except OSError as e:
        print(f"Could not start on port {port}: {e.strerror}. Try --port <other>.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
