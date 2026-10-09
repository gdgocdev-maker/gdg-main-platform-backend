-- Synthetic data for the runner-owned disposable database only; never a seed.
INSERT INTO users(user_id, full_name, email, updated_at)
SELECT i, 'Synthetic participant ' || i, 'performance' || i || '@example.test', now()
FROM generate_series(1,800) i;
INSERT INTO committee(committee_id,committee_name,committee_code) VALUES (1,'Synthetic','synthetic');
INSERT INTO events(event_id,name,starts_at,ends_at,capacity,registration_deadline,status,created_by,committee_id,updated_at)
SELECT i, 'Synthetic event ' || i,
  CASE WHEN i <= 100 THEN now() - interval '30 days' ELSE now() + interval '1 hour' END,
  CASE WHEN i <= 100 THEN now() - interval '30 days' + interval '2 hours' ELSE now() + interval '3 hours' END,
  400,
  CASE WHEN i <= 100 THEN now() - interval '31 days' ELSE now() END,
  CASE WHEN i < 100 THEN 'completed'::"EventStatus" ELSE 'published'::"EventStatus" END,
  1,1,now()
FROM generate_series(1,103) i;
INSERT INTO event_questions(event_id,question_text,question_type,position)
SELECT e, 'Synthetic question ' || q, 'text', q FROM generate_series(1,103) e CROSS JOIN generate_series(0,4) q;
INSERT INTO event_registrations(event_id,user_id,status,registered_at,approved_at,confirmation_deadline,confirmed_at,waitlist_position,attendance_token_hash,attendance_token_encrypted)
SELECT e,i,
  CASE WHEN e<=100 THEN CASE WHEN i%10=0 THEN 'EXPIRED' ELSE 'NOT_SELECTED' END
    WHEN i%5=0 THEN 'CONFIRMED' WHEN i%5=1 THEN 'AWAITING_CONFIRMATION'
    WHEN i%5=2 THEN 'WAITLISTED' ELSE 'PENDING' END::"RegistrationStatus",
  now()-interval '32 days' + i*interval '1 second',
  CASE WHEN (e<=100 AND i%10=0) OR (e>100 AND i%5 IN (0,1)) THEN now()-interval '32 days'+interval '1 hour' END,
  CASE WHEN e<=100 AND i%10=0 THEN now()-interval '31 days'
       WHEN e>100 AND i%5=0 THEN now()+interval '30 minutes'
       WHEN e>100 AND i%5=1 THEN now()-interval '1 minute' END,
  CASE WHEN e>100 AND i%5=0 THEN now()-interval '1 hour' END,
  CASE WHEN e>100 AND i%5=2 THEN i END,
  CASE WHEN e>100 AND i%5=0 THEN md5(e::text || ':' || i::text) END,
  CASE WHEN e>100 AND i%5=0 THEN 'synthetic ciphertext' END
FROM generate_series(1,103) e CROSS JOIN LATERAL generate_series(1,CASE WHEN e<=100 THEN 400 WHEN e=101 THEN 100 WHEN e=102 THEN 400 ELSE 800 END) i;
INSERT INTO registration_blacklist_entries(registration_id,reason)
SELECT registration_id,'CONFIRMATION_EXPIRED' FROM event_registrations WHERE status='EXPIRED';
ANALYZE;
