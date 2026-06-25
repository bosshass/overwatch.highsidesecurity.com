-- ============================================
-- 005_customer_master_pilot.sql
-- Customer Master — 50-row pilot stamp (June 2026 cleanup).
-- Match the seed to existing customers on cms_account_id (CS#, TEXT).
-- Stamp: the new customer code into drh_id (drh_id is now the code) + phone + email.
-- billing_gap is intentionally NOT imported. No schema change (no new column).
-- Idempotent / re-runnable. Existing phone/email are preserved when the
-- seed cell is blank (COALESCE), so we never wipe contact info with empties.
-- Source: /Users/sara/Downloads/customer_master_seed.csv, rows 1-50.
-- Rows that match an existing customer get stamped; others update nothing.
-- Applied 2026-06-25 via anon key: 46 of 50 matched.
-- ============================================

UPDATE customers AS c SET
  drh_id = v.customer_code,
  phone = COALESCE(NULLIF(v.phone, ''), c.phone),
  email = COALESCE(NULLIF(v.email, ''), c.email)
FROM (VALUES
  ('5420642', 'DUR001', '(818) 508-8608', ''),
  ('6910001', 'GRE002', '', ''),
  ('6910173', 'ACE003', '(970) 222-9982', 'Dawn@acejohnstown.com'),
  ('6910010', 'PEO004', '', ''),
  ('EL3552', 'ACE005', '', ''),
  ('6910938', 'ACE006', '(303) 834-8413', 'accounting@acertaralabs.com'),
  ('6910479', 'AJR007', '', ''),
  ('6910878', 'ALL008', '(970) 229-9327', 'judithallard1@icloud.com'),
  ('FLSIP10252', 'AND009', '(970) 377-9000', 'amynanderson@yahoo.com'),
  ('6910986', 'ARC010', '(970) 619-0081', 'mlvsg@yahoo.com'),
  ('6910908', 'ARR011', '(970) 226-4542', 'Melany_Arrington@yahoo.com'),
  ('6910322', 'ASC012', '(970) 221-2616', 'info@ascend-orthodontics.com'),
  ('6910023', 'AWA013', '', ''),
  ('6910031', 'TOO014', '(970) 669-1122', 'khambright@toothzone.com'),
  ('6910912', 'AWA015', '', ''),
  ('IPDAT5888', 'BAR016', '', 'karolyn@rockymtnemail.com'),
  ('6910526', 'BES017', '(970) 267-6500', 'ap@besteventrentals.net'),
  ('6910780', 'BES018', '9702820700', 'ap@bestrentalinc.com'),
  ('FLRS70645', 'BES019', '', ''),
  ('6910045', 'JOH020', '(970) 568-8508', 'Kejlbj@yahoo.com'),
  ('6910046', 'BRE021', '', ''),
  ('6910047', 'INT022', '', 'icenterhealth@gmail.com, nolamacdonald@gmail.com'),
  ('6910351', 'BES023', '(970) 484-1984 Mobile:(970) 645-0194', 'j.quint@twc-management.com'),
  ('6910050', 'EDS024', '', ''),
  ('6910959', 'BGA025', '', ''),
  ('6910958', 'BGA026', '', ''),
  ('6910221', 'BGA027', '', ''),
  ('6910061', 'SWE028', '', ''),
  ('6910162', 'BGA029', '', ''),
  ('6910011', 'BGA030', '', ''),
  ('6910068', 'VIO031', '', ''),
  ('6910099', 'BGH032', '', ''),
  ('6910086', 'BGS033', '', ''),
  ('6910896', 'BIG034', '', 'lisa@bigofc.com'),
  ('6910775', 'BIG035', '(970) 223-0415 Mobile:(970) 493-5495 Kristy', 'bigo6252@gmail.com, lisa@bigofc.com'),
  ('6910816', 'BIL036', '', ''),
  ('6910446', 'BLO037', '(970) 222-2081 Mobile:(970) 222-2091- Pat', 'pjbaum@lpbroadband.net, tmblomquist@lpbroadband.net'),
  ('6910359', 'BLO038', '(970) 667-4725', 'tmblomquist@lpbroadband.net'),
  ('6910889', 'BLU039', '', ''),
  ('6910902', 'BLU040', '', ''),
  ('6910930', 'BLU041', '(970) 236-1580', 'AP@blueocean-inc.com'),
  ('6910754', 'BLU042', '(970) 498-0196', 'tracey@blueskyoms.com'),
  ('6910753', 'BLU043', '', ''),
  ('6910443', 'BOA044', '(970) 484-5767', 'Thomas.boardman48@gmail.com'),
  ('6910990', 'BOL045', '(970) 449-0189', 'apinquiry@boldrenew.com'),
  ('6910097', 'BON046', '', ''),
  ('6910535', 'BOY047', '', ''),
  ('EL0127', 'BOY048', '970-484-6700x300', 'rachelleg925@gmail.com'),
  ('6910728', 'BRO049', '', ''),
  ('6910030', 'BRO050', '(970) 493-2117 Mobile:(970) 215-3009', 'MargieGBrown@outlook.com')
) AS v(cms_account_id, customer_code, phone, email)
WHERE c.cms_account_id = v.cms_account_id;
