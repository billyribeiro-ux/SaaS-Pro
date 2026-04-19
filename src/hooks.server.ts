import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createRequestSupabaseClient, supabaseAdmin } from '$server/supabase';
import { getAdminEmails } from '$server/admin';

const supabaseHandle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createRequestSupabaseClient(event);

	// Validates the JWT with Supabase's auth server on every call.
	// Cached for the lifetime of this request to avoid repeat round-trips.
	event.locals.getUser = async () => {
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) return null;
		return user;
	};

	const user = await event.locals.getUser();
	event.locals.user = user;

	if (user) {
		// We already validated via getUser(); session is only used to read tokens
		// and expose the refresh cycle to the client loader.
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		event.locals.session = session;

		// Application-side admin allowlist. Supabase Cloud forbids ALTER DATABASE
		// SET, so we keep the source of truth in env (`ADMIN_EMAILS`) and reconcile
		// `profiles.role` here on first auth'd request after a deploy.
		// Cheap: one `select role` keyed on PK; only writes when reconciliation needed.
		await reconcileAdminRole(user.id, user.email ?? null);
	} else {
		event.locals.session = null;
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

// Reconciles `profiles.role` against the env allowlist. Idempotent: it only
// writes when the role would actually change. Failures are swallowed so a
// transient DB hiccup never blocks an authenticated request — the next request
// will reconcile again.
async function reconcileAdminRole(userId: string, email: string | null): Promise<void> {
	if (!email) return;
	const allowlist = getAdminEmails();
	if (allowlist.length === 0) return;
	const shouldBeAdmin = allowlist.includes(email.toLowerCase());

	try {
		const { data, error: readError } = await supabaseAdmin
			.from('profiles')
			.select('role')
			.eq('id', userId)
			.maybeSingle();
		if (readError || !data) return;
		const currentlyAdmin = data.role === 'admin';
		if (shouldBeAdmin && !currentlyAdmin) {
			await supabaseAdmin.from('profiles').update({ role: 'admin' }).eq('id', userId);
		}
		// We intentionally never auto-demote: env-removed admins keep their role
		// until an operator explicitly demotes via /admin/users. That makes
		// `ADMIN_EMAILS` a one-way bootstrap signal, not a kill-switch.
	} catch (err) {
		console.warn('[hooks] reconcileAdminRole failed:', err);
	}
}

export const handle = sequence(supabaseHandle);

export const handleError: HandleServerError = ({ error, status, message }) => {
	if (status !== 404) {
		console.error('[server error]', { status, message, error });
	}
	return { message: message ?? 'Internal error' };
};
