import json
import unittest
from app import app
from database import init_db, get_connection

class FleetPlatformTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        init_db()

    def test_health(self):
        res = self.client.get('/api/health')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get('status'), 'ok')

    def test_auth_login(self):
        res = self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data['user']['username'], 'admin')

        # Invalid login
        bad_res = self.client.post('/api/auth/login', json={'username': 'admin', 'password': 'wrongpassword'})
        self.assertEqual(bad_res.status_code, 401)

    def test_stats(self):
        res = self.client.get('/api/stats')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('fleet_size', data)
        self.assertIn('on_track', data)
        self.assertIn('due_soon', data)
        self.assertIn('overdue', data)
        self.assertIn('total_spend', data)
        self.assertGreater(data['fleet_size'], 0)

    def test_vehicles_crud_and_maintenance(self):
        # 1. Create Vehicle
        new_v = {
            "name": "Test Rapid Van",
            "type": "Cargo Van",
            "plate": "TEST-9999",
            "mileage": 50000
        }
        create_res = self.client.post('/api/vehicles', json=new_v)
        self.assertEqual(create_res.status_code, 201)
        created_id = create_res.get_json()['id']
        self.assertIsNotNone(created_id)

        # 2. Get Vehicle Details & Attached Tasks
        detail_res = self.client.get(f'/api/vehicles/{created_id}')
        self.assertEqual(detail_res.status_code, 200)
        v_data = detail_res.get_json()
        self.assertEqual(v_data['name'], "Test Rapid Van")
        self.assertEqual(len(v_data['tasks']), 5)  # oil, tires, brakes, fluids, dot

        # 3. Update Vehicle
        update_res = self.client.put(f'/api/vehicles/{created_id}', json={
            "name": "Test Rapid Van Updated",
            "type": "Cargo Van",
            "plate": "TEST-9999",
            "mileage": 52000
        })
        self.assertEqual(update_res.status_code, 200)

        # Verify update
        check_res = self.client.get(f'/api/vehicles/{created_id}')
        self.assertEqual(check_res.get_json()['name'], "Test Rapid Van Updated")
        self.assertEqual(check_res.get_json()['mileage'], 52000)

        # 4. Log Maintenance Service
        log_res = self.client.post('/api/maintenance/log', json={
            "vehicle_id": created_id,
            "service_key": "oil",
            "cost": 1500,
            "notes": "Full synthetic oil and filter replaced.",
            "performed_by": "Senior Mechanic"
        })
        self.assertEqual(log_res.status_code, 200)

        # 5. Verify History & Updated Task
        check_after_log = self.client.get(f'/api/vehicles/{created_id}')
        detail_json = check_after_log.get_json()
        oil_task = next(t for t in detail_json['tasks'] if t['service_key'] == 'oil')
        self.assertEqual(oil_task['status'], 'ok')
        self.assertEqual(oil_task['last_cost'], 1500)
        self.assertGreater(len(detail_json['history']), 0)

        # 6. Verify Audit Logs
        logs_res = self.client.get('/api/maintenance/logs')
        self.assertEqual(logs_res.status_code, 200)
        logs_data = logs_res.get_json()
        self.assertTrue(any(l['vehicle_id'] == created_id for l in logs_data))

        # 7. Delete Test Vehicle
        del_res = self.client.delete(f'/api/vehicles/{created_id}')
        self.assertEqual(del_res.status_code, 200)

        # Verify deletion
        not_found_res = self.client.get(f'/api/vehicles/{created_id}')
        self.assertEqual(not_found_res.status_code, 404)

    def test_export_csv(self):
        res = self.client.get('/api/export-csv')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, 'text/csv')
        csv_text = res.data.decode('utf-8')
        self.assertIn("Vehicle,Plate,Service,Due Date,Status,Last Cost,Current Mileage", csv_text)

    def test_index_page(self):
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')
        self.assertIn("GoVehicle", html)
        self.assertIn("Command Center", html)

if __name__ == '__main__':
    unittest.main()
