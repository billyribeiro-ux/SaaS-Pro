-- Promote a user to admin. The application also auto-promotes on every login
-- when the email matches ADMIN_EMAILS (see src/hooks.server.ts), so this file
-- exists for one-shot bootstrapping or out-of-band corrections.
select public.promote_user_to_admin('willribeirodrums@icloud.com');
select id, email, role from public.profiles
  where lower(email) = lower('willribeirodrums@icloud.com');
