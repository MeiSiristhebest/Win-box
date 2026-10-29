import importlib.util
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "o02_shader_poc.py"
SPEC = importlib.util.spec_from_file_location("o02_shader_poc", MODULE_PATH)
o02 = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(o02)


class ImageDifferenceTests(unittest.TestCase):
    def test_identical_images_have_exact_match_and_no_finite_psnr(self):
        image = Image.new("RGB", (8, 8), (10, 20, 30))
        metrics = o02.image_difference(image, image.copy())
        self.assertTrue(metrics["exactMatch"])
        self.assertEqual(metrics["maeRgb"], 0)
        self.assertIsNone(metrics["psnrDb"])

    def test_one_pixel_change_has_positive_error(self):
        reference = Image.new("RGB", (8, 8), (10, 20, 30))
        candidate = reference.copy()
        candidate.putpixel((0, 0), (20, 20, 30))
        metrics = o02.image_difference(reference, candidate)
        self.assertFalse(metrics["exactMatch"])
        self.assertGreater(metrics["maeRgb"], 0)
        self.assertGreater(metrics["psnrDb"], 0)

    def test_dimensions_must_match(self):
        with self.assertRaisesRegex(ValueError, "dimensions differ"):
            o02.image_difference(Image.new("RGB", (8, 8)), Image.new("RGB", (9, 8)))


if __name__ == "__main__":
    unittest.main()
