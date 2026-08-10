// Writes the static copies of the brand mark from the geometry in `src/constants/logo.ts`, so that
// module stays the only place a fork edits the artwork. Run `pnpm logo:generate` after any edit
// there; `tools/logo-assets.test.ts` fails the unit suite while a copy is stale.
//
// Loaded through vite because the asset list is TypeScript. Only module evaluation happens here.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** ICONDIR is 6 bytes, then one 16-byte ICONDIRENTRY per image, then the image data. */
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/**
 * Packs PNGs into an .ico, keeping them PNG-compressed. The usual packers re-encode to raw BMP,
 * which costs about 10x the bytes here. Every browser decodes a PNG entry; the Windows shell has
 * since Vista, which is the only reader old enough to care.
 */
function packIco(images) {
  const directory = Buffer.alloc(ICO_HEADER_BYTES + images.length * ICO_ENTRY_BYTES);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // 1 = icon, 2 = cursor
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  for (const [index, image] of images.entries()) {
    const entry = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
    // A zero width or height means 256; nothing here is that large, so the size writes as itself.
    directory.writeUInt8(image.size, entry);
    directory.writeUInt8(image.size, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette size, 0 when the image carries its own
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.contents.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.contents.length;
  }

  return Buffer.concat([directory, ...images.map((image) => image.contents)]);
}

async function generate() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: [{ find: /^@\//, replacement: `${root}/src/` }],
    },
  });

  try {
    const {
      LOGO_ASSETS,
      FAVICON_ICO_PATH,
      FAVICON_ICO_SIZES,
      EMAIL_LOGO_PNG_PATH,
      LOGO_VERSION_PATH,
      computeLogoVersion,
      renderEmailLogoRasterSvg,
      renderFaviconRasterSvg,
      renderLogoVersionModule,
    } = await server.ssrLoadModule("/tools/logo-assets.ts");

    for (const asset of LOGO_ASSETS) {
      await writeFile(path.join(root, asset.path), asset.contents, "utf8");
      process.stdout.write(`${asset.path}\n`);
    }

    // Every email client strips SVG, so the transactional templates need a bitmap. One step, unlike
    // the .ico below: the markup already carries the target size, and sharp rasterizes vector input
    // straight at its intrinsic size, so nothing here downscales.
    await writeFile(
      path.join(root, EMAIL_LOGO_PNG_PATH),
      await sharp(Buffer.from(renderEmailLogoRasterSvg(), "utf8"))
        .png({ compressionLevel: 9, effort: 10 })
        .toBuffer()
    );
    process.stdout.write(`${EMAIL_LOGO_PNG_PATH}\n`);

    // Written here, not per send, so one URL serves every recipient and still changes on a rebrand.
    await writeFile(
      path.join(root, LOGO_VERSION_PATH),
      renderLogoVersionModule({ version: computeLogoVersion() }),
      "utf8"
    );
    process.stdout.write(`${LOGO_VERSION_PATH}\n`);

    // Safari only reads an SVG favicon from version 27 on, so the .ico stays the fallback every
    // browser understands.
    //
    // Two steps on purpose: sharp shrinks vector input by rasterizing it straight at the target
    // size, so `sharp(svg).resize(16, 16)` never supersamples. Rasterize the master bitmap first,
    // then every entry downscales from those pixels.
    //
    // The palette is what takes the file from 15 KB to 1.3 KB, and 128 is the widest one in that
    // tier — sharp jumps to 4.4 KB above it. A fork whose artwork bands at 48px raises this.
    const master = await sharp(Buffer.from(renderFaviconRasterSvg(), "utf8")).png().toBuffer();
    const entries = await Promise.all(
      FAVICON_ICO_SIZES.map(async (size) => ({
        size,
        contents: await sharp(master)
          .resize(size, size)
          .png({ compressionLevel: 9, effort: 10, palette: true, colors: 128 })
          .toBuffer(),
      }))
    );

    await writeFile(path.join(root, FAVICON_ICO_PATH), packIco(entries));
    process.stdout.write(`${FAVICON_ICO_PATH}\n`);
  } finally {
    await server.close();
  }
}

try {
  await generate();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
