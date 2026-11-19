"""Offline unit tests for deploy/smoke_test.py (network mocked)."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('smoke', Path(__file__).parents[1] / 'smoke_test.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

class SmokeTests(unittest.TestCase):
    def fake_request(self, base, path, data=None, opener=None):
        if path == '/api/categories' and opener is None:
            raise urllib.error.HTTPError(base + path, 401, 'Unauthorized', {}, None)
        return {
            '/api/health': (200, b'{"status":"ok"}'),
            '/api/ready': (200, b'{"status":"ready","db":"connected"}'),
            '/': (200, b'<html><title>Omkoi Station</title></html>'),
            '/api/categories': (200, b'{"categories":[{"id":1,"code":"SLOW_BAR"}]}'),
            '/api/auth/login': (200, b'{"user":{"id":1,"email":"boom@omkoi.coffee"}}'),
            '/api/auth/me': (200, b'{"user":{"id":1,"email":"boom@omkoi.coffee"}}'),
            '/api/auth/logout': (200, b'{}'),
        }[path]

    @patch.dict('os.environ', {}, clear=True)
    def test_public_checks_pass_and_skip_optional_login(self):
        with patch.object(smoke, 'request', side_effect=self.fake_request) as req:
            smoke.check('https://omkoi.test')
            self.assertEqual(req.call_count, 4)

    @patch.dict('os.environ', {}, clear=True)
    def test_db_not_ready_fails_even_when_http_responds(self):
        def disconnected(base, path, **kwargs):
            if path == '/api/ready':
                return (503, b'{"status":"not_ready","db":"disconnected"}')
            return self.fake_request(base, path, **kwargs)

        with patch.object(smoke, 'request', side_effect=disconnected), patch.object(smoke.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '/api/ready'):
                smoke.check('https://omkoi.test')

    @patch.dict('os.environ', {}, clear=True)
    def test_unauthenticated_categories_200_fails(self):
        def open_categories(base, path, **kwargs):
            if path == '/api/categories':
                return (200, b'{"categories":[]}')
            return self.fake_request(base, path, **kwargs)

        with patch.object(smoke, 'request', side_effect=open_categories), patch.object(smoke.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '/api/categories'):
                smoke.check('https://omkoi.test')

    @patch.dict('os.environ', {'SMOKE_EMAIL': 'smoke@omkoi.coffee', 'SMOKE_PASSWORD': 'test-only'}, clear=True)
    def test_authenticated_cookie_flow_logs_out_even_if_me_fails(self):
        def broken_me(base, path, data=None, opener=None):
            if path == '/api/auth/me':
                raise ValueError('Broken response')
            return self.fake_request(base, path, data=data, opener=opener)

        with patch.object(smoke, 'request', side_effect=broken_me) as req:
            with self.assertRaisesRegex(RuntimeError, 'Login smoke'):
                smoke.check('https://omkoi.test')
            self.assertEqual(req.call_args.args[1], '/api/auth/logout')


if __name__ == '__main__':
    unittest.main()