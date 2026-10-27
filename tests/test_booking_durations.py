"""Integration tests against real PostgreSQL in a disposable Docker container.
Run: python3 -m unittest discover -s tests -v
Requires Docker; no Supabase credentials, exposed ports, or production data.
"""
import concurrent.futures
from pathlib import Path
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
SERVICE = '11111111-1111-4111-8111-111111111111'
LONG = '22222222-2222-4222-8222-222222222222'
HUGE = '33333333-3333-4333-8333-333333333333'
SLOT = '44444444-4444-4444-8444-444444444444'
LEGACY = '55555555-5555-4555-8555-555555555555'
ADMIN = '66666666-6666-4666-8666-666666666666'


class BookingDurations(unittest.TestCase):
    @classmethod
    def sql(cls, sql, check=True):
        return subprocess.run(['docker', 'exec', '-i', '-e', 'PGPASSWORD=local-test-only', cls.container, 'psql',
                               '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
                              input=sql, text=True, capture_output=True, check=check)

    @classmethod
    def setUpClass(cls):
        cls.container = 'mb-booking-test-' + uuid.uuid4().hex[:10]
        subprocess.run(['docker', 'run', '--rm', '--name', cls.container,
                        '-e', 'POSTGRES_PASSWORD=local-test-only', '-d', 'postgres:17'],
                       check=True, capture_output=True)
        cls.addClassCleanup(subprocess.run, ['docker', 'rm', '-f', cls.container],
                            capture_output=True)
        for _ in range(120):
            if cls.sql('select 1', check=False).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError('PostgreSQL did not become ready')
        cls.sql("""
            create role anon; create role authenticated;
            create schema auth;
            create table auth.users(id uuid primary key);
            create function auth.uid() returns uuid language sql stable as
            $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
            grant usage on schema public,auth to anon,authenticated;
            grant execute on function auth.uid() to anon,authenticated;
        """)
        cls.sql((ROOT / 'supabase/schema.sql').read_text())
        cls.sql(f"""
            insert into auth.users values('{ADMIN}');
            insert into admins values('{ADMIN}');
            insert into services(id,name,duration_minutes,price) values
                ('{SERVICE}','Facial',60,25000),('{LONG}','Masaje largo',90,35000),
                ('{HUGE}','Tratamiento extenso',180,45000);
            insert into slots(id,starts_at,ends_at) values
                ('{SLOT}','2099-01-05 10:00Z','2099-01-05 12:00Z'),
                ('{LEGACY}','2099-01-04 10:00Z','2099-01-04 12:00Z');
            insert into slot_services select '{SLOT}', id from services;
            insert into slot_services values('{LEGACY}','{SERVICE}');
            select book_slot('{LEGACY}','{SERVICE}','Reserva anterior','old@example.com','123456789');
        """)
        migration = (ROOT / 'supabase/migrations/20261027_booking_durations.sql').read_text()
        cls.sql(migration)
        cls.sql(migration)  # Must safely support an accidental second execution.

    def setUp(self):
        self.sql(f"delete from bookings where slot_id='{SLOT}'; update slots set blocked=false where id='{SLOT}'; update services set duration_minutes=60,active=true where id='{SERVICE}';")

    def book(self, at='10:00', service=SERVICE, check=True, prefix=''):
        return self.sql(prefix + f"set role anon; select book_slot('{SLOT}','{service}','Ana Prueba','ana@example.com','123456789','2099-01-05 {at}Z');", check)

    def count_options(self, service=SERVICE):
        return int(self.sql(f"set role anon; select count(*) from available_slots() where slot_id='{SLOT}' and service_id='{service}';").stdout.strip().splitlines()[-1])

    def test_legacy_booking_keeps_full_occupation(self):
        self.assertEqual(self.sql(f"select (extract(epoch from ends_at-starts_at)/60)::int from bookings where slot_id='{LEGACY}';").stdout.strip(), '120')
        self.assertEqual(self.sql(f"select count(*) from available_slots() where slot_id='{LEGACY}';").stdout.strip(), '0')

    def test_remaining_time_then_full_block(self):
        self.book()
        self.assertEqual(self.count_options(), 1)  # Only 11:00 fits a second 60 min.
        self.assertEqual(self.count_options(LONG), 0)
        self.book('11:00')
        self.assertEqual(self.count_options(), 0)
        self.assertNotEqual(self.book('11:00', check=False).returncode, 0)

    def test_treatment_cannot_overrun_or_start_outside_block(self):
        for start, service in [('11:05', SERVICE), ('09:55', SERVICE), ('10:00', HUGE), ('10:01', SERVICE)]:
            with self.subTest(start=start, service=service):
                self.assertNotEqual(self.book(start, service, check=False).returncode, 0)
        self.assertEqual(self.count_options(HUGE), 0)

    def test_overlap_and_adjacent_boundary(self):
        self.book('10:30', LONG)
        self.assertNotEqual(self.book('10:00', check=False).returncode, 0)
        self.assertNotEqual(self.book('11:00', check=False).returncode, 0)
        self.assertEqual(self.count_options(), 0)  # A free half-hour cannot fit 60 min.

    def test_cancellation_only_frees_its_interval(self):
        first=self.book().stdout.strip().splitlines()[-1]
        self.book('11:00')
        self.sql(f"set role authenticated; set request.jwt.claim.sub='{ADMIN}'; update bookings set status='cancelled' where id='{first}';")
        self.assertEqual(self.count_options(), 1)
        self.book('10:00')
        self.assertEqual(self.count_options(), 0)

    def test_blocked_and_inactive_services(self):
        self.sql(f"update slots set blocked=true where id='{SLOT}';")
        self.assertEqual(self.count_options(), 0)
        self.assertNotEqual(self.book(check=False).returncode, 0)
        self.sql(f"update slots set blocked=false where id='{SLOT}'; update services set active=false where id='{SERVICE}';")
        self.assertEqual(self.count_options(), 0)
        self.assertNotEqual(self.book(check=False).returncode, 0)

    def test_concurrent_overlapping_requests_only_one_succeeds(self):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            futures=[pool.submit(self.book, t, SERVICE, False) for t in ['10:00','10:30']]
            results=[f.result() for f in futures]
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertEqual(self.sql(f"select count(*) from bookings where slot_id='{SLOT}';").stdout.strip(),'1')

    def test_duration_edit_does_not_move_existing_booking(self):
        self.book()
        self.sql(f"update services set duration_minutes=90 where id='{SERVICE}';")
        self.assertEqual(self.count_options(),0)
        self.assertEqual(self.sql(f"select (extract(epoch from ends_at-starts_at)/60)::int from bookings where slot_id='{SLOT}';").stdout.strip(),'60')

    def test_private_information_and_direct_inserts_are_denied(self):
        self.book()
        self.assertNotEqual(self.sql('set role anon; select customer_email from bookings;',False).returncode,0)
        self.assertEqual(self.sql('set role authenticated; select count(*) from bookings;').stdout.strip().splitlines()[-1],'0')
        self.assertNotEqual(self.sql(f"set role authenticated; insert into bookings(slot_id,service_id,customer_name,customer_email,customer_phone,starts_at,ends_at) values('{SLOT}','{SERVICE}','Ana','ana@example.com','123456789','2099-01-05 10:30Z','2099-01-05 11:30Z');",False).returncode,0)

    def test_five_hour_treatment_occupies_all_300_minutes(self):
        long_slot='77777777-7777-4777-8777-777777777777'
        self.sql(f"""
            update services set duration_minutes=300 where id='{HUGE}';
            insert into slots(id,starts_at,ends_at) values('{long_slot}','2099-01-06 10:00Z','2099-01-06 16:00Z');
            insert into slot_services values('{long_slot}','{HUGE}'),('{long_slot}','{SERVICE}');
            set role anon;
            select book_slot('{long_slot}','{HUGE}','Ana Prueba','ana@example.com','123456789','2099-01-06 10:00Z');
        """)
        too_late=self.sql(f"set role anon; select book_slot('{long_slot}','{HUGE}','Ana Prueba','ana@example.com','123456789','2099-01-06 12:00Z');",False)
        self.assertNotEqual(too_late.returncode,0)
        self.assertIn('excede el tiempo disponible',too_late.stderr)
        result=self.sql(f"select (extract(epoch from ends_at-starts_at)/60)::int from bookings where slot_id='{long_slot}';").stdout.strip()
        self.assertEqual(result,'300')
        for at in ['10:00','12:00','14:55']:
            self.assertNotEqual(self.sql(f"set role anon; select book_slot('{long_slot}','{SERVICE}','Ana Prueba','ana@example.com','123456789','2099-01-06 {at}Z');",False).returncode,0)
        self.sql(f"set role anon; select book_slot('{long_slot}','{SERVICE}','Ana Prueba','ana@example.com','123456789','2099-01-06 15:00Z');")
        self.assertEqual(self.sql(f"select count(*) from available_slots() where slot_id='{long_slot}';").stdout.strip(),'0')

    def test_historical_slot_cannot_be_moved(self):
        self.book()
        self.assertNotEqual(self.sql(f"update slots set ends_at='2099-01-05 11:00Z' where id='{SLOT}';",False).returncode,0)


if __name__ == '__main__':
    unittest.main()
