import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createRequestSupabaseClient } from '$server/supabase';

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
	} else {
		event.locals.session = null;
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

export const handle = sequence(supabaseHandle);

export const handleError: HandleServerError = ({ error, status, message }) => {
	if (status !== 404) {
		console.error('[server error]', { status, message, error });
	}
	return { message: message ?? 'Internal error' };
};
