import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { addUser } from '#lib/server/auth/fixtures.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { albumMemory, event, importReceipt, memory } from '#lib/server/db/schema.ts';
import { createTestDb } from '#lib/server/testing.ts';
import { offerCoordinates } from './coordinates.ts';
import { importGroups, organizeImport, requireImport, startImport } from './imports.ts';

it('confirms the displayed group once and rolls back if location consent belongs to another session', async () => {
	const t = createTestDb();
	try {
		const actor = await addUser(t.db, 'importer');
		const outsider = await addUser(t.db, 'outsider');
		const id = startImport(t.db, actor);
		expect(startImport(t.db, actor)).toBe(id);
		expect(() => requireImport(t.db, id, outsider)).toThrow('missing');
		const date = '2024-02-29';
		const memoryId = generateId();
		t.db
			.insert(memory)
			.values({
				id: memoryId,
				originalName: 'garden.jpg',
				altText: '',
				caption: '',
				captureDate: date,
				sortDate: date,
				createdBy: actor
			})
			.run();
		t.db
			.insert(importReceipt)
			.values({ importId: id, fingerprint: 'receipt', memoryId, duplicate: false })
			.run();

		const key = randomBytes(32);
		const sessionId = 'session-for-testing';
		const gpsToken = offerCoordinates(key, sessionId, memoryId, null, { lat: 53.9, lon: 27.5 });
		const input = {
			date,
			revision: importGroups(t.db, id)[0]!.revision,
			title: 'Leap day',
			album: 'on',
			moment: 'on',
			acceptGps: 'on',
			gpsId: memoryId,
			gpsToken
		} as const;
		expect(() =>
			organizeImport(t.db, id, actor, { ...input, revision: 'stale' }, { key, sessionId })
		).toThrow('missing');
		expect(() =>
			organizeImport(t.db, id, actor, input, { key, sessionId: 'other-session' })
		).toThrow('coordinates');
		expect(t.db.select().from(event).all()).toEqual([]);
		expect(t.db.select().from(albumMemory).all()).toEqual([]);
		expect(importGroups(t.db, id)).toHaveLength(1);

		const created = organizeImport(t.db, id, actor, input, { key, sessionId });
		expect(t.db.select().from(event).get()).toMatchObject({
			id: created.eventId,
			startDate: date,
			lat: 53.9,
			lon: 27.5
		});
		expect(t.db.select().from(albumMemory).get()).toMatchObject({
			albumId: created.albumId,
			memoryId
		});
		expect(t.db.select().from(memory).where(eq(memory.id, memoryId)).get()).toMatchObject({
			eventId: created.eventId
		});
		expect(importGroups(t.db, id)).toEqual([]);
		expect(() => organizeImport(t.db, id, actor, input, { key, sessionId })).toThrow('missing');
	} finally {
		t.cleanup();
	}
});
