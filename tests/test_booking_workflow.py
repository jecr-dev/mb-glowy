"""New workflow migration against disposable PostgreSQL; no real email is sent."""
import concurrent.futures
import json
import unittest
import test_booking_durations as baseline

ROOT=baseline.ROOT
S=baseline.SERVICE
SLOT=baseline.SLOT
ADMIN=baseline.ADMIN
LEGACY=baseline.LEGACY

class BookingWorkflow(unittest.TestCase):
    sql=classmethod(baseline.BookingDurations.sql.__func__)

    @classmethod
    def setUpClass(cls):
        baseline.BookingDurations.setUpClass.__func__(cls)
        cls.sql('create role service_role; grant usage on schema public to service_role;')
        cls.sql((ROOT/'supabase/migrations/20261028_confirmations_communes.sql').read_text())
        cls.sql((ROOT/'supabase/migrations/20261028_reservation_mail_alias.sql').read_text())

    def setUp(self):
        self.sql(f"delete from booking_email_jobs; delete from bookings where slot_id<>'{LEGACY}'; delete from slots where id<>'{LEGACY}'; insert into slots(id,starts_at,ends_at) values('{SLOT}','2099-01-05 10:00Z','2099-01-05 12:00Z'); insert into slot_services select '{SLOT}',id from services;update services set duration_minutes=60,active=true where id='{S}';update services set duration_minutes=90 where id='{baseline.LONG}';")

    def query(self,s,role='anon',check=True):
        prefix=f"set role {role};"
        if role=='authenticated':prefix+=f"set request.jwt.claim.sub='{ADMIN}';"
        return self.sql(prefix+s,check)

    def value(self,s,role=None):
        r=self.query(s,role) if role else self.sql(s)
        return r.stdout.strip().splitlines()[-1]

    def book(self,start='10:00',commune='Coquimbo',check=True):
        return self.query(f"select book_slot('{SLOT}','{S}','Ana Prueba','ana@example.com','123456789','2099-01-05 {start}Z','{commune}','Calle Prueba 123');",check=check)

    def token(self):
        return self.value(f"select token from booking_confirmation_tokens t join bookings b on b.id=t.booking_id where b.slot_id='{SLOT}';")

    def test_pending_and_first_commune_lock(self):
        self.book()
        self.assertEqual(self.value(f"select status||':'||commune from bookings where slot_id='{SLOT}';"),'pending:Coquimbo')
        self.assertEqual(self.value(f"select commune_source from slots where id='{SLOT}';"),'booking')
        self.assertNotEqual(self.book('11:00','Ovalle',False).returncode,0)
        self.book('11:00','Coquimbo')
        self.assertEqual(self.value(f"select count(*) from available_slots() where slot_id='{SLOT}';"),'0')

    def test_admin_commune_anywhere_and_public_restrictions(self):
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 12:00Z',array['{S}']::uuid[],'Santiago',false);",'authenticated')
        self.assertNotEqual(self.book(commune='Ovalle',check=False).returncode,0)
        self.book(commune='Santiago')
        self.assertEqual(self.value(f"select commune from bookings where slot_id='{SLOT}';"),'Santiago')

    def test_block_can_be_closed_after_service_is_hidden(self):
        self.sql(f"update services set active=false where id='{S}';")
        self.query(f"select admin_set_slot_blocked('{SLOT}',true);",'authenticated')
        self.assertEqual(self.value(f"select blocked from slots where id='{SLOT}';"),'t')

    def test_unassigned_only_three_and_address_required(self):
        self.assertNotEqual(self.book(commune='Santiago',check=False).returncode,0)
        r=self.query(f"select book_slot('{SLOT}','{S}','Ana Prueba','ana@example.com','123456789','2099-01-05 10:00Z','Ovalle','');",check=False)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(self.value(f"select commune is null from slots where id='{SLOT}';"),'t')

    def test_concurrent_first_communes_cannot_split_block(self):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results=list(pool.map(lambda x:self.book(*x,check=False),[('10:00','Ovalle'),('11:00','La Serena')]))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertEqual(self.value(f"select count(distinct commune) from bookings where slot_id='{SLOT}';"),'1')

    def test_confirmation_does_not_happen_on_page_read(self):
        self.book();t=self.token()
        result=json.loads(self.value(f"select booking_confirmation_info('{t}');",'anon'))
        self.assertTrue(result['can_confirm'])
        self.assertEqual(self.value(f"select status from bookings where slot_id='{SLOT}';"),'pending')
        result=json.loads(self.value(f"select confirm_booking('{t}');",'anon'))
        self.assertTrue(result['ok'])
        self.assertEqual(self.value(f"select status from bookings where slot_id='{SLOT}';"),'confirmed')
        self.assertTrue(json.loads(self.value(f"select confirm_booking('{t}');",'anon'))['ok'])

    def seed_late(self,minutes):
        # Simulate a previously-created reservation now approaching its cutoff.
        self.sql(f"insert into slots(id,starts_at,ends_at) values('99999999-9999-4999-8999-999999999999',now()+interval '{minutes} minutes',now()+interval '{minutes+60} minutes'); insert into bookings(slot_id,service_id,customer_name,customer_email,customer_phone,starts_at,ends_at,commune,customer_address,status) values('99999999-9999-4999-8999-999999999999','{S}','Ana Prueba','ana@example.com','123456789',now()+interval '{minutes} minutes',now()+interval '{minutes+60} minutes','Ovalle','Calle Prueba 123','pending');")
        return self.value("select token from booking_confirmation_tokens t join bookings b on b.id=t.booking_id where b.slot_id='99999999-9999-4999-8999-999999999999';")

    def test_confirmation_cutoff_enforced_without_cron(self):
        t=self.seed_late(149)
        result=json.loads(self.value(f"select confirm_booking('{t}');",'anon'))
        self.assertFalse(result['ok'])
        self.assertEqual(self.value("select status from bookings where slot_id='99999999-9999-4999-8999-999999999999';"),'unconfirmed')

    def test_grace_window_before_cutoff_accepts(self):
        t=self.seed_late(151)
        self.assertTrue(json.loads(self.value(f"select confirm_booking('{t}');",'anon'))['ok'])

    def test_minimum_booking_advance(self):
        self.sql(f"update slots set starts_at=now()+interval '1 hour',ends_at=now()+interval '2 hours' where id='{SLOT}';")
        self.assertEqual(self.value(f"select count(*) from available_slots() where slot_id='{SLOT}';",'anon'),'0')
        r=self.query(f"select book_slot('{SLOT}','{S}','Ana Prueba','ana@example.com','123456789',now()+interval '1 hour','Ovalle','Calle Prueba 123');",check=False)
        self.assertNotEqual(r.returncode,0)

    def admin_edit(self,booking_id,extra=''):
        return self.query(f"select admin_save_booking('{booking_id}','{SLOT}','{S}','2099-01-05 11:00Z','Ana Prueba','ana2@example.com','123456789','Coquimbo','Calle Nueva 456','pending');"+extra,'authenticated')

    def test_edit_rotates_token_and_renews_confirmation(self):
        self.book();old=self.token();self.value(f"select confirm_booking('{old}');",'anon')
        booking_id=self.value(f"select id from bookings where slot_id='{SLOT}';")
        self.admin_edit(booking_id)
        self.assertNotEqual(old,self.token())
        self.assertEqual(self.value(f"select status from bookings where id='{booking_id}';"),'pending')
        self.assertEqual(self.value(f"select booking_confirmation_info('{old}') is null;",'anon'),'t')
        self.assertEqual(self.value(f"select recipient from booking_email_jobs where booking_id='{booking_id}' and kind='updated';"),'ana2@example.com')

    def test_edit_slot_must_contain_cites_and_keep_commune(self):
        self.book()
        r=self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:30Z','2099-01-05 12:00Z',array['{S}']::uuid[],'Coquimbo',false);",'authenticated',False)
        self.assertNotEqual(r.returncode,0)
        r=self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 12:00Z',array['{S}']::uuid[],'Ovalle',false);",'authenticated',False)
        self.assertNotEqual(r.returncode,0)
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 13:00Z',array['{S}']::uuid[],'Coquimbo',false);",'authenticated')

    def test_delete_reservation_then_block_and_keep_cancellation_mail(self):
        self.book();bid=self.value(f"select id from bookings where slot_id='{SLOT}';")
        self.assertNotEqual(self.query(f"select admin_delete_slot('{SLOT}');",'authenticated',False).returncode,0)
        self.query(f"select admin_delete_booking('{bid}');select admin_delete_slot('{SLOT}');",'authenticated')
        self.assertEqual(self.value(f"select count(*) from bookings where id='{bid}';"),'0')
        self.assertEqual(self.value("select count(*) from booking_email_jobs where kind='cancelled' and booking_id is null;"),'1')

    def test_jobs_reminder_due_and_private_tokens(self):
        self.book()
        self.assertEqual(self.value("select count(*) from booking_email_jobs;"),'3')
        self.assertEqual(self.value("select recipient from booking_email_jobs where kind='admin_booked';"),'m.barahona@mbglowy.com')
        self.assertEqual(self.value("select (extract(epoch from(b.starts_at-j.due_at))/3600)::int from booking_email_jobs j join bookings b on b.id=j.booking_id where j.kind='reminder';"),'5')
        self.assertNotEqual(self.query('select * from claim_booking_emails();',check=False).returncode,0)
        self.assertNotEqual(self.query('select token from booking_confirmation_tokens;',check=False).returncode,0)
        self.assertNotEqual(self.query('select payload from booking_email_jobs;','authenticated',False).returncode,0)
        rows=self.value("select count(*) from claim_booking_emails(20);",'service_role')
        self.assertEqual(rows,'2')  # Reminder must wait until five hours before.
        self.assertEqual(self.value("select count(*) from claim_booking_emails(20);",'service_role'),'0')

    def test_sent_mail_retention_uses_delivery_date(self):
        self.book()
        self.sql("update booking_email_jobs set state='sent',created_at=now()-interval '20 days',sent_at=now() where kind='booked';")
        self.value("select count(*) from claim_booking_emails(20);",'service_role')
        self.assertEqual(self.value("select count(*) from booking_email_jobs where kind='booked';"),'1')
        self.sql("update booking_email_jobs set sent_at=now()-interval '8 days' where kind='booked';")
        self.value("select count(*) from claim_booking_emails(20);",'service_role')
        self.assertEqual(self.value("select count(*) from booking_email_jobs where kind='booked';"),'0')

    def test_queued_initial_mail_reflects_confirmation(self):
        self.book();self.value(f"select confirm_booking('{self.token()}');",'anon')
        self.assertEqual(self.value("select count(*) from claim_booking_emails(20) where payload->>'status'='pending';",'service_role'),'0')

    def test_cancel_preserves_commune_and_rejects_token(self):
        self.book();t=self.token();bid=self.value(f"select id from bookings where slot_id='{SLOT}';")
        self.query(f"select admin_save_booking('{bid}','{SLOT}','{S}','2099-01-05 10:00Z','Ana Prueba','ana@example.com','123456789','Coquimbo','Calle Prueba 123','cancelled');",'authenticated')
        self.assertFalse(json.loads(self.value(f"select confirm_booking('{t}');",'anon'))['ok'])
        self.assertEqual(self.value(f"select commune from slots where id='{SLOT}';"),'Coquimbo')
        self.assertEqual(self.value("select count(*) from booking_email_jobs where kind='reminder';"),'0')

    def test_eighty_minutes_must_fit_before_closing(self):
        self.sql(f"update services set duration_minutes=80 where id='{S}';")
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 15:00Z','2099-01-05 18:00Z',array['{S}']::uuid[],'Ovalle',false);",'authenticated')
        self.assertEqual(self.value(f"select to_char(max(starts_at),'HH24:MI') from available_slots() where slot_id='{SLOT}';",'anon'),'16:40')
        self.assertNotEqual(self.book('17:00','Ovalle',False).returncode,0)
        self.book('16:40','Ovalle')
        self.assertEqual(self.value(f"select to_char(ends_at,'HH24:MI') from bookings where slot_id='{SLOT}';"),'18:00')

    def test_five_hours_still_reserves_three_hundred_minutes(self):
        other=baseline.LONG
        self.sql(f"update services set duration_minutes=300 where id='{S}';update services set duration_minutes=60 where id='{other}';")
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 16:00Z',array['{S}','{other}']::uuid[],'Ovalle',false);",'authenticated')
        self.book('10:00','Ovalle')
        self.assertEqual(self.value(f"select (extract(epoch from ends_at-starts_at)/60)::int from bookings where slot_id='{SLOT}';"),'300')
        self.assertEqual(self.value(f"select count(*) from available_slots() where slot_id='{SLOT}' and service_id='{other}';",'anon'),'1')
        self.query(f"select book_slot('{SLOT}','{other}','Ana Prueba','ana@example.com','123456789','2099-01-05 15:00Z','Ovalle','Calle Prueba 123');")
        self.assertEqual(self.value(f"select count(*) from available_slots() where slot_id='{SLOT}';",'anon'),'0')

    def test_abandoned_final_attempt_is_reported_as_failed(self):
        self.book()
        self.value("select count(*) from claim_booking_emails(20);",'service_role')
        self.sql("update booking_email_jobs set attempts=8,lease_until=now()-interval '1 minute' where kind='booked';")
        self.value("select count(*) from claim_booking_emails(20);",'service_role')
        self.assertEqual(self.value("select state from booking_email_jobs where kind='booked';"),'failed')

if __name__=='__main__':unittest.main()
