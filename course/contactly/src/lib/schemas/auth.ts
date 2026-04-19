/**
 * Zod schemas for every auth surface.
 *
 * Single source of truth — both the client form (Superforms `superValidate`)
 * and the server form action import the same schema, so client-side
 * validation and server-side validation are definitionally identical. The
 * server is the authoritative check (the client can be tampered with),
 * but having one schema means we never write the rules twice and never
 * have to remember to update both copies.
 *
 * Password rules MUST match the local Supabase config in
 * `supabase/config.toml`:
 *
 *   minimum_password_length = 12
 *   password_requirements   = "lower_upper_letters_digits"
 *
 * If those config values change, change the `passwordSchema` here at the
 * same time and add a migration note to `course/ARCHITECTURE.md`.
 */
import * as z from 'zod';

const FULL_NAME_MAX = 200;
const PASSWORD_MIN = 12;

/**
 * Email field. Two-stage validation: first ensure something was typed
 * ("Email is required"), then run the format check ("Enter a valid
 * email address"). `z.email()` (top-level, Zod 4 idiom) is preferred
 * over the deprecated `z.string().email()`.
 */
export const emailSchema = z
	.string({ error: 'Email is required' })
	.min(1, { error: 'Email is required' })
	.pipe(z.email({ error: 'Enter a valid email address' }));

/**
 * Password field. Min length matches Supabase's
 * `minimum_password_length`. Composition matches
 * `password_requirements = "lower_upper_letters_digits"`.
 *
 * Each character class gets its own `regex` so the error message tells
 * the user exactly which class is missing — not "password is too weak".
 */
export const passwordSchema = z
	.string({ error: 'Password is required' })
	.min(PASSWORD_MIN, { error: `Password must be at least ${PASSWORD_MIN} characters` })
	.regex(/[a-z]/, { error: 'Password must include a lowercase letter' })
	.regex(/[A-Z]/, { error: 'Password must include an uppercase letter' })
	.regex(/\d/, { error: 'Password must include a number' });

/**
 * Optional full name. Trim whitespace; treat all-whitespace as
 * unspecified (we'd rather store NULL than `'   '`).
 */
export const fullNameSchema = z.preprocess(
	(value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
	z
		.string()
		.trim()
		.min(1, { error: 'Full name must not be blank' })
		.max(FULL_NAME_MAX, { error: `Full name is too long (max ${FULL_NAME_MAX} characters)` })
		.optional()
);

/**
 * Sign-up. Cross-field check: `confirmPassword` must equal `password`.
 * `path: ['confirmPassword']` attaches the error to the confirm field
 * (where the user can fix it) rather than the form root.
 */
export const signUpSchema = z
	.object({
		email: emailSchema,
		password: passwordSchema,
		confirmPassword: z.string({ error: 'Please confirm your password' }),
		fullName: fullNameSchema
	})
	.refine((data) => data.password === data.confirmPassword, {
		error: 'Passwords must match',
		path: ['confirmPassword']
	});

export type SignUpInput = z.infer<typeof signUpSchema>;
