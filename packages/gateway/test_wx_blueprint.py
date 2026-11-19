import unittest
from unittest.mock import patch

from flask import Flask

from packages.gateway import wx_blueprint as wx


class WxAttachTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(wx.wx_bp)
        self.client = self.app.test_client()
        self.user = {"id": "account-1"}
        self.session = {"openid": "wx-1", "unionid": "union-1"}

    def post_attach(self):
        return self.client.post(
            "/wx/attach",
            headers={"Authorization": "Bearer test-session"},
            json={"code": "fresh-wx-code"},
        )

    def test_attach_same_mapping_is_idempotent_without_rewrite(self):
        existing = {"openid": "wx-1", "unionid": "legacy-union", "user_id": "account-1", "secret_version": 7}
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value=existing),
            patch.object(wx, "_find_identity_for_user", return_value=existing),
            patch.object(wx, "_link_identity") as link,
        ):
            response = self.post_attach()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["idempotent"])
        link.assert_not_called()

    def test_attach_rejects_openid_owned_by_another_account(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"openid": "wx-1", "user_id": "account-2"}),
            patch.object(wx, "_find_identity_for_user") as by_user,
            patch.object(wx, "_link_identity") as link,
        ):
            response = self.post_attach()

        self.assertEqual(response.status_code, 409)
        by_user.assert_not_called()
        link.assert_not_called()

    def test_attach_rejects_account_owned_by_another_openid(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value=None),
            patch.object(wx, "_find_identity_for_user", return_value={"openid": "wx-2", "user_id": "account-1"}),
            patch.object(wx, "_link_identity") as link,
        ):
            response = self.post_attach()

        self.assertEqual(response.status_code, 409)
        link.assert_not_called()

    def test_attach_write_failure_does_not_claim_success(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value=None),
            patch.object(wx, "_find_identity_for_user", return_value=None),
            patch.object(wx, "_link_identity", side_effect=RuntimeError("temporary failure")),
        ):
            response = self.post_attach()

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["message"], "temporary failure")

    def test_login_uses_mapped_account_session_without_exposing_identity(self):
        mapped_session = {
            "access_token": "access", "refresh_token": "refresh", "expires_in": 3600,
            "user": {"id": "account-2", "email": "member@example.test"},
        }
        with (
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"openid": "wx-1", "user_id": "account-2", "secret_version": 1}),
            patch.object(wx, "_find_linked_cijing_user", return_value="account-3") as linked,
            patch.object(wx, "_issue_mapped_session", return_value=mapped_session) as issue,
            patch.object(wx, "_sign_in") as sign_in,
        ):
            response = self.client.post("/wx/login", json={"code": "fresh-wx-code"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"session": mapped_session})
        linked.assert_called_once_with("account-2")
        issue.assert_called_once_with("account-3")
        sign_in.assert_not_called()

    def test_wechat_login_after_unlink_uses_wechat_identity_session(self):
        """解绑移除关联记录后，下一次微信登录必须签发 W 的 session。"""
        mapped_session = {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600,
                          "user": {"id": "account-2"}}
        with (
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"openid": "wx-1", "user_id": "account-2"}),
            patch.object(wx, "_find_linked_cijing_user", return_value=None),
            patch.object(wx, "_issue_wechat_identity_session", return_value=mapped_session) as issue,
        ):
            response = self.client.post("/wx/login", json={"code": "fresh-wx-code"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"session": mapped_session})
        issue.assert_called_once()

    def test_email_login_remains_on_cijing_account_before_and_after_unlink(self):
        """邮箱入口不读取关联状态，关联与解绑均不能改变它的账号归属。"""
        cijing_session = {
            "access_token": "c-access", "refresh_token": "c-refresh", "expires_in": 3600,
            "user": {"id": "cijing-account"},
        }
        with (
            patch.object(wx, "_supabase", return_value="https://example.test"),
            patch.object(wx, "_anon_headers", return_value={"apikey": "public-key"}),
            patch.object(wx, "_post_json", return_value=(200, cijing_session)) as post,
        ):
            before_unlink = wx._sign_in("member@example.test", "member-password")
            after_unlink = wx._sign_in("member@example.test", "member-password")

        self.assertEqual(before_unlink, (200, cijing_session))
        self.assertEqual(after_unlink, (200, cijing_session))
        self.assertEqual(post.call_count, 2)
        for call in post.call_args_list:
            self.assertIn("/auth/v1/token?grant_type=password", call.args[0])
            self.assertEqual(call.args[1], {"email": "member@example.test", "password": "member-password"})

    def test_linked_login_failure_keeps_safe_client_message(self):
        with (
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"openid": "wx-1", "user_id": "account-2"}),
            patch.object(wx, "_find_linked_cijing_user", return_value="account-3"),
            patch.object(wx, "_admin_user", return_value=(200, {"email": "private@example.test"})),
            patch.object(wx, "_supabase", return_value="https://example.test"),
            patch.object(wx, "_service_headers", return_value={"apikey": "server-secret"}),
            patch.object(wx, "_post_json", return_value=(401, {"error_code": "not_admin", "message": "private"})),
            self.assertLogs(wx.logger, level="WARNING") as captured,
        ):
            response = self.client.post("/wx/login", json={"code": "fresh-wx-code"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json(), {"message": wx._LINKED_SESSION_CLIENT_MESSAGE})
        self.assertIn("stage=generate_link http_status=401 error_code=not_admin", captured.output[0])
        self.assertNotIn("private@example.test", "\n".join(captured.output))

    def test_link_status_does_not_return_the_other_account_id(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_find_linked_cijing_user", return_value="account-2"),
        ):
            response = self.client.post("/wx/account-link/status", headers={"Authorization": "Bearer test-session"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"linked": True})

    def test_confirm_link_requires_explicit_confirmation(self):
        with patch.object(wx, "_user_from_token", return_value=self.user):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertNotIn("password", response.get_json()["message"])

    def test_gateway_version_exposes_account_link_protocol(self):
        response = self.client.post("/wx/version", json={})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {"account_link_protocol": wx.ACCOUNT_LINK_PROTOCOL_VERSION},
        )

    def test_confirm_link_verifies_both_identities_and_returns_only_session(self):
        cijing_session = {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600,
                          "user": {"id": "account-2"}}
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_sign_in", return_value=(200, cijing_session)),
            patch.object(wx, "_find_linked_cijing_user", return_value=None),
            patch.object(wx, "_find_linked_wechat_user", return_value=None),
            patch.object(wx, "_execute_account_link", return_value={"state": "committed"}) as execute,
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"session": cijing_session, "linked": True})
        execute.assert_called_once_with("link", "account-1", "account-2", "account-1", wx.ACCOUNT_LINK_CONFIRMATION_VERSION)

    def test_confirm_link_is_idempotent_for_the_same_account_pair(self):
        cijing_session = {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600,
                          "user": {"id": "account-2"}}
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_sign_in", return_value=(200, cijing_session)),
            patch.object(wx, "_find_linked_cijing_user", return_value="account-2"),
            patch.object(wx, "_find_linked_wechat_user", return_value="account-1"),
            patch.object(wx, "_execute_account_link") as execute,
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"session": cijing_session, "linked": True, "idempotent": True})
        execute.assert_not_called()

    def test_confirm_link_names_the_conflicting_side_without_third_account_language(self):
        cijing_session = {"user": {"id": "account-2"}}
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_sign_in", return_value=(200, cijing_session)),
            patch.object(wx, "_find_linked_cijing_user", return_value="another-cijing-account"),
            patch.object(wx, "_find_linked_wechat_user", return_value=None),
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["message"], "当前微信账号已关联其他词鲸账号，请先解除原有关联")

    def test_confirm_link_rejects_wechat_identity_mismatch(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "different-account"}),
            patch.object(wx, "_sign_in") as sign_in,
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 409)
        sign_in.assert_not_called()

    def test_confirm_link_preserves_a_safe_account_verification_reason(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_sign_in", return_value=(400, {"error_code": "email_not_confirmed", "message": "upstream detail"})),
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["message"], "词鲸账号尚未完成邮箱验证，请先完成邮箱验证")
        self.assertNotIn("upstream detail", response.get_json()["message"])

    def test_confirm_link_does_not_expose_upstream_auth_details(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_sign_in", return_value=(500, {"message": "secret internal detail", "password": "never-return"})),
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["message"], "词鲸账号服务暂时不可用，请稍后再试")
        self.assertNotIn("secret", response.get_json()["message"])
        self.assertNotIn("password", response.get_json()["message"])

    def test_unlink_returns_wechat_session_only_after_link_check(self):
        wechat_session = {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600,
                          "user": {"id": "account-1"}}
        with (
            patch.object(wx, "_user_from_token", return_value={"id": "account-2"}),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_find_linked_cijing_user", return_value="account-2"),
            patch.object(wx, "_execute_account_link", return_value={"state": "committed"}) as execute,
            patch.object(wx, "_issue_wechat_identity_session", return_value=wechat_session),
        ):
            response = self.client.post(
                "/wx/account-link/unlink", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "confirmed": True,
                      "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"session": wechat_session, "linked": False})
        execute.assert_called_once_with("unlink", "account-1", "account-2", "account-2", wx.ACCOUNT_LINK_CONFIRMATION_VERSION)

    def test_unlink_recovers_when_previous_request_committed_but_session_delivery_failed(self):
        wechat_session = {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600,
                          "user": {"id": "account-1"}}
        with (
            patch.object(wx, "_user_from_token", return_value={"id": "account-2"}),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"openid": "wx-1", "user_id": "account-1", "secret_version": 1}),
            patch.object(wx, "_find_linked_cijing_user", return_value=None),
            patch.object(wx, "_issue_wechat_identity_session", return_value=wechat_session),
            patch.object(wx, "_execute_account_link") as execute,
        ):
            response = self.client.post(
                "/wx/account-link/unlink", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "confirmed": True,
                      "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"session": wechat_session, "linked": False, "idempotent": True})
        execute.assert_not_called()


class LinkedSessionDiagnosticsTests(unittest.TestCase):
    def issue(self, lookup=(200, {"email": "private@example.test"}), responses=()):
        with (
            patch.object(wx, "_admin_user", return_value=lookup),
            patch.object(wx, "_supabase", return_value="https://example.test"),
            patch.object(wx, "_service_headers", return_value={"apikey": "server-secret"}),
            patch.object(wx, "_anon_headers", return_value={"apikey": "server-secret"}),
            patch.object(wx, "_post_json", side_effect=responses) as post,
            self.assertLogs(wx.logger, level="WARNING") as captured,
        ):
            with self.assertRaises(RuntimeError) as raised:
                wx._issue_mapped_session("private-user-id")
        return str(raised.exception), "\n".join(captured.output), post

    def test_target_lookup_reports_safe_status_and_code(self):
        message, logs, post = self.issue(lookup=(404, {"error_code": "user_not_found", "email": "private@example.test"}))
        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=linked_target_lookup http_status=404 error_code=user_not_found", logs)
        post.assert_not_called()

    def test_flat_generate_link_response_exchanges_a_refreshable_target_session(self):
        generated = {"id": "private-user-id", "hashed_token": "private-hash", "verification_type": "magiclink"}
        session = {
            "access_token": "private-access", "refresh_token": "private-refresh", "token_type": "bearer",
            "expires_in": 3600, "user": {"id": "private-user-id"},
        }
        with (
            patch.object(wx, "_admin_user", return_value=(200, {"email": "private@example.test"})),
            patch.object(wx, "_supabase", return_value="https://example.test"),
            patch.object(wx, "_service_headers", return_value={"apikey": "server-secret"}),
            patch.object(wx, "_anon_headers", return_value={"apikey": "public-key"}),
            patch.object(wx, "_post_json", side_effect=[(200, generated), (200, session)]) as post,
        ):
            self.assertEqual(wx._issue_mapped_session("private-user-id"), session)

        self.assertEqual(post.call_args_list[0].args[1], {"type": "magiclink", "email": "private@example.test"})
        self.assertEqual(post.call_args_list[1].args[1], {"token_hash": "private-hash", "type": "magiclink"})

    def test_nested_generate_link_response_exchanges_a_refreshable_target_session(self):
        generated = {
            "properties": {"hashed_token": "private-hash", "verification_type": "magiclink"},
            "user": {"id": "private-user-id"},
        }
        session = {
            "access_token": "private-access", "refresh_token": "private-refresh", "token_type": "bearer",
            "expires_in": 3600, "user": {"id": "private-user-id"},
        }
        with (
            patch.object(wx, "_admin_user", return_value=(200, {"email": "private@example.test"})),
            patch.object(wx, "_supabase", return_value="https://example.test"),
            patch.object(wx, "_service_headers", return_value={"apikey": "server-secret"}),
            patch.object(wx, "_anon_headers", return_value={"apikey": "public-key"}),
            patch.object(wx, "_post_json", side_effect=[(200, generated), (200, session)]) as post,
        ):
            self.assertEqual(wx._issue_mapped_session("private-user-id"), session)

        self.assertEqual(post.call_args_list[1].args[1], {"token_hash": "private-hash", "type": "magiclink"})

    def test_generate_link_rejection_normalizes_unknown_upstream_text(self):
        secret = "private-upstream-response-token"
        message, logs, post = self.issue(responses=[(422, {"error_code": secret, "message": secret,
                                                         "hashed_token": secret})])
        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=generate_link http_status=422 error_code=invalid_response", logs)
        self.assertEqual(post.call_count, 1)
        for sensitive in (secret, "private@example.test", "private-user-id", "server-secret"):
            self.assertNotIn(sensitive, logs)

    def test_generate_link_known_code_and_missing_fields(self):
        _, logs, _ = self.issue(responses=[(401, {"error_code": "not_admin"})])
        self.assertIn("stage=generate_link http_status=401 error_code=not_admin", logs)
        _, logs, _ = self.issue(responses=[(200, {"properties": {}})])
        self.assertIn("stage=generate_link http_status=200 error_code=invalid_response", logs)

    def test_generate_link_rejects_disabled_capability(self):
        message, logs, post = self.issue(responses=[(422, {"error_code": "otp_disabled"})])

        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=generate_link http_status=422 error_code=otp_disabled", logs)
        self.assertEqual(post.call_count, 1)

    def test_generate_link_rejects_rate_limit(self):
        message, logs, post = self.issue(responses=[(429, {"error_code": "too_many_requests"})])

        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=generate_link http_status=429 error_code=too_many_requests", logs)
        self.assertEqual(post.call_count, 1)

    def test_generate_link_rejects_each_required_field_when_missing(self):
        complete = {"id": "private-user-id", "hashed_token": "private-hash", "verification_type": "magiclink"}
        for missing_field in complete:
            with self.subTest(missing_field=missing_field):
                generated = {key: value for key, value in complete.items() if key != missing_field}
                message, logs, post = self.issue(responses=[(200, generated)])

                self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
                self.assertIn("stage=generate_link http_status=200 error_code=invalid_response", logs)
                self.assertEqual(post.call_count, 1)

    def test_verify_failure_returns_safe_message_without_a_partial_session(self):
        generated = (200, {"id": "private-user-id", "hashed_token": "private-hash", "verification_type": "magiclink"})
        message, logs, post = self.issue(responses=[generated, (401, {"error_code": "invalid_credentials"})])

        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=verify_link http_status=401 error_code=invalid_credentials", logs)
        self.assertEqual(post.call_count, 2)

    def test_generate_link_and_verify_contracts_reject_incomplete_or_wrong_subject_responses(self):
        generated = (200, {"id": "private-user-id", "hashed_token": "private-hash", "verification_type": "magiclink"})
        message, logs, _ = self.issue(responses=[generated, (429, {"error_code": "too_many_requests",
                                                                  "access_token": "private-access"})])
        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=verify_link http_status=429 error_code=too_many_requests", logs)
        self.assertNotIn("private-hash", logs)
        self.assertNotIn("private-access", logs)

        incomplete_session = {"access_token": "private-access", "token_type": "bearer", "expires_in": 3600,
                              "user": {"id": "private-user-id"}}
        message, logs, _ = self.issue(responses=[generated, (200, incomplete_session)])
        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=verify_link http_status=200 error_code=invalid_response", logs)

        wrong_subject = {"access_token": "private-access", "refresh_token": "private-refresh", "token_type": "bearer",
                         "expires_in": 3600, "user": {"id": "another-private-id"}}
        message, logs, _ = self.issue(responses=[generated, (200, wrong_subject)])
        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=verify_link http_status=200 error_code=invalid_response", logs)
        self.assertNotIn("another-private-id", logs)
        self.assertNotIn("private-refresh", logs)

    def test_transport_exception_does_not_expose_exception_text(self):
        message, logs, _ = self.issue(responses=[RuntimeError("private-header-and-code")])
        self.assertEqual(message, wx._LINKED_SESSION_CLIENT_MESSAGE)
        self.assertIn("stage=generate_link http_status=unavailable error_code=transport_error", logs)
        self.assertNotIn("private-header-and-code", logs)


if __name__ == "__main__":
    unittest.main()
