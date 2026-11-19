import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createServer as createTlsServer,
	getCACertificates,
	setDefaultCACertificates
} from 'node:tls';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SmtpConfig } from '../config.ts';
import { createReminderSender } from './smtp.ts';

let credentials: { key: Buffer; cert: Buffer };
const defaultCertificates = getCACertificates('default');

beforeAll(() => {
	const dir = mkdtempSync(join(tmpdir(), 'herbarium-smtp-'));
	try {
		const key = join(dir, 'key.pem');
		const cert = join(dir, 'cert.pem');
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-noenc',
				'-keyout',
				key,
				'-out',
				cert,
				'-days',
				'1',
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost'
			],
			{ stdio: 'ignore' }
		);
		credentials = { key: readFileSync(key), cert: readFileSync(cert) };
		setDefaultCACertificates([...defaultCertificates, credentials.cert.toString()]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

afterAll(() => setDefaultCACertificates(defaultCertificates));

const message = {
	to: 'recipient@example.test',
	locale: 'en',
	title: 'Synthetic occasion',
	date: 'March 8, 2026',
	eventId: 'a'.repeat(22)
} as const;

async function relay(encrypted: boolean, reply: string | null, startTlsReply = '502 Unavailable') {
	const commands: string[] = [];
	const messages: string[] = [];
	const clients = new Set<Socket>();
	const connect = (socket: Socket) => {
		clients.add(socket);
		socket.once('close', () => clients.delete(socket));
		socket.on('error', () => socket.destroy());
		socket.setEncoding('utf8');
		socket.write('220 localhost SMTP ready\r\n');
		let buffer = '';
		let data: string[] | null = null;
		socket.on('data', (chunk: string) => {
			buffer += chunk;
			for (let end; (end = buffer.indexOf('\r\n')) !== -1;) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				if (data) {
					if (line === '.') {
						messages.push(data.join('\r\n'));
						data = null;
						if (reply) socket.write(reply + '\r\n');
						else socket.end();
					} else data.push(line);
					continue;
				}
				const command = line.split(' ', 1)[0]!;
				commands.push(command);
				if (command === 'EHLO') socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
				else if (command === 'AUTH') socket.write('235 Authenticated\r\n');
				else if (command === 'DATA') {
					data = [];
					socket.write('354 End with a dot\r\n');
				} else if (command === 'STARTTLS') socket.write(startTlsReply + '\r\n');
				else if (command === 'QUIT') socket.end('221 Bye\r\n');
				else socket.write('250 OK\r\n');
			}
		});
	};
	const server = encrypted ? createTlsServer(credentials, connect) : createServer(connect);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const config: SmtpConfig = {
		host: 'localhost',
		port: (server.address() as AddressInfo).port,
		from: 'herbarium@example.test',
		tls: encrypted ? 'implicit' : 'starttls',
		auth: { user: 'test', pass: 'synthetic password' }
	};
	return {
		send: createReminderSender(config, new URL('https://herbarium.example.test')),
		commands,
		messages,
		async close() {
			for (const socket of clients) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	};
}

it('authenticates over certificate-verified TLS and sends only the title, date and event link', async () => {
	const smtp = await relay(true, '250 Queued');
	try {
		expect(await smtp.send(message)).toBe('sent');
		expect(smtp.commands).toContain('AUTH');
		const raw = smtp.messages[0]!;
		const boundary = raw.indexOf('\r\n\r\n');
		const headers = raw.slice(0, boundary);
		const body = raw.slice(boundary + 4);
		expect(headers).toContain('Subject: Calendar reminder');
		// Nodemailer quotes a line exceeding 76 characters when using quoted-printable.
		expect(body.replace(/=\r\n/g, '').trim()).toBe(
			'Synthetic occasion\r\n\r\nMarch 8, 2026\r\n\r\n' +
				`https://herbarium.example.test/events/${message.eventId}`
		);
	} finally {
		await smtp.close();
	}
});

it('refuses to authenticate or deliver when the relay cannot upgrade to STARTTLS', async () => {
	const smtp = await relay(false, '250 Queued');
	try {
		expect(await smtp.send(message)).toBe('failed');
		expect(smtp.commands).toEqual(['EHLO', 'STARTTLS']);
		expect(smtp.messages).toHaveLength(0);
	} finally {
		await smtp.close();
	}
});

it('retries when the relay temporarily refuses STARTTLS before authentication', async () => {
	const smtp = await relay(false, null, '454 TLS temporarily unavailable');
	try {
		expect(await smtp.send(message)).toBe('retry');
		expect(smtp.commands).toEqual(['EHLO', 'STARTTLS']);
		expect(smtp.messages).toHaveLength(0);
	} finally {
		await smtp.close();
	}
});

it.each([
	['451 Try again later', 'retry'],
	['550 Rejected', 'failed'],
	[null, 'uncertain']
] as const)('classifies the final SMTP reply %s as %s', async (reply, result) => {
	const smtp = await relay(true, reply);
	try {
		expect(await smtp.send(message)).toBe(result);
		expect(smtp.messages).toHaveLength(1);
	} finally {
		await smtp.close();
	}
});
