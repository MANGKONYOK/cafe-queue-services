"""Public deployment checks for Omkoi Station. Credentials are never printed.

Usage:
    python3 deploy/smoke_test.py SERVICE_URL

Public checks (retried 5 times to tolerate Cloud Run cold starts):
  1. GET /api/health      -> 200 {"status": "ok"}
  2. GET /api/ready       -> 200 {"status": "ready", "db": "connected"}
  3. GET /                -> 200 HTML page
  4. GET /api/categories  -> 401 Unauthorized when unauthenticated

Optional authenticated cookie check (set BOTH SMOKE_EMAIL and SMOKE_PASSWORD):
  - POST /api/auth/login -> GET /api/auth/me -> GET /api/categories -> POST /api/auth/logout
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request


def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def request(base, path, data=None, opener=None):
    headers = {}
    body = None
    if data is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(data).encode()
    req = urllib.request.Request(base + path, headers=headers, data=body)
    open_fn = opener.open if opener is not None else urllib.request.urlopen
    with open_fn(req, timeout=30) as response:
        return response.status, response.read()


def check_unauth_categories(base):
    try:
        status, _ = request(base, '/api/categories')
        raise ValueError(f'Expected 401 on unauthenticated /api/categories, got {status}')
    except urllib.error.HTTPError as exc:
        if exc.code != 401:
            raise ValueError(f'Expected 401 on unauthenticated /api/categories, got {exc.code}') from exc
        return True


def check(base):
    def health_ok():
        status, body = request(base, '/api/health')
        return status == 200 and json.loads(body).get('status') == 'ok'

    def ready_ok():
        status, body = request(base, '/api/ready')
        parsed = json.loads(body)
        return status == 200 and parsed.get('status') == 'ready' and parsed.get('db') == 'connected'

    def root_ok():
        status, body = request(base, '/')
        return status == 200 and b'<html' in body.lower()

    for path, probe in (
        ('/api/health', health_ok),
        ('/api/ready', ready_ok),
        ('/', root_ok),
        ('/api/categories (unauthenticated 401)', lambda: check_unauth_categories(base)),
    ):
        for attempt in range(5):
            try:
                if not probe():
                    raise ValueError('Unexpected response')
                break
            except (urllib.error.URLError, TimeoutError, ValueError):
                if attempt == 4:
                    raise RuntimeError('Smoke check failed: ' + path) from None
                time.sleep(3)
        print('PASS ' + path)

    email, password = os.getenv('SMOKE_EMAIL'), os.getenv('SMOKE_PASSWORD')
    if bool(email) != bool(password):
        raise RuntimeError('Set both SMOKE_EMAIL and SMOKE_PASSWORD, or neither.')
    if not email:
        print('SKIP login: optional smoke credentials not configured')
        return

    opener = make_opener()
    logged_in = False
    try:
        _, login_body = request(base, '/api/auth/login', {'email': email, 'password': password}, opener=opener)
        login_json = json.loads(login_body)
        if 'user' not in login_json:
            raise ValueError('Missing user object in login response')
        logged_in = True

        _, me_body = request(base, '/api/auth/me', opener=opener)
        if 'user' not in json.loads(me_body):
            raise ValueError('Missing user object in /api/auth/me response')

        _, cat_body = request(base, '/api/categories', opener=opener)
        cats = json.loads(cat_body).get('categories')
        if not isinstance(cats, list) or len(cats) == 0:
            raise ValueError('Expected non-empty categories list')

        print('PASS login, /api/auth/me and authenticated /api/categories')
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        raise RuntimeError('Login smoke check failed') from None
    finally:
        if logged_in:
            request(base, '/api/auth/logout', data={}, opener=opener)
            print('PASS logout')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python3 deploy/smoke_test.py SERVICE_URL')
    check(sys.argv[1].rstrip('/'))