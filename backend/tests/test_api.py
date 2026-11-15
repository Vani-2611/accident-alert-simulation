import os
import secrets
import tempfile
import unittest

os.environ["ACCIDENT_DB_PATH"] = os.path.join(tempfile.gettempdir(), "accident_alert_test.db")
os.environ["ADMIN_EMAIL"] = "test-admin@example.test"
os.environ["ADMIN_PASSWORD"] = secrets.token_urlsafe(24)
DRIVER_TEST_PASSWORD = secrets.token_urlsafe(24)
try:
    os.remove(os.environ["ACCIDENT_DB_PATH"])
except FileNotFoundError:
    pass

from backend.app import app, initialize_database


class AccidentApiTests(unittest.TestCase):
    def setUp(self):
        try:
            os.remove(os.environ["ACCIDENT_DB_PATH"])
        except FileNotFoundError:
            pass
        initialize_database()
        self.client = app.test_client()
        response = self.client.post("/api/auth/register", json={
            "name": "Test Driver",
            "email": "driver@example.test",
            "password": DRIVER_TEST_PASSWORD,
            "emergencyName": "Emergency Contact",
            "emergencyPhone": "555-0101",
        })
        self.assertEqual(response.status_code, 201)
        self.token = response.get_json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_registration_login_and_duplicate_validation(self):
        duplicate = self.client.post("/api/auth/register", json={
            "name": "Other", "email": "driver@example.test", "password": DRIVER_TEST_PASSWORD,
            "emergencyName": "Contact", "emergencyPhone": "555",
        })
        self.assertEqual(duplicate.status_code, 409)
        login = self.client.post("/api/auth/login", json={
            "email": "driver@example.test", "password": DRIVER_TEST_PASSWORD,
        })
        self.assertEqual(login.status_code, 200)

    def test_simulation_requires_monitoring_and_threshold(self):
        denied = self.client.post("/api/accidents/simulate", json={"impact": 80}, headers=self.headers)
        self.assertEqual(denied.status_code, 409)
        self.client.put("/api/monitoring", json={"active": True}, headers=self.headers)
        below_threshold = self.client.post(
            "/api/accidents/simulate", json={"impact": 69}, headers=self.headers,
        )
        self.assertFalse(below_threshold.get_json()["detected"])
        detected = self.client.post(
            "/api/accidents/simulate", json={"impact": 70}, headers=self.headers,
        )
        self.assertEqual(detected.status_code, 201)
        self.assertTrue(detected.get_json()["accident"]["simulated"])
        history = self.client.get("/api/accidents", headers=self.headers).get_json()["accidents"]
        self.assertEqual(len(history), 1)

    def test_fractional_impact_and_vehicle_year_are_rejected(self):
        self.client.put("/api/monitoring", json={"active": True}, headers=self.headers)
        impact = self.client.post(
            "/api/accidents/simulate", json={"impact": 70.5}, headers=self.headers,
        )
        self.assertEqual(impact.status_code, 400)
        vehicle = self.client.put(
            "/api/vehicle", json={"make": "Test", "year": 2024.5}, headers=self.headers,
        )
        self.assertEqual(vehicle.status_code, 400)
        history = self.client.get("/api/accidents", headers=self.headers).get_json()["accidents"]
        self.assertEqual(history, [])

    def test_json_endpoints_reject_non_object_request_bodies(self):
        requests = [
            (self.client.post, "/api/auth/register", {}),
            (self.client.post, "/api/auth/login", {}),
            (self.client.put, "/api/vehicle", self.headers),
            (self.client.put, "/api/monitoring", self.headers),
            (self.client.post, "/api/accidents/simulate", self.headers),
        ]
        for send, path, headers in requests:
            response = send(path, json=["unexpected"], headers=headers)
            self.assertEqual(response.status_code, 400, path)
            self.assertEqual(response.get_json()["error"], "Request body must be a JSON object.")

    def test_admin_route_requires_admin_role(self):
        response = self.client.get("/api/admin/stats", headers=self.headers)
        self.assertEqual(response.status_code, 403)
        admin_login = self.client.post("/api/auth/login", json={
            "email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"],
        })
        self.assertEqual(admin_login.status_code, 200)
        admin_headers = {
            "Authorization": f"Bearer {admin_login.get_json()['token']}",
        }
        stats = self.client.get("/api/admin/stats", headers=admin_headers)
        self.assertEqual(stats.status_code, 200)
        self.assertEqual(stats.get_json()["stats"]["drivers"], 1)

    def test_configured_admin_password_rotates_existing_admin(self):
        old_password = os.environ["ADMIN_PASSWORD"]
        new_password = secrets.token_urlsafe(24)
        os.environ["ADMIN_PASSWORD"] = new_password
        try:
            initialize_database()
            old_login = self.client.post("/api/auth/login", json={
                "email": os.environ["ADMIN_EMAIL"], "password": old_password,
            })
            new_login = self.client.post("/api/auth/login", json={
                "email": os.environ["ADMIN_EMAIL"], "password": new_password,
            })
            self.assertEqual(old_login.status_code, 401)
            self.assertEqual(new_login.status_code, 200)
        finally:
            os.environ["ADMIN_PASSWORD"] = old_password


if __name__ == "__main__":
    unittest.main()
