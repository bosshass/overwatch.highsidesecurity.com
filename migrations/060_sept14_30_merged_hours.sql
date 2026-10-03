-- 060 — Sept 14–30 hours left on merged-away cards → the card they were merged into
-- RAN 2026-10-03 via Supabase. Scope: visits Sept 14–30 only, nothing earlier.
-- Backup: time_entries_backup_060 (the 5 rows as they were). Only job_id and
-- merged_from_job_id changed; billed / archived / disposition / notes untouched.
--
--   Trevor  Sep 14  4.0h  Pierson Concrete  → Pierson Concrete (billed)
--   Trevor  Sep 15  1.0h  Lanting           → Lanting (to_bill)
--   JR      Sep 22  0.0h  Sushi 1           → Tae Won Suh (billed)
--   Trevor  Sep 22  0.0h  Sushi 1 (warranty)→ Tae Won Suh (billed)
--   Trevor  Sep 22  2.0h  Pierson Concrete  → Pierson Concrete (billed)
create table if not exists time_entries_backup_060 as select * from time_entries where id in ('d5713f2f-04b6-4fe3-9529-586109948579','6d02fe1d-e415-4c9b-a684-12fae213a840','90c8a536-7ae8-4da2-83c8-199f4c27b6e6','3c569a0c-ba2c-43c3-8a39-474324c8c097','0ea0edcc-7309-4016-a5ec-45795135efdf');
update time_entries t set job_id = v.to_job::uuid, merged_from_job_id = v.from_job::uuid
from (values
 ('d5713f2f-04b6-4fe3-9529-586109948579','b28d3d96-14d1-4883-a53a-ddddf1b9c710','94fc7508-4d5f-43e9-8338-194265f6689e'),
 ('6d02fe1d-e415-4c9b-a684-12fae213a840','ecb1679b-c050-4e43-991b-4f6fba0d1467','a07d16be-c1f1-4cc3-920a-5ad60d6ce8ad'),
 ('90c8a536-7ae8-4da2-83c8-199f4c27b6e6','d9895d9b-776a-485c-a5f8-64bd6dfe36b4','8bfbd411-496e-4e80-8269-ae32edd06504'),
 ('3c569a0c-ba2c-43c3-8a39-474324c8c097','d9895d9b-776a-485c-a5f8-64bd6dfe36b4','8bfbd411-496e-4e80-8269-ae32edd06504'),
 ('0ea0edcc-7309-4016-a5ec-45795135efdf','f4e6995d-3b15-4858-9e1b-1f83768ea49c','94fc7508-4d5f-43e9-8338-194265f6689e')
) as v(id, from_job, to_job)
where t.id = v.id::uuid and t.job_id = v.from_job::uuid;
