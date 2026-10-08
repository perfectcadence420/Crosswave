-- Crosswave 002: index ephemeral rows and define bounded cleanup.
-- IMPORTANT: this migration does not delete any data, enable a schedule,
-- or modify the live matchmaking flow.
-- Cleanup is invoked manually only after a retention policy is approved.
-- @statement
CREATE INDEX IF NOT EXISTS crosswave_queue_seen_idx
  ON crosswave.waiting_queue (last_seen_at);
-- @statement
CREATE INDEX IF NOT EXISTS crosswave_guests_expiry_idx
  ON crosswave.guests (expires_at);
-- @statement
CREATE OR REPLACE FUNCTION crosswave.cleanup_ephemeral(
  max_rows integer DEFAULT 1000,
  keep_signals_for interval DEFAULT interval '24 hours'
)
RETURNS TABLE(deleted_signals bigint, deleted_queue bigint)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, crosswave
AS $$
DECLARE
  signal_count bigint;
  queue_count bigint;
BEGIN
  IF max_rows < 1 OR max_rows > 5000 THEN
    RAISE EXCEPTION 'max_rows must be between 1 and 5000';
  END IF;
  IF keep_signals_for < interval '24 hours' THEN
    RAISE EXCEPTION 'minimum signaling retention is 24 hours';
  END IF;
  -- Preserve calls and guest identities tied to moderation reports.
  -- Text/sdp/candidates older than retention are discarded.
  WITH old_rows AS (
    SELECT id FROM crosswave.signals
    WHERE created_at < now() - keep_signals_for
    ORDER BY created_at LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM crosswave.signals s USING old_rows r WHERE s.id=r.id;
  GET DIAGNOSTICS signal_count = ROW_COUNT;
  -- Queue entries are ephemeral, never moderation evidence.
  WITH old_rows AS (
    SELECT guest_id FROM crosswave.waiting_queue
    WHERE last_seen_at < now() - interval '2 minutes'
    ORDER BY last_seen_at LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM crosswave.waiting_queue q USING old_rows r
    WHERE q.guest_id=r.guest_id;
  GET DIAGNOSTICS queue_count = ROW_COUNT;
  RETURN QUERY SELECT signal_count, queue_count;
END;
$$;
-- @statement
REVOKE ALL ON FUNCTION crosswave.cleanup_ephemeral(integer,interval) FROM PUBLIC;
-- Do NOT schedule it until retention and moderation rules are approved.
