import * as m from './paraglide/messages.js';
import type { Locale } from './index.ts';

/** Explicit locales keep concurrent server requests and hydration isolated. */
export function messages(locale: Locale) {
	return {
		appName: m.appName({}, { locale }),
		design: {
			theme: m.design_theme({}, { locale }),
			system: m.design_system({}, { locale }),
			light: m.design_light({}, { locale }),
			dark: m.design_dark({}, { locale }),
			skip: m.design_skip({}, { locale }),
			precision: m.design_precision({}, { locale }),
			day: m.design_day({}, { locale }),
			month: m.design_month({}, { locale }),
			year: m.design_year({}, { locale }),
			close: m.design_close({}, { locale })
		},
		nav: {
			label: m.nav_label({}, { locale }),
			home: m.nav_home({}, { locale }),
			members: m.nav_members({}, { locale }),
			account: m.nav_account({}, { locale }),
			signOut: m.nav_signOut({}, { locale })
		},
		field: {
			username: m.field_username({}, { locale }),
			displayName: m.field_displayName({}, { locale }),
			password: m.field_password({}, { locale }),
			currentPassword: m.field_currentPassword({}, { locale }),
			newPassword: m.field_newPassword({}, { locale }),
			confirmPassword: m.field_confirmPassword({}, { locale })
		},
		hint: {
			username: m.hint_username({}, { locale }),
			displayName: m.hint_displayName({}, { locale }),
			password: (min: number) => m.hint_password({ min }, { locale })
		},
		error: {
			form: m.error_form({}, { locale }),
			username: m.error_username({}, { locale }),
			displayName: m.error_displayName({}, { locale }),
			password: (min: number, max: number) => m.error_password({ min, max }, { locale }),
			passwordMismatch: m.error_passwordMismatch({}, { locale }),
			usernameTaken: m.error_usernameTaken({}, { locale }),
			wrongPassword: m.error_wrongPassword({}, { locale }),
			rateLimited: (minutes: number) => m.error_rateLimited({ minutes }, { locale })
		},
		setup: {
			title: m.setup_title({}, { locale }),
			intro: m.setup_intro({}, { locale }),
			code: m.setup_code({}, { locale }),
			codeHint: m.setup_codeHint({}, { locale }),
			codeCommand: m.setup_codeCommand({}, { locale }),
			wrongCode: m.setup_wrongCode({}, { locale }),
			keyTitle: m.setup_keyTitle({}, { locale }),
			keyWarning: m.setup_keyWarning({}, { locale }),
			keyAck: m.setup_keyAck({}, { locale }),
			keyAckRequired: m.setup_keyAckRequired({}, { locale }),
			submit: m.setup_submit({}, { locale })
		},
		login: {
			title: m.login_title({}, { locale }),
			submit: m.login_submit({}, { locale }),
			invalid: m.login_invalid({}, { locale })
		},
		verify: {
			title: m.verify_title({}, { locale }),
			intro: m.verify_intro({}, { locale }),
			code: m.verify_code({}, { locale }),
			submit: m.verify_submit({}, { locale }),
			invalid: m.verify_invalid({}, { locale }),
			recoveryTitle: m.verify_recoveryTitle({}, { locale }),
			recoveryIntro: m.verify_recoveryIntro({}, { locale }),
			recoveryCode: m.verify_recoveryCode({}, { locale }),
			recoverySubmit: m.verify_recoverySubmit({}, { locale }),
			recoveryInvalid: m.verify_recoveryInvalid({}, { locale }),
			restart: m.verify_restart({}, { locale })
		},
		invite: {
			title: m.invite_title({}, { locale }),
			intro: m.invite_intro({}, { locale }),
			submit: m.invite_submit({}, { locale }),
			invalidTitle: m.invite_invalidTitle({}, { locale }),
			invalid: m.invite_invalid({}, { locale }),
			toLogin: m.invite_toLogin({}, { locale })
		},
		home: {
			greeting: (name: string) => m.home_greeting({ name }, { locale }),
			intro: m.home_intro({}, { locale })
		},
		members: {
			title: m.members_title({}, { locale }),
			you: m.members_you({}, { locale }),
			role: {
				owner: m.members_role_owner({}, { locale }),
				member: m.members_role_member({}, { locale })
			},
			deactivated: m.members_deactivated({}, { locale }),
			actionsFor: (name: string) => m.members_actionsFor({ name }, { locale }),
			deactivate: m.members_deactivate({}, { locale }),
			reactivate: m.members_reactivate({}, { locale }),
			makeOwner: m.members_makeOwner({}, { locale }),
			makeMember: m.members_makeMember({}, { locale }),
			lastOwner: m.members_lastOwner({}, { locale }),
			cannotDeactivateSelf: m.members_cannotDeactivateSelf({}, { locale }),
			notFound: m.members_notFound({}, { locale }),
			invitesTitle: m.members_invitesTitle({}, { locale }),
			invitesIntro: m.members_invitesIntro({}, { locale }),
			inviteLabel: m.members_inviteLabel({}, { locale }),
			createInvite: m.members_createInvite({}, { locale }),
			inviteCreated: m.members_inviteCreated({}, { locale }),
			inviteLink: m.members_inviteLink({}, { locale }),
			noInvites: m.members_noInvites({}, { locale }),
			inviteStatus: {
				pending: m.members_inviteStatus_pending({}, { locale }),
				used: m.members_inviteStatus_used({}, { locale }),
				revoked: m.members_inviteStatus_revoked({}, { locale }),
				expired: m.members_inviteStatus_expired({}, { locale })
			},
			inviteMeta: (by: string, when: string) => m.members_inviteMeta({ by, when }, { locale }),
			inviteExpires: (when: string) => m.members_inviteExpires({ when }, { locale }),
			revoke: m.members_revoke({}, { locale })
		},
		account: {
			title: m.account_title({}, { locale }),
			passwordTitle: m.account_passwordTitle({}, { locale }),
			changePassword: m.account_changePassword({}, { locale }),
			passwordChanged: m.account_passwordChanged({}, { locale }),
			sessionsTitle: m.account_sessionsTitle({}, { locale }),
			thisDevice: m.account_thisDevice({}, { locale }),
			unknownDevice: m.account_unknownDevice({}, { locale }),
			lastActive: (when: string) => m.account_lastActive({ when }, { locale }),
			signOutDevice: m.account_signOutDevice({}, { locale }),
			signOutEverywhere: m.account_signOutEverywhere({}, { locale }),
			signOutEverywhereHint: m.account_signOutEverywhereHint({}, { locale }),
			totpTitle: m.account_totpTitle({}, { locale }),
			totpOff: m.account_totpOff({}, { locale }),
			totpOn: m.account_totpOn({}, { locale }),
			totpStart: m.account_totpStart({}, { locale }),
			totpScan: m.account_totpScan({}, { locale }),
			totpQrLabel: m.account_totpQrLabel({}, { locale }),
			totpKey: m.account_totpKey({}, { locale }),
			totpConfirm: m.account_totpConfirm({}, { locale }),
			totpDisable: m.account_totpDisable({}, { locale }),
			totpEnabled: m.account_totpEnabled({}, { locale }),
			totpDisabled: m.account_totpDisabled({}, { locale }),
			recoveryTitle: m.account_recoveryTitle({}, { locale }),
			recoveryShown: m.account_recoveryShown({}, { locale }),
			recoveryLeft: (count: number) => m.account_recoveryLeft({ count }, { locale }),
			recoveryRegenerate: m.account_recoveryRegenerate({}, { locale }),
			confirmPassword: m.account_confirmPassword({}, { locale })
		},
		errorPage: {
			notFound: m.errorPage_notFound({}, { locale }),
			forbidden: m.errorPage_forbidden({}, { locale }),
			generic: m.errorPage_generic({}, { locale }),
			reference: (id: string) => m.errorPage_reference({ id }, { locale }),
			home: m.errorPage_home({}, { locale })
		},
		language: {
			be: m.language_be({}, { locale }),
			ru: m.language_ru({}, { locale }),
			en: m.language_en({}, { locale }),
			label: m.language_label({}, { locale }),
			save: m.language_save({}, { locale })
		}
	};
}

export type Messages = ReturnType<typeof messages>;
