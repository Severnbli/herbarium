import { plural } from '../plural.ts';

const p = (count: number, forms: Parameters<typeof plural>[2]) => plural('en', count, forms);

/** English messages. The shape of this object is the contract every locale must fulfil. */
export const en = {
	appName: 'Herbarium',
	nav: {
		label: 'Main',
		home: 'Home',
		members: 'Members',
		account: 'Account',
		signOut: 'Sign out'
	},
	field: {
		username: 'Username',
		displayName: 'Your name',
		password: 'Password',
		currentPassword: 'Current password',
		newPassword: 'New password',
		confirmPassword: 'Repeat the password'
	},
	hint: {
		username: '3–32 characters: lowercase letters, digits, dots, dashes and underscores.',
		displayName: 'How the others will see you.',
		password: (min: number) =>
			`At least ${min} characters. A few unrelated words make a strong password you can remember.`
	},
	error: {
		form: 'Please check the highlighted fields.',
		username:
			'Use 3–32 lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.',
		displayName: 'Enter a name of up to 64 characters.',
		password: (min: number, max: number) => `The password must be ${min}–${max} characters long.`,
		passwordMismatch: 'The passwords do not match.',
		usernameTaken: 'This username is already taken.',
		wrongPassword: 'The password is not correct.',
		rateLimited: (minutes: number) =>
			`Too many attempts. Try again in ${p(minutes, { one: '# minute', other: '# minutes' })}.`
	},
	setup: {
		title: 'Set up Herbarium',
		intro:
			'Create the first account. It becomes the owner of this herbarium and can invite everyone else.',
		code: 'Setup code',
		codeHint: 'It is in the file setup-code in the data directory. With Docker Compose:',
		codeCommand: 'docker compose exec herbarium cat /data/setup-code',
		wrongCode: 'The setup code is not correct.',
		keyTitle: 'Keep the master key safe',
		keyWarning:
			'Everything in Herbarium is encrypted with the master key configured on the server. If that key is lost, nobody – not even you – can recover the data. Store a copy somewhere safe, away from this server and its backups.',
		keyAck: 'I have stored a copy of the master key in a safe place.',
		keyAckRequired: 'Please confirm that the master key is stored safely.',
		submit: 'Create the owner account'
	},
	login: {
		title: 'Sign in',
		submit: 'Sign in',
		invalid: 'The username or password is not correct.'
	},
	verify: {
		title: 'Two-step verification',
		intro: 'Enter the 6-digit code from your authenticator app.',
		code: 'Code',
		submit: 'Verify',
		invalid: 'The code is not correct.',
		recoveryTitle: 'No access to your device?',
		recoveryIntro: 'Use one of your recovery codes instead. Each code works once.',
		recoveryCode: 'Recovery code',
		recoverySubmit: 'Use the recovery code',
		recoveryInvalid: 'The recovery code is not correct or was already used.',
		restart: 'Start over'
	},
	invite: {
		title: 'Join Herbarium',
		intro: 'You have been invited to a shared herbarium. Choose how you will sign in.',
		submit: 'Create my account',
		invalidTitle: 'This invite cannot be used',
		invalid:
			'The link has expired, was already used or was revoked. Ask an owner for a new invite.',
		toLogin: 'Go to sign-in'
	},
	home: {
		greeting: (name: string) => `Welcome, ${name}.`,
		intro: 'Moments, plans and occasions will grow here soon.'
	},
	members: {
		title: 'Members',
		you: 'you',
		role: { owner: 'Owner', member: 'Member' },
		deactivated: 'Deactivated',
		actionsFor: (name: string) => `Actions for ${name}`,
		deactivate: 'Deactivate',
		reactivate: 'Reactivate',
		makeOwner: 'Make owner',
		makeMember: 'Make member',
		lastOwner: 'At least one active owner must remain.',
		cannotDeactivateSelf: 'You cannot deactivate your own account.',
		notFound: 'This member or invite no longer exists.',
		invitesTitle: 'Invites',
		invitesIntro: 'An invite link works once and expires after 7 days.',
		inviteLabel: 'Who is it for? (optional, only owners see this)',
		createInvite: 'Create an invite link',
		inviteCreated: 'Send this link to the person you are inviting. It is shown only once.',
		inviteLink: 'Invite link',
		noInvites: 'No invites yet.',
		inviteStatus: { pending: 'Waiting', used: 'Used', revoked: 'Revoked', expired: 'Expired' },
		inviteMeta: (by: string, when: string) => `Created by ${by}, ${when}`,
		inviteExpires: (when: string) => `Expires ${when}`,
		revoke: 'Revoke'
	},
	account: {
		title: 'Account',
		passwordTitle: 'Password',
		changePassword: 'Change the password',
		passwordChanged: 'The password was changed. All other devices were signed out.',
		sessionsTitle: 'Signed-in devices',
		thisDevice: 'This device',
		unknownDevice: 'Unknown device',
		lastActive: (when: string) => `Last active ${when}`,
		signOutDevice: 'Sign out',
		signOutEverywhere: 'Sign out everywhere',
		signOutEverywhereHint: 'Ends every session, including this one.',
		totpTitle: 'Two-step verification',
		totpOff: 'Off. With an authenticator app, signing in also asks for a one-time code.',
		totpOn: 'On. Signing in asks for a code from your authenticator app.',
		totpStart: 'Set up',
		totpScan:
			'Scan this QR code with your authenticator app or enter the key by hand, then type the 6-digit code the app shows.',
		totpQrLabel: 'QR code for the authenticator app',
		totpKey: 'Key',
		totpConfirm: 'Turn on',
		totpDisable: 'Turn off',
		totpEnabled: 'Two-step verification is now on.',
		totpDisabled: 'Two-step verification is now off.',
		recoveryTitle: 'Recovery codes',
		recoveryShown:
			'Store these codes somewhere safe. Each one lets you sign in once if you lose your device. They are shown only now.',
		recoveryLeft: (count: number) =>
			p(count, { one: '# recovery code left.', other: '# recovery codes left.' }),
		recoveryRegenerate: 'Create new recovery codes',
		confirmPassword: 'Confirm with your password'
	},
	errorPage: {
		notFound: 'Page not found',
		forbidden: 'You do not have access to this page',
		generic: 'Something went wrong',
		reference: (id: string) => `Reference for the logs: ${id}`,
		home: 'Back to the start'
	}
};

/** Every locale implements exactly this shape. */
export type Messages = typeof en;
