const fs = require("node:fs");
const path = require("node:path");
const { normalizeState } = require("../shared/library.cjs");

class LibraryStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  ensureReady() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  read() {
    this.ensureReady();

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to read library, using defaults:", error);
      }
      return normalizeState();
    }
  }

  write(state) {
    this.ensureReady();

    const normalized = normalizeState(state);
    const tempFile = `${this.filePath}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    fs.renameSync(tempFile, this.filePath);
    return normalized;
  }

  update(updater) {
    const next = updater(this.read());
    return this.write(next);
  }
}

module.exports = {
  LibraryStore
};
