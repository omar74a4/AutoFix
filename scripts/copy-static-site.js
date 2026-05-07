import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");

const rootFileExtensions = new Set([".html", ".js", ".css"]);
const rootFiles = fs
  .readdirSync(projectRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && rootFileExtensions.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => entry.name);

const assetDirectories = ["pictures", "fonts", "public"];

function copyFile(fileName) {
  fs.copyFileSync(path.join(projectRoot, fileName), path.join(distRoot, fileName));
}

function copyDirectory(directoryName) {
  const source = path.join(projectRoot, directoryName);
  const target = path.join(distRoot, directoryName);

  if (!fs.existsSync(source)) {
    return;
  }

  fs.cpSync(source, target, {
    recursive: true,
    force: true
  });
}

if (!fs.existsSync(distRoot)) {
  fs.mkdirSync(distRoot, { recursive: true });
}

for (const fileName of rootFiles) {
  copyFile(fileName);
}

for (const directoryName of assetDirectories) {
  copyDirectory(directoryName);
}

console.log(`Copied ${rootFiles.length} root files and ${assetDirectories.length} asset folders into dist.`);
