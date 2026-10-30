#!/usr/bin/env python3
"""Run the OuroNex Django WSGI application with Waitress on the loopback address.

Waitress listens on the loopback interface only; IIS with ARR is the public
listener. ``--check`` validates the arguments, the installed packages and the
Django configuration, then exits without binding a socket.

Exit codes: 0 = started or check passed, 2 = configuration or import failure.

Typical service command (the launcher passes these arguments for you):
    python waitress_app.py --host 127.0.0.1 --port 8000 --threads 8 \
        --app-root D:\\OuroNex\\current\\app\\backend
"""

import argparse
import os
import sys

LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")
DEFAULT_APP_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend"
)
TRUSTED_PROXY_HEADERS = ("x-forwarded-for", "x-forwarded-proto")


def fail(message, code=2):
    sys.stdout.flush()
    print("OURONEX-LAUNCH-ERROR: %s" % message, file=sys.stderr)
    sys.exit(code)


def waitress_version():
    """Installed Waitress version, or None when the package cannot be imported."""
    try:
        import waitress  # noqa: F401  the runtime package must exist, not only metadata
    except Exception:
        return None
    try:
        import importlib.metadata as metadata

        return metadata.version("waitress")
    except Exception:
        return None


def supports_trusted_proxy():
    """True when this Waitress version accepts trusted-proxy options.

    Waitress 3.x keeps its options in ``Adjustments._param_map`` and takes
    ``**kw`` in ``__init__``, so the parameter map is the reliable probe.
    Waitress 2.x has neither option, so it reports False and the check prints an
    upgrade warning.
    """
    try:
        from waitress.adjustments import Adjustments
    except Exception:
        return False
    param_map = getattr(Adjustments, "_param_map", None)
    if isinstance(param_map, dict):
        return "trusted_proxy" in param_map and "trusted_proxy_headers" in param_map
    return hasattr(Adjustments, "trusted_proxy") and hasattr(Adjustments, "trusted_proxy_headers")


def load_application(app_root):
    """Import the Django WSGI application so the settings configuration is exercised."""
    if app_root not in sys.path:
        sys.path.insert(0, app_root)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
    try:
        from backend.wsgi import application
    except Exception as exc:
        fail(
            "the Django WSGI application could not be imported (%s: %s). Fix the "
            "configuration before starting the service." % (type(exc).__name__, exc)
        )
    return application


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the OuroNex WSGI app with Waitress on loopback.")
    parser.add_argument("--check", action="store_true", help="validate the environment, then exit without serving")
    parser.add_argument("--host", default="127.0.0.1", help="bind address; loopback only")
    parser.add_argument("--port", type=int, default=8000, help="loopback port for IIS/ARR to proxy to")
    parser.add_argument("--threads", type=int, default=8, help="Waitress worker threads")
    parser.add_argument("--app-root", default=DEFAULT_APP_ROOT, help="release backend directory")
    parser.add_argument(
        "--trusted-proxy",
        default="127.0.0.1",
        help="loopback peer allowed to send X-Forwarded-For / X-Forwarded-Proto",
    )
    args = parser.parse_args(argv)

    if args.host not in LOOPBACK_HOSTS:
        fail(
            "refusing to bind %s: Waitress must stay on the loopback address (127.0.0.1) and IIS "
            "with ARR must be the only public listener. Use -Host 127.0.0.1." % args.host
        )
    if not (1 <= args.port <= 65535):
        fail("port must be between 1 and 65535 (got %s)" % args.port)
    if not (1 <= args.threads <= 256):
        fail("threads must be between 1 and 256 (got %s)" % args.threads)
    if not args.trusted_proxy:
        fail("--trusted-proxy must name the loopback peer, normally 127.0.0.1")

    app_root = os.path.abspath(args.app_root)
    if not os.path.isdir(app_root):
        fail(
            "application directory not found: %s (pass --app-root with the release backend directory, "
            "for example D:\\OuroNex\\current\\app\\backend)" % app_root
        )
    wsgi_path = os.path.join(app_root, "backend", "wsgi.py")
    if not os.path.isfile(wsgi_path):
        fail(
            "Django project not found: %s does not exist. The release is incomplete or --app-root "
            "points at the wrong directory." % wsgi_path
        )

    try:
        import django
    except ImportError as exc:
        fail(
            "Django is not installed for %s (%s). Install the release requirements first: "
            "python -m pip install -r <release>\\app\\backend\\requirements.txt" % (sys.executable, exc)
        )
    version = waitress_version()
    if not version:
        fail(
            "Waitress is not installed for %s. Install the release requirements first: "
            "python -m pip install -r <release>\\app\\backend\\requirements.txt" % sys.executable
        )

    proxy_mode = "waitress-trusted-loopback" if supports_trusted_proxy() else "waitress-default"
    application = load_application(app_root)

    if args.check:
        print("check: waitress %s, django %s" % (version, django.get_version()))
        print("check: app root %s" % app_root)
        print("check: wsgi module %s" % wsgi_path)
        print("check: django configuration loaded (%s)" % os.environ.get("DJANGO_SETTINGS_MODULE"))
        print("check: bind %s:%d threads=%d (loopback only)" % (args.host, args.port, args.threads))
        print("check: proxy header mode %s (trusted peer %s)" % (proxy_mode, args.trusted_proxy))
        if proxy_mode != "waitress-trusted-loopback":
            print(
                "check: WARNING waitress %s does not support trusted proxy headers; "
                "X-Forwarded-Proto from IIS may be dropped. Install waitress>=3." % version
            )
        print("check: OK")
        return 0

    serve_options = {
        "host": args.host,
        "port": args.port,
        "threads": args.threads,
        "ident": "OuroNex",
    }
    if supports_trusted_proxy():
        # IIS/ARR connects from loopback; trust only the headers it sets.
        serve_options.update(
            {
                "trusted_proxy": args.trusted_proxy,
                "trusted_proxy_count": 1,
                "trusted_proxy_headers": set(TRUSTED_PROXY_HEADERS),
            }
        )

    print(
        "OuroNex: serving with waitress %s on http://%s:%d (threads=%d, app root %s, proxy mode %s)"
        % (version, args.host, args.port, args.threads, app_root, proxy_mode),
        flush=True,
    )
    from waitress import serve

    serve(application, **serve_options)
    return 0


if __name__ == "__main__":
    sys.exit(main())