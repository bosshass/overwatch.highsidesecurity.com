-- Rollback 056. Every field it wrote is restored from the backup taken first.
update time_entries t
   set time_in           = b.time_in,
       time_out          = b.time_out,
       total_minutes     = b.total_minutes,
       archived          = b.archived,
       resolution_reason = b.resolution_reason
  from backup_056_time_entries b
 where t.id = b.id
   and t.resolution_reason like '056 %';

-- Step 3 was annotation only.
update time_entries
   set needs_review = false, review_reason = null
 where review_reason like '056 %';

drop table if exists backup_056_time_entries;
