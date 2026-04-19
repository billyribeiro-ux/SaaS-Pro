export function formatPrice(
	amountInCents: number | null,
	currency: string,
	locale = 'en-US'
): string {
	if (amountInCents === null || amountInCents === undefined) return '—';
	const formatter = new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: currency.toUpperCase(),
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});
	return formatter.format(amountInCents / 100);
}

export function formatDate(iso: string | null, locale = 'en-US'): string {
	if (!iso) return '—';
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(new Date(iso));
}

export function formatDuration(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
