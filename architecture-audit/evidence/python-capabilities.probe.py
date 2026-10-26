# Standard-library-only audit probes. No provider scripts or network requests.
import importlib.util
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
class PythonCapabilityProbe(unittest.TestCase):
    def test_inherited_compatibility_stub_is_not_a_real_search_capability(self):
        class Source(base.Spider):
            pass
        result = runner._invoke(Source(), 'searchContent', 'query', False)
        print('AUDIT_PYTHON_BASE_STUB', json.dumps(result))
        with self.assertRaises(runner._UnsupportedSpiderOperation):
            runner._invoke(Source(), 'searchContent', 'query', False)
    def test_type_error_inside_init_is_reported(self):
        class Source:
            def init(self, ext):
                raise TypeError('audit init body failed')
        runner._INSTANCES.clear()
        with self.assertRaisesRegex(TypeError, 'audit init body failed'):
            runner._acquire({'Source': Source}, 'Source', '')
if __name__ == '__main__':
    unittest.main(verbosity=2)
