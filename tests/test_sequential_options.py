"""Listed options tile free windows by treatment duration + configured gap."""
import unittest
import test_booking_gap as gap
from test_booking_workflow import S,SLOT,ROOT

class SequentialOptions(unittest.TestCase):
    sql=classmethod(gap.BookingGap.sql.__func__)
    query=gap.BookingGap.query
    value=gap.BookingGap.value
    book=gap.BookingGap.book
    setUp=gap.BookingGap.setUp

    @classmethod
    def setUpClass(cls):
        gap.BookingGap.setUpClass.__func__(cls)
        sql=(ROOT/'supabase/migrations/20261028_sequential_booking_options.sql').read_text()
        cls.sql(sql);cls.sql(sql)

    def configure(self,duration=60,margin=10,end='18:00'):
        self.sql(f"update services set duration_minutes={duration} where id='{S}';")
        self.query(f"select admin_save_slot('{SLOT}','2099-01-05 13:00Z','2099-01-05 {end}Z',array['{S}']::uuid[],'Coquimbo',false,{margin});",'authenticated')

    def options(self):
        return self.value(f"select coalesce(string_agg(to_char(starts_at,'HH24:MI')||'–'||to_char(ends_at,'HH24:MI'),',' order by starts_at),'none') from available_slots() where slot_id='{SLOT}' and service_id='{S}';",'anon')

    def test_exact_user_example(self):
        self.configure()
        self.assertEqual(self.options(),'13:00–14:00,14:10–15:10,15:20–16:20,16:30–17:30')

    def test_all_five_gaps_change_sequence(self):
        for margin in [10,15,20,25,30]:
            self.configure(margin=margin)
            self.assertEqual(self.value(f"select to_char(starts_at,'HH24:MI') from available_slots() where slot_id='{SLOT}' order by starts_at offset 1 limit 1;",'anon'),f'14:{margin:02}')

    def test_eighty_minutes_does_not_overrun_closing(self):
        self.configure(duration=80,end='18:00')
        self.assertEqual(self.options(),'13:00–14:20,14:30–15:50,16:00–17:20')
        self.assertNotEqual(self.book('17:00',check=False).returncode,0)

    def test_five_hour_treatment_is_not_shortened(self):
        self.configure(duration=300,end='23:30')
        self.assertEqual(self.options(),'13:00–18:00,18:10–23:10')

    def test_existing_mixed_duration_anchors_free_window(self):
        self.configure()
        other='abababab-abab-4bab-8bab-abababababab'
        self.sql(f"insert into services(id,name,duration_minutes,price) values('{other}','Tratamiento de 47 minutos',47,1000);insert into slot_services values('{SLOT}','{other}');")
        self.query(f"select book_slot('{SLOT}','{other}','Ana Prueba','ana@example.com','123456789','2099-01-05 13:00Z','Coquimbo','Calle Prueba 123');")
        self.assertEqual(self.options(),'13:57–14:57,15:07–16:07,16:17–17:17')
        self.book('13:57')  # Every listed option must be accepted, even off the old 5-minute grid.

    def test_cancellation_restores_original_sequence(self):
        self.configure();self.book('14:10')
        self.assertEqual(self.options(),'13:00–14:00,15:20–16:20,16:30–17:30')
        bid=self.value(f"select id from bookings where slot_id='{SLOT}';")
        self.query(f"select admin_save_booking('{bid}','{SLOT}','{S}','2099-01-05 14:10Z','Ana Prueba','ana@example.com','123456789','Coquimbo','Calle Prueba 123','cancelled');",'authenticated')
        self.assertEqual(self.options(),'13:00–14:00,14:10–15:10,15:20–16:20,16:30–17:30')

if __name__=='__main__':unittest.main()
