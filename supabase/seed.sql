-- Seed data for local development.
-- Real product/price data is synced from Stripe via webhooks at runtime,
-- so this file only contains fixtures useful for bringing up a fresh DB.

-- Example: pre-insert a placeholder product row so UIs don't show empty states
-- before the Stripe webhook runs. Overwritten by the first product.updated event.
insert into public.products (id, name, description, active, metadata)
values
	('prod_seed_saas_pro', 'SaaS-Pro (seed)', 'Placeholder product — replaced by Stripe sync.', false, '{}'::jsonb)
on conflict (id) do nothing;
