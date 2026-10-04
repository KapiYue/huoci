import json
import unittest
from unittest.mock import patch

from flask import Flask

from packages.gateway import functions_blueprint as functions


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps(self.payload).encode()


class FunctionsBlueprintTests(unittest.TestCase):
    def test_public_dictionary_lookup_is_available_without_login(self):
        app = Flask(__name__)
        app.register_blueprint(functions.functions_bp)
        result = {
            "term": "apple",
            "phonetic": "/AE1 P AH0 L/",
            "parts": [{"partOfSpeech": "n", "meaning": "英文释义：fruit"}],
            "primaryMeaning": "英文释义：fruit",
        }
        with patch.object(functions, "_public_dictionary_fallback", return_value=result):
            response = app.test_client().post(
                "/functions/v1/dictionary-lookup",
                json={"word": "apple"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"]["term"], "apple")

    def test_public_dictionary_lookup_returns_404_for_unknown_word(self):
        app = Flask(__name__)
        app.register_blueprint(functions.functions_bp)
        with patch.object(functions, "_public_dictionary_fallback", return_value=None):
            response = app.test_client().post(
                "/functions/v1/dictionary-lookup",
                json={"word": "notaword"},
            )

        self.assertEqual(response.status_code, 404)

    def test_dictionary_fallback_only_sends_the_word(self):
        rows = [{
            "word": "resilient",
            "defs": ["adj\tAble to recover quickly.", "adj\tElastic."],
        }]
        with patch.object(functions.urlrequest, "urlopen", return_value=FakeResponse(rows)) as urlopen:
            result = functions._public_dictionary_fallback({
                "word": "resilient",
                "sentence": "private sentence",
                "context": "private surrounding context",
            })

        requested_url = urlopen.call_args.args[0].full_url
        self.assertIn("sp=resilient", requested_url)
        self.assertNotIn("private", requested_url)
        self.assertEqual(result["primaryMeaning"], "英文释义：Able to recover quickly.")

    def test_lookup_rate_limit_returns_degraded_result(self):
        app = Flask(__name__)
        app.register_blueprint(functions.functions_bp)
        fallback = {
            "term": "resilient", "parts": [{"partOfSpeech": "adj", "meaning": "英文释义：Able to recover."}],
            "primaryMeaning": "英文释义：Able to recover.",
        }
        with (
            patch.object(functions, "_user_from_token", return_value={"id": "user-1"}),
            patch.object(functions, "_forward", return_value=(502, {"error": "OPENROUTER_429: limited"})),
            patch.object(functions, "_public_dictionary_fallback", return_value=fallback),
            patch.object(functions, "_openid_of", return_value=""),
            patch.object(functions, "_passes_check", return_value=None),
        ):
            response = app.test_client().post(
                "/functions/v1/lookup-word",
                headers={"Authorization": "Bearer token"},
                json={"word": "resilient"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["degraded"])
        self.assertEqual(response.get_json()["data"]["term"], "resilient")

    def test_lookup_generic_upstream_502_also_returns_degraded_result(self):
        app = Flask(__name__)
        app.register_blueprint(functions.functions_bp)
        fallback = {
            "term": "resilient",
            "parts": [{"partOfSpeech": "adj", "meaning": "英文释义：Able to recover."}],
            "primaryMeaning": "英文释义：Able to recover.",
        }
        # fallback 的字段内容不由代理改写；这里只验证任意 502 都会触发安全降级。
        with (
            patch.object(functions, "_user_from_token", return_value={"id": "user-1"}),
            patch.object(functions, "_forward", return_value=(502, {"message": "上游服务不可用"})),
            patch.object(functions, "_public_dictionary_fallback", return_value=fallback),
            patch.object(functions, "_openid_of", return_value=""),
            patch.object(functions, "_passes_check", return_value=None),
        ):
            response = app.test_client().post(
                "/functions/v1/lookup-word",
                headers={"Authorization": "Bearer token"},
                json={"word": "resilient"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["degraded"])

    def test_lookup_keeps_original_502_when_fallback_has_no_definition(self):
        app = Flask(__name__)
        app.register_blueprint(functions.functions_bp)
        with (
            patch.object(functions, "_user_from_token", return_value={"id": "user-1"}),
            patch.object(functions, "_forward", return_value=(502, {"message": "上游服务不可用"})),
            patch.object(functions, "_public_dictionary_fallback", return_value=None),
        ):
            response = app.test_client().post(
                "/functions/v1/lookup-word",
                headers={"Authorization": "Bearer token"},
                json={"word": "notaword"},
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["message"], "上游服务不可用")


if __name__ == "__main__":
    unittest.main()
