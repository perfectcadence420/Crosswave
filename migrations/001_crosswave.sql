-- Crosswave v1: anonymous matchmaking + ephemeral WebRTC signaling.
-- Each block separated by "-- @statement" is one transaction statement.
-- Run against an isolated Neon branch, then apply to production after review.
-- @statement
CREATE SCHEMA IF NOT EXISTS crosswave;
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash)=64),
  accepted_rules_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  banned_until timestamptz
);
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.waiting_queue (
  guest_id uuid PRIMARY KEY REFERENCES crosswave.guests(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('video','text')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
-- @statement
CREATE INDEX IF NOT EXISTS waiting_queue_candidates ON crosswave.waiting_queue (mode, joined_at);
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_a uuid NOT NULL REFERENCES crosswave.guests(id),
  guest_b uuid NOT NULL REFERENCES crosswave.guests(id),
  mode text NOT NULL CHECK (mode IN ('video','text')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES crosswave.guests(id),
  CHECK (guest_a <> guest_b)
);
-- @statement
CREATE INDEX IF NOT EXISTS calls_active_a ON crosswave.calls (guest_a) WHERE ended_at IS NULL;
-- @statement
CREATE INDEX IF NOT EXISTS calls_active_b ON crosswave.calls (guest_b) WHERE ended_at IS NULL;
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.blocks (
  blocker_id uuid NOT NULL REFERENCES crosswave.guests(id),
  blocked_id uuid NOT NULL REFERENCES crosswave.guests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id,blocked_id),
  CHECK (blocker_id <> blocked_id)
);
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES crosswave.calls(id),
  sender_id uuid NOT NULL REFERENCES crosswave.guests(id),
  receiver_id uuid NOT NULL REFERENCES crosswave.guests(id),
  kind text NOT NULL CHECK (kind IN ('offer','answer','ice','text')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(payload::text) <= 65536),
  CHECK (sender_id <> receiver_id)
);
-- @statement
CREATE INDEX IF NOT EXISTS signals_inbox ON crosswave.signals (receiver_id,call_id,id);
-- @statement
CREATE INDEX IF NOT EXISTS signals_created ON crosswave.signals (created_at);
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES crosswave.calls(id),
  reporter_id uuid NOT NULL REFERENCES crosswave.guests(id),
  reported_id uuid NOT NULL REFERENCES crosswave.guests(id),
  reason text NOT NULL CHECK (reason IN ('nudity','harassment','hate','spam','underage','other')),
  details text NOT NULL DEFAULT '' CHECK (length(details)<=1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id),
  UNIQUE (call_id,reporter_id)
);
-- @statement
CREATE INDEX IF NOT EXISTS reports_open ON crosswave.reports (created_at) WHERE status='open';
-- @statement
CREATE TABLE IF NOT EXISTS crosswave.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES crosswave.guests(id),
  action text NOT NULL CHECK (action IN ('warn','ban','unban')),
  reason text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- @statement
CREATE OR REPLACE FUNCTION crosswave.find_match(p_guest uuid,p_mode text)
RETURNS TABLE (state text,call_id uuid,peer_id uuid,initiator boolean)
LANGUAGE plpgsql AS $$
DECLARE active_call crosswave.calls%ROWTYPE;
        candidate_id uuid;
        created_call_id uuid;
BEGIN
  -- Serialize matching/leave for v1; replace with sharded locks before high traffic.
  PERFORM pg_advisory_xact_lock(73194012);
  IF p_mode NOT IN ('video','text') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crosswave.guests g WHERE g.id=p_guest
    AND g.expires_at>now() AND (g.banned_until IS NULL OR g.banned_until<=now())
  ) THEN
    RAISE EXCEPTION 'guest not eligible' USING ERRCODE='28000';
  END IF;
  -- Close calls whose peer has stopped checking in.
  UPDATE crosswave.calls c SET ended_at=now()
  WHERE c.ended_at IS NULL AND (
    EXISTS (SELECT 1 FROM crosswave.guests g WHERE g.id=c.guest_a AND g.last_seen_at < now()-interval '90 seconds')
    OR EXISTS (SELECT 1 FROM crosswave.guests g WHERE g.id=c.guest_b AND g.last_seen_at < now()-interval '90 seconds')
  );
  SELECT * INTO active_call FROM crosswave.calls c
    WHERE c.ended_at IS NULL AND (c.guest_a=p_guest OR c.guest_b=p_guest)
    ORDER BY c.started_at DESC LIMIT 1;
  IF FOUND THEN
    DELETE FROM crosswave.waiting_queue WHERE guest_id=p_guest;
    RETURN QUERY SELECT 'matched'::text,active_call.id,
      CASE WHEN active_call.guest_a=p_guest THEN active_call.guest_b ELSE active_call.guest_a END,
      active_call.guest_a=p_guest;
    RETURN;
  END IF;
  DELETE FROM crosswave.waiting_queue WHERE guest_id=p_guest;
  SELECT q.guest_id INTO candidate_id FROM crosswave.waiting_queue q
    JOIN crosswave.guests g ON g.id=q.guest_id
    WHERE q.guest_id<>p_guest AND q.mode=p_mode
      AND q.last_seen_at>now()-interval '35 seconds'
      AND g.expires_at>now()
      AND (g.banned_until IS NULL OR g.banned_until<=now())
      AND NOT EXISTS (
        SELECT 1 FROM crosswave.calls c WHERE c.ended_at IS NULL
        AND (c.guest_a=q.guest_id OR c.guest_b=q.guest_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM crosswave.blocks b
        WHERE (b.blocker_id=p_guest AND b.blocked_id=q.guest_id)
           OR (b.blocker_id=q.guest_id AND b.blocked_id=p_guest)
      )
    ORDER BY q.joined_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED;
  IF candidate_id IS NULL THEN
    INSERT INTO crosswave.waiting_queue(guest_id,mode)
      VALUES(p_guest,p_mode)
      ON CONFLICT (guest_id) DO UPDATE
        SET mode=EXCLUDED.mode,last_seen_at=now(),joined_at=now();
    RETURN QUERY SELECT 'waiting'::text,NULL::uuid,NULL::uuid,false;
    RETURN;
  END IF;
  DELETE FROM crosswave.waiting_queue WHERE guest_id=candidate_id;
  INSERT INTO crosswave.calls(guest_a,guest_b,mode)
    VALUES(candidate_id,p_guest,p_mode) RETURNING id INTO created_call_id;
  RETURN QUERY SELECT 'matched'::text,created_call_id,candidate_id,false;
END $$;
-- @statement
CREATE OR REPLACE FUNCTION crosswave.leave(p_guest uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE ended boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(73194012);
  DELETE FROM crosswave.waiting_queue WHERE guest_id=p_guest;
  UPDATE crosswave.calls
    SET ended_at=now(),ended_by=p_guest
    WHERE ended_at IS NULL AND (guest_a=p_guest OR guest_b=p_guest);
  GET DIAGNOSTICS ended = ROW_COUNT;
  RETURN ended;
END $$;
