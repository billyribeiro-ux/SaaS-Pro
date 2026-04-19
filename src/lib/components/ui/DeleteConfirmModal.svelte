<script lang="ts">
	import Modal from '$components/ui/Modal.svelte';
	import Button from '$components/ui/Button.svelte';

	type Props = {
		open: boolean;
		contactName: string;
		contactId: string;
		onClose: () => void;
	};

	let { open = $bindable(), contactName, contactId, onClose }: Props = $props();
</script>

<Modal bind:open={open} {onClose} title="Delete contact" class="max-w-md">
	<p class="text-sm text-slate-600 dark:text-slate-300">
		Are you sure you want to delete <strong class="text-slate-900 dark:text-white">{contactName}</strong>?
		This action cannot be undone.
	</p>

	{#snippet footer()}
		<Button type="button" variant="outline" size="sm" onclick={onClose}>Cancel</Button>
		<form method="POST" action="?/deleteContact">
			<input type="hidden" name="id" value={contactId} />
			<Button type="submit" variant="danger" size="sm">Delete</Button>
		</form>
	{/snippet}
</Modal>
