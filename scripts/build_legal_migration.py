"""Bundle exact archived HTML into the SQL migration; never edit published versions."""
from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parents[1]
sql=(root/'scripts/legal_schema.sql').read_text()
for p in sorted((root/'legal/2026-10-28').glob('*.html')):
    content=p.read_text()
    assert '$legal_html$' not in content
    sql+=f"\ninsert into public.legal_documents(version,kind,url,content,sha256) values('2026-10-28.v1','{p.stem}','/legal/2026-10-28/{p.name}',$legal_html${content}$legal_html$,'{hashlib.sha256(content.encode()).hexdigest()}') on conflict do nothing;\n"
if json.loads((root/'legal/responsable.json').read_text())['ready']:
    sql+="\nupdate public.legal_settings set ready=true where id and version='2026-10-28.v1';\n"
sql+="\nnotify pgrst,'reload schema';\ncommit;\n"
(root/'supabase/migrations/20261028_legal_consent.sql').write_text(sql)
