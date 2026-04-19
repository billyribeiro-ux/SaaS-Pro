-- Does the auth user exist? Does the profiles row exist?
select
  u.id          as auth_id,
  u.email       as auth_email,
  u.created_at  as auth_created,
  u.email_confirmed_at,
  p.role        as profile_role
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower('willribeirodrums@icloud.com');
