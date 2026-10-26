# Standard-library-only audit probes. No provider scripts or network requests.
import importlib.util
import io
import json
import sys
import types
import unittest
sys.dont_write_bytecode = True
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
runner = load('audit_runner', 'resources/jvm/python-runner/runner.py')
sys.modules['requests'] = types.SimpleNamespace()
sys.modules['urllib3'] = types.SimpleNamespace(disable_warnings=lambda: None)
base = load('audit_base', 'resources/jvm/python-runner/base/spider.py')
sys.modules['base.spider'] = base
class PythonCapabilityProbe(unittest.TestCase):
    def test_inherited_compatibility_stub_is_not_a_real_search_capability(self):
        class Source(base.Spider):
            pass
        with self.assertRaises(runner._UnsupportedSpiderOperation):
            runner._invoke(Source(), 'searchContent', 'query', False)
    def test_overridden_empty_search_remains_a_legal_result(self):
        class Source(base.Spider):
            def searchContent(self, key, quick, pg='1'):
                return {'list': [], 'page': 1}
        result = runner._invoke(Source(), 'searchContent', 'query', False)
        self.assertEqual(result, {'list': [], 'page': 1})
    def test_one_shot_dispatch_reports_an_inherited_stub_as_unsupported(self):
        class Source(base.Spider):
            pass
        with self.assertRaises(runner._UnsupportedSpiderOperation):
            runner._call_method(Source(), 'searchContent', ['query', 'false', '1'])
    def test_resident_dispatch_keeps_unsupported_and_legal_empty_distinct(self):
        class Unsupported(base.Spider):
            pass
        class EmptyResult(base.Spider):
            def searchContent(self, key, quick, pg='1'):
                return {'list': [], 'page': 1}
        original_load = runner._load_script
        original_stdin = sys.stdin
        original_out = runner._REAL_OUT
        try:
            runner._load_script = lambda _path: {'Unsupported': Unsupported, 'EmptyResult': EmptyResult}
            sys.stdin = io.StringIO('\n'.join([
                json.dumps({'id': 'unsupported', 'method': 'searchContent', 'args': ['', 'query', 'false', '1']}),
                json.dumps({'id': 'empty', 'method': 'searchContent', 'args': ['', 'query', 'false', '1']}),
                json.dumps({'quit': True}),
            ]) + '\n')
            runner._REAL_OUT = io.StringIO()
            runner._serve('ignored.py', 'Unsupported')
            unsupported = json.loads(runner._REAL_OUT.getvalue().splitlines()[0])
            self.assertFalse(unsupported['ok'])
            self.assertIn('WINBOX_OPERATION_UNSUPPORTED:searchContent', unsupported['data'])

            sys.stdin = io.StringIO('\n'.join([
                json.dumps({'id': 'empty', 'method': 'searchContent', 'args': ['', 'query', 'false', '1']}),
                json.dumps({'quit': True}),
            ]) + '\n')
            runner._REAL_OUT = io.StringIO()
            runner._serve('ignored.py', 'EmptyResult')
            empty = json.loads(runner._REAL_OUT.getvalue().splitlines()[0])
            self.assertTrue(empty['ok'])
            self.assertEqual(json.loads(empty['data']), {'list': [], 'page': 1})
        finally:
            runner._load_script = original_load
            sys.stdin = original_stdin
            runner._REAL_OUT = original_out
    def test_type_error_inside_init_is_reported(self):
        class Source:
            def init(self, ext):
                raise TypeError('audit init body failed')
        runner._INSTANCES.clear()
        with self.assertRaisesRegex(TypeError, 'audit init body failed'):
            runner._acquire({'Source': Source}, 'Source', '')
    def test_no_argument_init_is_called_without_masking_body_errors(self):
        class Source:
            def __init__(self):
                self.initialized = False
            def init(self):
                self.initialized = True
        source = Source()
        runner._initialize(source, 'ignored extension')
        self.assertTrue(source.initialized)
if __name__ == '__main__':
    unittest.main(verbosity=2)
