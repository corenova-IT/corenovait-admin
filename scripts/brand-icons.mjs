/**
 * Makes the browser-tab and home-screen icons from the logo in public/brand.
 * Run after changing the logo: npm run brand:icons (the results are committed).
 *
 * - icon-32.png: the tab icon. Transparent, so it suits light and dark browsers.
 * - apple-touch-icon.png (180) and icon-512.png: on white with some room
 *   around the atom, because phones put these on any wallpaper.
 * - logo-128.png and logo-light-lines-128.png: the small copies the sidebar and
 *   sign-in pages show (served directly as plain files; the full-size logos are
 *   about 130 KB each, far more than a 40-56 px logo needs, and they are still
 *   used in emails).
 */
import path from "node:path";
import sharp from "sharp";

const dir = path.resolve("public/brand");
const src = path.join(dir, "corenova-logo.png");

await sharp(src).resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, "icon-32.png"));
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-512.png", 512]]) {
  const inner = Math.round(size * 0.8);
  const atom = await sharp(src).resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
    .composite([{ input: atom, gravity: "center" }])
    .png()
    .toFile(path.join(dir, name));
}
for (const [from, to] of [["corenova-logo.png", "logo-128.png"], ["corenova-logo-light-lines.png", "logo-light-lines-128.png"]]) {
  await sharp(path.join(dir, from))
    .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(dir, to));
}
console.log("Wrote icon-32.png, apple-touch-icon.png, icon-512.png, logo-128.png and logo-light-lines-128.png in public/brand.");
