"""Consent evidence is transactional, server dated, versioned and inaccessible to visitors."""
import json
import unittest
import test_sequential_options as seq
from test_booking_workflow import ROOT,S,SLOT,ADMIN

class LegalConsent(unittest.TestCase):
    sql=classmethod(seq.SequentialOptions.sql.__func__)
    query=seq.SequentialOptions.query
    value=seq.SequentialOptions.value
    setUp=seq.SequentialOptions.setUp

    @classmethod
    def setUpClass(cls):
        seq.SequentialOptions.setUpClass.__func__(cls)
        cls.sql(f"alter table auth.users add column email text;update auth.users set email='admin@example.com' where id='{ADMIN}';")
        migration=(ROOT/'supabase/migrations/20261028_legal_consent.sql').read_text()
        
        for _ in range(2):
            result=cls.sql(migration,False)
            if result.returncode:raise RuntimeError(result.stderr)
        cls.sql("update legal_settings set ready=true where id;")

    def reserve(self,terms='true',privacy='true',version='2026-10-28.v1',start='10:00',check=True):
        return self.query(f"select book_slot('{SLOT}','{S}','Ana Prueba','ana@example.com','123456789','2099-01-05 {start}Z','Coquimbo','Calle Prueba 123','{version}',{terms},{privacy});",check=check)

    def test_missing_separate_acceptance_rolls_back_booking_and_mails(self):
        before=self.value('select count(*) from legal_acceptances;')
        for terms,privacy in [('false','true'),('true','false'),('null','true')]:
            self.assertNotEqual(self.reserve(terms,privacy,check=False).returncode,0)
        self.assertEqual(self.value(f"select count(*) from bookings where slot_id='{SLOT}';"),'0')
        self.assertEqual(self.value('select count(*) from booking_email_jobs;'),'0')
        self.assertEqual(self.value('select count(*) from legal_acceptances;'),before)

    def test_atomic_evidence_survives_booking_deletion(self):
        bid=self.reserve().stdout.strip().splitlines()[-1]
        self.assertEqual(self.value(f"select count(*) from legal_acceptances where booking_reference='{bid}' and source='booking' and terms_accepted and privacy_accepted and accepted_at<=clock_timestamp();"),'1')
        self.assertEqual(self.value(f"select booking_snapshot->>'price_clp' from legal_acceptances where booking_reference='{bid}';"),'25000')
        self.assertEqual(self.value(f"select jsonb_array_length(payload->'legal_documents') from booking_email_jobs where booking_id='{bid}' and kind='booked';"),'4')
        self.query(f"select admin_delete_booking('{bid}');",'authenticated')
        self.assertEqual(self.value(f"select count(*) from legal_acceptances where booking_reference='{bid}';"),'1')

    def test_rejects_stale_version_and_unpublished_documents(self):
        self.assertNotEqual(self.reserve(version='old',check=False).returncode,0)
        self.sql('update legal_settings set ready=false where id;')
        try:self.assertNotEqual(self.reserve(check=False).returncode,0)
        finally:self.sql('update legal_settings set ready=true where id;')

    def test_old_rpc_and_helper_cannot_bypass_acceptance(self):
        for name in ['book_slot','book_slot_legacy_without_consent']:
            r=self.query(f"select {name}('{SLOT}','{S}','Ana Prueba','ana@example.com','123456789','2099-01-05 10:00Z','Coquimbo','Calle Prueba 123');",check=False)
            self.assertNotEqual(r.returncode,0)
        self.assertNotEqual(self.query("select record_legal_acceptance('x@example.com','2026-10-28.v1',true,true,'booking');",check=False).returncode,0)

    def test_visitors_cannot_read_or_modify_evidence_and_admin_can_export(self):
        self.assertNotEqual(self.query('select * from legal_acceptances;',check=False).returncode,0)
        self.assertNotEqual(self.query('delete from legal_acceptances;',role='authenticated',check=False).returncode,0)
        self.assertEqual(self.query('select * from legal_acceptances;',role='authenticated').returncode,0)
        other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        self.assertEqual(self.sql(f"set role authenticated;set request.jwt.claim.sub='{other}';select count(*) from legal_acceptances;").stdout.strip().splitlines()[-1],'0')

    def test_archived_html_matches_database_and_hashes(self):
        import hashlib
        for p in (ROOT/'legal/2026-10-28').glob('*.html'):
            record=json.loads(self.value(f"select json_build_object('content',content,'sha256',sha256) from legal_documents where version='2026-10-28.v1' and kind='{p.stem}';"))
            self.assertEqual(record['content'],p.read_text())
            self.assertEqual(record['sha256'],hashlib.sha256(p.read_bytes()).hexdigest())

    def test_admin_identity_is_taken_from_authenticated_account(self):
        eid=self.query("select admin_legal_acceptance('2026-10-28.v1',true,true,'slot');",'authenticated').stdout.strip().splitlines()[-1]
        self.assertEqual(self.value(f"select subject_email||':'||source||':'||identity_assurance from legal_acceptances where id='{eid}';"),'admin@example.com:admin:slot:authenticated_admin')
        self.assertNotEqual(self.query("select admin_legal_acceptance('2026-10-28.v1',true,true,'other');",'authenticated',False).returncode,0)

    def test_contact_records_declared_email_without_booking(self):
        eid=self.query("select contact_legal_acceptance('contact@example.com','2026-10-28.v1',true,true);").stdout.strip().splitlines()[-1]
        self.assertEqual(self.value(f"select source||':'||identity_assurance from legal_acceptances where id='{eid}';"),'contact:declared_email')

if __name__=='__main__':unittest.main()
