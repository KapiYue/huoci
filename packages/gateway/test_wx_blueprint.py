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

    def test_login_without_link_uses_wechat_identity_session(self):
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
        issue.assert_called_once()

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

    def test_confirm_link_reports_a_safe_account_verification_failure(self):
        with (
            patch.object(wx, "_user_from_token", return_value=self.user),
            patch.object(wx, "_code2session", return_value=self.session),
            patch.object(wx, "_find_identity", return_value={"user_id": "account-1"}),
            patch.object(wx, "_sign_in", return_value=(400, {"message": "upstream detail"})),
        ):
            response = self.client.post(
                "/wx/account-link/confirm", headers={"Authorization": "Bearer test-session"},
                json={"code": "fresh-wx-code", "email": "member@example.test", "password": "not-logged",
                      "confirmed": True, "confirmation_version": wx.ACCOUNT_LINK_CONFIRMATION_VERSION},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["message"], "词鲸账号验证失败")

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


if __name__ == "__main__":
    unittest.main()
