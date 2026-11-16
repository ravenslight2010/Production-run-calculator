DO $$
DECLARE
  v_first uuid := '73000000-0000-4000-8000-000000000001';
  v_second uuid := '73000000-0000-4000-8000-000000000002';
  v_generation bigint;
BEGIN
  v_generation := v2.claim_worker_lease('station-auto-track-test', v_first, 30);
  IF v_generation <> 1 THEN
    RAISE EXCEPTION 'first worker did not claim generation 1: %', v_generation;
  END IF;

  IF v2.claim_worker_lease('station-auto-track-test', v_second, 30) IS NOT NULL THEN
    RAISE EXCEPTION 'competing worker claimed a live lease';
  END IF;
  IF NOT v2.heartbeat_worker_lease('station-auto-track-test', v_first, 1, 30) THEN
    RAISE EXCEPTION 'current lease owner could not renew its lease';
  END IF;
  IF v2.heartbeat_worker_lease('station-auto-track-test', v_second, 1, 30) THEN
    RAISE EXCEPTION 'non-owner renewed another worker lease';
  END IF;

  UPDATE v2.worker_leases
    SET heartbeat_at = clock_timestamp() - interval '2 seconds',
        expires_at = clock_timestamp() - interval '1 second'
    WHERE lease_name = 'station-auto-track-test';
  v_generation := v2.claim_worker_lease('station-auto-track-test', v_second, 30);
  IF v_generation <> 2 THEN
    RAISE EXCEPTION 'stale lease was not reclaimed with a new generation: %', v_generation;
  END IF;
  IF v2.release_worker_lease('station-auto-track-test', v_first, 1) THEN
    RAISE EXCEPTION 'stale owner released a reclaimed lease';
  END IF;
  IF NOT v2.release_worker_lease('station-auto-track-test', v_second, 2) THEN
    RAISE EXCEPTION 'current owner could not release its lease';
  END IF;
END
$$;
