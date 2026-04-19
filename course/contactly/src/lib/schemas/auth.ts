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

/**
 * Sign-in with password.
 *
 * Note we do NOT re-apply `passwordSchema` here. That schema describes
 * the rules for *creating* a new password (length, character classes).
 * On sign-in we only need to confirm the user typed *something* — the
 * actual correctness check is "does this match the stored hash" and
 * Supabase owns that. Re-running the strength check would (a) leak
 * the policy to attackers ("your input failed the policy" tells them
 * what shape passwords have to be) and (b) lock out users whose
 * passwords pre-date a future policy bump.
 */
export const signInWithPasswordSchema = z.object({
	email: emailSchema,
	password: z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' })
});

export type SignInWithPasswordInput = z.infer<typeof signInWithPasswordSchema>;

/**
 * Sign-in with magic link. Just an email — Supabase emails the user a
 * one-time token they click to authenticate. The link target hits our
 * `/auth/confirm` endpoint exactly like the sign-up confirmation does
 * (single OTP-verification path → one place to maintain).
 */
export const signInWithMagicLinkSchema = z.object({
	email: emailSchema
});

export type SignInWithMagicLinkInput = z.infer<typeof signInWithMagicLinkSchema>;

/**
 * Update profile (Lesson 3.6). Right now only `full_name` is editable;
 * email/password live on `auth.users` and need their own dedicated
 * actions because Supabase requires confirmation flows for both.
 */
export const updateProfileSchema = z.object({
	fullName: fullNameSchema
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Change email. Supabase sends a confirmation link to the NEW address;
 * the swap doesn't take effect until the user clicks it.
 */
export const changeEmailSchema = z.object({
	email: emailSchema
});

export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;

/**
 * Change password. We require the new password to clear the same
 * strength bar as a freshly-created one (passwordSchema), and we
 * require a confirm field for the same usability reason as on
 * sign-up: typo defense in the absence of a "show password" toggle.
 *
 * We deliberately DO NOT ask for the current password. Supabase's
 * `auth.updateUser` doesn't take one; the auth fact is "the user
 * holds a valid session right now", which they prove by the cookie
 * already in flight. If a session were stolen, requiring the old
 * password wouldn't help — the attacker has session cookies, and a
 * password input field can be filled with a phishing UI just as
 * easily.
 */
export const changePasswordSchema = z
	.object({
		password: passwordSchema,
		confirmPassword: z.string({ error: 'Please confirm your new password' })
	})
	.refine((data) => data.password === data.confirmPassword, {
		error: 'Passwords must match',
		path: ['confirmPassword']
	});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Forgot-password. Same single-field shape as the magic-link form;
 * the divergence happens server-side (`resetPasswordForEmail` vs
 * `signInWithOtp`).
 */
export const forgotPasswordSchema = z.object({
	email: emailSchema
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Reset-password — the form the user lands on AFTER clicking the
 * recovery email link. Same strength rules as creating a new account.
 */
export const resetPasswordSchema = z
	.object({
		password: passwordSchema,
		confirmPassword: z.string({ error: 'Please confirm your new password' })
	})
	.refine((data) => data.password === data.confirmPassword, {
		error: 'Passwords must match',
		path: ['confirmPassword']
	});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Delete account. We require the user to type the literal string
 * "DELETE" to confirm. UI affordances like a "Are you sure?" modal
 * are great for happy-path users; the typed-confirmation is what
 * stops "I clicked the wrong button on my phone" cases. The literal
 * is locale-independent on purpose — translating the confirmation
 * word breaks the muscle memory that protects against this exact
 * mistake.
 */
export const deleteAccountSchema = z.object({
	confirmation: z
		.string({ error: 'Type DELETE to confirm' })
		.refine((value) => value === 'DELETE', { error: 'Type the word DELETE exactly to confirm' })
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
