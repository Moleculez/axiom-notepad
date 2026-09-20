import unittest
import server


class GatewayTests(unittest.TestCase):
    def test_fixed_modes_and_languages(self):
        result = server.options({"x-ocr-mode": "pdf", "x-ocr-pages": "1,2", "x-ocr-language": "eng+chi_sim"})
        self.assertEqual(result["pages"], [1, 2])

    def test_rejects_arguments_and_unbounded_ranges(self):
        for pages in ("", "0", "2001", "1;id", "1,1", "1-999999"):
            with self.assertRaises(ValueError):
                server.options({"x-ocr-mode": "pdf", "x-ocr-pages": pages})
        for key, value in (("x-ocr-mode", "shell"), ("x-ocr-language", "eng --force-ocr")):
            with self.assertRaises(ValueError):
                server.options({"x-ocr-mode": "text", "x-ocr-pages": "1", key: value})

    def test_text_units_are_single_page(self):
        with self.assertRaises(ValueError):
            server.options({"x-ocr-mode": "text", "x-ocr-pages": "1,2"})


if __name__ == "__main__":
    unittest.main()
