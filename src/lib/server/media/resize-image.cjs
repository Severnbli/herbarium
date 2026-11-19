/* eslint-disable @typescript-eslint/no-require-imports -- The isolated worker evaluates this code in CommonJS mode. */
const fs = require('node:fs');
const dependencies = process.argv[2];
if (!dependencies) throw new Error('Sharp dependency directory is required');
const sharp = /** @type {typeof import('sharp')} */ (
	require(require('node:path').join(dependencies, 'sharp'))
);
/* eslint-enable @typescript-eslint/no-require-imports */
const width = Number(process.argv[1]);
const orientation = Number(process.argv[3]);

sharp.cache(false);
sharp.concurrency(2);
const image = sharp(fs.readFileSync(0), { limitInputPixels: 40_000_000, failOn: 'warning' });
// HEIC can carry EXIF orientation separately from its container display matrix.
if ([2, 5, 7].includes(orientation)) image.flop();
if (orientation === 4) image.flip();
const angle = { 3: 180, 5: 270, 6: 90, 7: 90, 8: 270 }[orientation];
if (angle) image.rotate(angle);
else if (orientation === 1) image.autoOrient();
image
	.resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
	.flatten({ background: '#ffffff' })
	.jpeg({ quality: 85 })
	.toBuffer()
	.then((bytes) => fs.writeFileSync(1, bytes))
	.catch(() => {
		process.exitCode = 3;
	});
