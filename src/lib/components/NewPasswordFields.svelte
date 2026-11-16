<script lang="ts">
	import Field from './Field.svelte';
	import { PASSWORD_MAX_LENGTH as MAX, PASSWORD_MIN_LENGTH as MIN } from '#lib/domain/password.ts';
	import type { Messages } from '#lib/i18n/index.ts';

	interface Props {
		m: Messages;
		/** Names of the fields the server rejected. */
		invalid: Set<string>;
		label?: string;
	}

	let { m, invalid, label = m.field.password }: Props = $props();
</script>

<!-- A new password with its confirmation, as used by setup, invites and password changes. -->
<Field
	name="password"
	type="password"
	{label}
	hint={m.hint.password(MIN)}
	error={invalid.has('password') ? m.error.password(MIN, MAX) : null}
	autocomplete="new-password"
	required
	minlength={MIN}
	maxlength={MAX}
/>
<Field
	name="confirmPassword"
	type="password"
	label={m.field.confirmPassword}
	error={invalid.has('confirmPassword') ? m.error.passwordMismatch : null}
	autocomplete="new-password"
	required
	maxlength={MAX}
/>
