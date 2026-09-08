-- Assertion helpers. Sourced by every test file via \i.
-- Each assertion raises errcode 'TFAIL' on failure; the runner treats that as a failure.

create or replace function test_assert(cond boolean, msg text) returns void
language plpgsql
as $$
begin
  if cond is distinct from true then
    raise exception using errcode = 'TFAIL', message = msg;
  end if;
end $$;