"""Real ten-minute gaps, including concurrent bookings across availability blocks."""
import concurrent.futures
import unittest
import test_booking_workflow as workflow
S=workflow.S
SLOT=workflow.SLOT

class BookingGap(unittest.TestCase):
    sql=classmethod(workflow.BookingWorkflow.sql.__func__)
    query=workflow.BookingWorkflow.query
    value=workflow.BookingWorkflow.value
    book=workflow.BookingWorkflow.book
    token=workflow.BookingWorkflow.token
    setUp=workflow.BookingWorkflow.setUp

    @classmethod
    def setUpClass(cls):
        workflow.BookingWorkflow.setUpClass.__func__(cls)
        # Legacy adjacent reservations remain unchanged by migration.
        cls.sql(f"insert into bookings(slot_id,service_id,customer_name,customer_email,customer_phone,starts_at,ends_at,status) values('{SLOT}','{S}','Anterior Uno','one@example.com','123456789','2099-01-05 10:00Z','2099-01-05 11:00Z','confirmed'),('{SLOT}','{S}','Anterior Dos','two@example.com','123456789','2099-01-05 11:00Z','2099-01-05 12:00Z','confirmed');")
        cls.before=cls.sql(f"select string_agg(id::text,',' order by id) from bookings where slot_id='{SLOT}';").stdout.strip()
        migration=(workflow.ROOT/'supabase/migrations/20261028_booking_gap.sql').read_text()
        cls.sql(migration);cls.sql(migration)
        cls.after=cls.sql(f"select string_agg(id::text,',' order by id) from bookings where slot_id='{SLOT}';").stdout.strip()

    def extend(self):
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 13:00Z',array['{S}']::uuid[],'Coquimbo',false);",'authenticated')

    def test_every_configurable_margin_is_respected(self):
        for margin in [10,15,20,25,30]:
            with self.subTest(margin=margin):
                self.sql(f"delete from bookings where slot_id='{SLOT}';")
                self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 14:00Z',array['{S}']::uuid[],'Coquimbo',false,{margin});",'authenticated')
                self.book()
                self.assertEqual(self.value(f"select to_char(min(starts_at),'HH24:MI') from available_slots() where slot_id='{SLOT}';",'anon'),f'11:{margin:02}')
                self.assertEqual(self.value(f"select min(gap_minutes) from available_slots() where slot_id='{SLOT}';",'anon'),str(margin))
                self.assertNotEqual(self.book(f'11:{margin-5:02}',check=False).returncode,0)
                self.book(f'11:{margin:02}')

    def test_invalid_margin_and_old_client_preserves_preference(self):
        args=f"'{SLOT}','2099-01-05 10:00Z','2099-01-05 13:00Z',array['{S}']::uuid[],'Coquimbo',false"
        self.assertNotEqual(self.query(f"select admin_save_slot({args},5);",'authenticated',False).returncode,0)
        self.query(f"select admin_save_slot({args},25);",'authenticated')
        self.query(f"select admin_save_slot({args});",'authenticated')
        self.assertEqual(self.value(f"select gap_minutes from slots where id='{SLOT}';"),'25')

    def test_larger_margin_applies_between_blocks(self):
        other='88888888-8888-4888-8888-888888888888'
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 11:00Z',array['{S}']::uuid[],'Coquimbo',false,30);",'authenticated')
        self.sql(f"insert into slots(id,starts_at,ends_at,gap_minutes) values('{other}','2099-01-05 11:00Z','2099-01-05 13:00Z',10);insert into slot_services values('{other}','{S}');")
        self.book()
        self.assertEqual(self.value(f"select to_char(min(starts_at),'HH24:MI') from available_slots() where slot_id='{other}';",'anon'),'11:30')

    def test_existing_bookings_preserved(self):self.assertEqual(self.before,self.after)

    def test_exact_ten_minutes_allowed_five_rejected(self):
        self.extend();self.book()
        self.assertNotEqual(self.book('11:00',check=False).returncode,0)
        self.assertNotEqual(self.book('11:05',check=False).returncode,0)
        self.assertEqual(self.value(f"select to_char(min(starts_at),'HH24:MI') from available_slots() where slot_id='{SLOT}';",'anon'),'11:10')
        self.book('11:10')

    def test_gap_applies_before_an_existing_cite(self):
        self.extend();self.book('11:10')
        self.assertNotEqual(self.book('10:05',check=False).returncode,0)
        self.book('10:00')

    def test_cannot_extend_treatment_beyond_closing_for_gap(self):
        self.book()
        self.assertEqual(self.value(f"select count(*) from available_slots() where slot_id='{SLOT}';",'anon'),'0')
        self.assertNotEqual(self.book('11:10',check=False).returncode,0)

    def test_cancel_frees_interval_and_gap(self):
        self.extend();self.book();bid=self.value(f"select id from bookings where slot_id='{SLOT}';")
        self.query(f"select admin_save_booking('{bid}','{SLOT}','{S}','2099-01-05 10:00Z','Ana Prueba','ana@example.com','123456789','Coquimbo','Calle Prueba 123','cancelled');",'authenticated')
        self.book('10:05')

    def test_admin_edit_cannot_remove_gap(self):
        self.extend();self.book();self.book('11:10')
        bid=self.value(f"select id from bookings where slot_id='{SLOT}' and starts_at='2099-01-05 11:10Z';")
        r=self.query(f"select admin_save_booking('{bid}','{SLOT}','{S}','2099-01-05 11:05Z','Ana Prueba','ana@example.com','123456789','Coquimbo','Calle Prueba 123','pending');",'authenticated',False)
        self.assertNotEqual(r.returncode,0)

    def test_five_hour_cite_keeps_duration_and_ten_minute_gap(self):
        other=workflow.baseline.LONG
        self.sql(f"update services set duration_minutes=300 where id='{S}';")
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 10:00Z','2099-01-05 17:00Z',array['{S}','{other}']::uuid[],'Coquimbo',false);",'authenticated')
        self.book()
        self.assertEqual(self.value(f"select (extract(epoch from ends_at-starts_at)/60)::int from bookings where slot_id='{SLOT}';"),'300')
        self.assertEqual(self.value(f"select to_char(min(starts_at),'HH24:MI') from available_slots() where slot_id='{SLOT}' and service_id='{other}';",'anon'),'15:10')
        self.query(f"select book_slot('{SLOT}','{other}','Ana Prueba','ana@example.com','123456789','2099-01-05 15:10Z','Coquimbo','Calle Prueba 123');")

    def test_concurrent_distinct_blocks_respect_gap(self):
        other='88888888-8888-4888-8888-888888888888'
        self.sql(f"update slots set ends_at='2099-01-05 11:00Z' where id='{SLOT}';insert into slots(id,starts_at,ends_at) values('{other}','2099-01-05 11:05Z','2099-01-05 12:05Z');insert into slot_services values('{other}','{S}');")
        def second():return self.query(f"select book_slot('{other}','{S}','Ana Prueba','ana@example.com','123456789','2099-01-05 11:05Z','Coquimbo','Calle Prueba 123');",check=False)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            a=pool.submit(self.book,check=False);b=pool.submit(second)
            self.assertEqual(sum(r.returncode==0 for r in [a.result(),b.result()]),1)

if __name__=='__main__':unittest.main()
