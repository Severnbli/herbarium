import nodemailer from 'nodemailer';
import { messages } from '#lib/i18n/index.ts';
import type { SmtpConfig } from '../config.ts';
import type { DeliveryResult, ReminderMail } from './scheduler.ts';

function smtpFailure(cause: unknown): DeliveryResult {
	if (!(cause instanceof Error)) return 'uncertain';
	const error = cause as Error & {
		code?: string;
		command?: string;
		originalCode?: string;
		responseCode?: number;
		timeoutType?: string;
	};
	if (
		error.code === 'EDNS' ||
		(error.code === 'ESOCKET' && error.originalCode === 'ECONNREFUSED') ||
		(error.code === 'ETIMEDOUT' &&
			['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(error.timeoutType ?? ''))
	)
		return 'retry';
	// Only explicit SMTP rejections establish that DATA was not accepted. A socket error
	// can report CONN even when it occurred after the server received the message.
	if (
		['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error.code ?? '') ||
		(error.code === 'ETLS' && error.command === 'STARTTLS')
	) {
		const status = error.responseCode ?? 0;
		if (status >= 400 && status < 500) return 'retry';
		if (status >= 500 && status < 600) return 'failed';
	}
	if (error.code === 'ETLS' || error.code === 'ENOAUTH') return 'failed';
	return 'uncertain';
}

export function createReminderSender(config: SmtpConfig, origin: URL) {
	const transport = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.tls === 'implicit',
		requireTLS: config.tls === 'starttls',
		tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
		auth: config.auth,
		forceAuth: true,
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 15_000,
		disableFileAccess: true,
		disableUrlAccess: true
	});
	return async (mail: ReminderMail): Promise<DeliveryResult> => {
		const link = new URL(`/events/${mail.eventId}`, origin);
		try {
			await transport.sendMail({
				from: { address: config.from, name: '' },
				to: { address: mail.to, name: '' },
				subject: messages(mail.locale).reminder.subject,
				text: [mail.title, mail.date, link.href].join('\n\n'),
				signal: AbortSignal.timeout(30_000)
			});
			return 'sent';
		} catch (cause) {
			return smtpFailure(cause);
		}
	};
}
