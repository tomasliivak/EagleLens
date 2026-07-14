-- Advisor hardening: pin search_path on the RLS helper, and make the
-- signup trigger uncallable via the REST RPC surface.
alter function public.is_bc_email() set search_path = '';
revoke execute on function public.enforce_bc_email() from public, anon, authenticated;
