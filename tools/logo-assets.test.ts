import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SITE_LOGO } from "@/constants/logo";

import {
  EMAIL_LOGO_PNG_PATH,
  FAVICON_ICO_PATH,
  FAVICON_ICO_SIZES,
  LOGO_ASSETS,
  LOGO_VERSION_PATH,
  computeLogoVersion,
  renderFaviconRasterSvg,
  renderLogoVersionModule,
} from "./logo-assets";

/** ICO directory: a 6-byte header, then one 16-byte entry per image, width and height first. */
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR is the first chunk: an 8-byte signature, a 4-byte length, the 4-byte type, then the size. */
const PNG_IHDR_WIDTH_OFFSET = 16;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("logo assets", () => {
  it.each(LOGO_ASSETS.map((asset) => asset.path))(
    "%s matches the geometry in src/constants/logo.ts",
    async (assetPath) => {
      const asset = LOGO_ASSETS.find((candidate) => candidate.path === assetPath);
      const onDisk = await readFile(path.join(root, assetPath), "utf8");

      // The file is generated; a mismatch means someone edited the artwork without regenerating.
      expect(onDisk, `${assetPath} is stale — run \`pnpm logo:generate\``).toBe(asset?.contents);
    }
  );

  // A rectangle would letterbox differently than `src/app/icon.svg` does, so the mark would sit at
  // a different place in the .ico than in the .svg and shift as the browser picks one or the other.
  it("rasterizes the .ico entries from a square", () => {
    const [, width, height] = /width="(\d+)" height="(\d+)"/.exec(renderFaviconRasterSvg()) ?? [];

    expect(Number(width)).toBeGreaterThan(0);
    expect(width).toBe(height);
  });

  // Structure only, never the bytes: libvips renders the same SVG differently across sharp
  // versions, so a hash here would fail a fork the day it bumps the dependency.
  it(`${FAVICON_ICO_PATH} packs every declared size`, async () => {
    const ico = await readFile(path.join(root, FAVICON_ICO_PATH));

    expect(ico.readUInt16LE(0), "not an ICO file").toBe(0);
    expect(ico.readUInt16LE(2), "not an ICO file").toBe(1);
    expect(ico.readUInt16LE(4)).toBe(FAVICON_ICO_SIZES.length);

    // A zero width or height means 256 in an ICO directory; no entry here is that large.
    const sizes = FAVICON_ICO_SIZES.map((_, index) => {
      const entry = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
      return { width: ico.readUInt8(entry), height: ico.readUInt8(entry + 1) };
    });

    expect(sizes).toEqual(FAVICON_ICO_SIZES.map((size) => ({ width: size, height: size })));
  });

  // The version is a hash of the artwork, so unlike the .ico and the .png this one can be checked
  // exactly: a mark edited without regenerating leaves the emails pointing at the cached old image.
  it(`${LOGO_VERSION_PATH} matches the rendered email logo`, async () => {
    const onDisk = await readFile(path.join(root, LOGO_VERSION_PATH), "utf8");

    expect(onDisk, `${LOGO_VERSION_PATH} is stale — run \`pnpm logo:generate\``).toBe(
      renderLogoVersionModule({ version: computeLogoVersion() })
    );
  });

  // Structure only, for the same reason as the .ico entries below: the bytes move with sharp.
  it(`${EMAIL_LOGO_PNG_PATH} is a PNG at the declared size`, async () => {
    const png = await readFile(path.join(root, EMAIL_LOGO_PNG_PATH));

    expect(
      png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
      `${EMAIL_LOGO_PNG_PATH} is not a PNG — run \`pnpm logo:generate\``
    ).toBe(true);

    // These pixels are what the structured-data logo advertises, and what the email <img> shows
    // scaled down; a file at another size would silently stretch in every inbox.
    expect({
      width: png.readUInt32BE(PNG_IHDR_WIDTH_OFFSET),
      height: png.readUInt32BE(PNG_IHDR_WIDTH_OFFSET + 4),
    }).toEqual({ width: SITE_LOGO.width, height: SITE_LOGO.height });
  });

  // The stock packers store raw BMP, which costs about 10x here. This catches a swap back to one.
  it(`${FAVICON_ICO_PATH} keeps every entry PNG-compressed`, async () => {
    const ico = await readFile(path.join(root, FAVICON_ICO_PATH));

    const signatures = FAVICON_ICO_SIZES.map((_, index) => {
      const entry = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
      const offset = ico.readUInt32LE(entry + 12);
      return ico.subarray(offset, offset + PNG_SIGNATURE.length);
    });

    for (const signature of signatures) {
      expect(signature.equals(PNG_SIGNATURE)).toBe(true);
    }
  });
});
