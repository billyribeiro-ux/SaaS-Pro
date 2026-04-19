/**
 * Zod schemas for the contact CRUD surface.
 *
 * Mirrors the column-level CHECK constraints we wrote in
 * `20260419000003_organizations_and_contacts.sql`. The DB is the
 * authoritative validator (any client/server/cron code that writes a
 * contact runs through Postgres before it hits storage), but
 * duplicating the rules here means form errors render BEFORE the
 * round-trip and the user sees "phone too short" instead of an opaque
 * 400.
 *
 * Single source of truth pattern: same module is imported by the
 * server action AND the Superforms client adapter, so the rules can
 * never drift between the two layers.
 */
import * as z from 'zod';

const FULL_NAME_MAX = 200;
const COMPANY_MAX = 200;
const JOB_TITLE_MAX = 200;
const NOTES_MAX = 10_000;
const PHONE_MIN = 4;
const PHONE_MAX = 64;

/**
 * Optional-string preprocessor.
 *
 * Form fields submit empty strings (`""`) for "the user left this
 * blank", but the DB column is nullable and we want to store NULL,
 * not the empty string — so anything that trims to empty becomes
 * `undefined` (which Zod treats as "field absent" for `.optional()`).
 *
 * Ordering matters: the preprocessor runs BEFORE any string check,
 * so the rest of the chain sees a clean string or nothing.
 */
function optionalTrimmedString<T extends z.ZodTypeAny>(inner: T) {
	return z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		const trimmed = value.trim();
		return trimmed.length === 0 ? undefined : trimmed;
	}, inner.optional());
}

/**
 * Full name. Required, non-empty after trim, capped at the same 200
 * chars the DB enforces.
 */
export const contactFullNameSchema = z
	.string({ error: 'Full name is required' })
	.transform((value) => value.trim())
	.pipe(
		z
			.string()
			.min(1, { error: 'Full name is required' })
			.max(FULL_NAME_MAX, { error: `Full name must be at most ${FULL_NAME_MAX} characters` })
	);

/**
 * Email is optional on a contact (you might know someone's name and
 * phone number but not their email). When present we still want it
 * to look like an email — `z.email()` enforces RFC-shaped strings.
 */
export const contactEmailSchema = optionalTrimmedString(
	z.email({ error: 'Enter a valid email address' }).max(320, { error: 'Email is too long' })
);

/**
 * Phone. Optional, loose format (international + extensions + parens
 * are all real-world inputs we don't want to reject). We enforce
 * length only — the DB CHECK does the same. Country-aware
 * normalization is a separate problem we'd solve with libphonenumber
 * at write time, not in the schema.
 */
export const contactPhoneSchema = optionalTrimmedString(
	z
		.string()
		.min(PHONE_MIN, { error: `Phone must be at least ${PHONE_MIN} characters` })
		.max(PHONE_MAX, { error: `Phone must be at most ${PHONE_MAX} characters` })
);

export const contactCompanySchema = optionalTrimmedString(
	z.string().max(COMPANY_MAX, { error: `Company must be at most ${COMPANY_MAX} characters` })
);

export const contactJobTitleSchema = optionalTrimmedString(
	z.string().max(JOB_TITLE_MAX, { error: `Job title must be at most ${JOB_TITLE_MAX} characters` })
);

export const contactNotesSchema = optionalTrimmedString(
	z.string().max(NOTES_MAX, { error: `Notes must be at most ${NOTES_MAX} characters` })
);

/**
 * The full create/update form. Update reuses the same shape — we
 * never partial-update a contact form (the user always sees and
 * re-submits every field), so a single schema is correct for both
 * verbs. If we ever add a "quick edit" inline UI that PATCHes one
 * field, that gets its own schema then.
 */
export const contactWriteSchema = z.object({
	full_name: contactFullNameSchema,
	email: contactEmailSchema,
	phone: contactPhoneSchema,
	company: contactCompanySchema,
	job_title: contactJobTitleSchema,
	notes: contactNotesSchema
});

export type ContactWriteInput = z.infer<typeof contactWriteSchema>;
