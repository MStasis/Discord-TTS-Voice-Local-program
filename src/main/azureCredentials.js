const fs = require("node:fs");
const path = require("node:path");
const { azureError, normalizeAzureCredentials } = require("./azureTts");

class AzureCredentialStore {
  constructor(filePath, safeStorage) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error("Encryption unavailable");
      const saved = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (saved.version !== 1 || typeof saved.encryptedKey !== "string" || !saved.encryptedKey) {
        throw new Error("Invalid credentials");
      }
      return normalizeAzureCredentials({
        region: saved.region,
        key: this.safeStorage.decryptString(Buffer.from(saved.encryptedKey, "base64"))
      });
    } catch {
      throw azureError("AZURE_CREDENTIALS_UNREADABLE", "저장된 Azure 키를 읽지 못했습니다. 키를 다시 저장해 주세요.");
    }
  }

  status() {
    try {
      const credentials = this.read();
      return { configured: Boolean(credentials), region: credentials?.region || "" };
    } catch (error) {
      return { configured: false, region: "", message: error.message };
    }
  }

  resolve(input = {}) {
    if (!input || typeof input !== "object") input = {};
    const key = typeof input.key === "string" ? input.key.trim() : "";
    const saved = key ? null : this.read();
    return normalizeAzureCredentials({ key: key || saved?.key, region: input.region || saved?.region });
  }

  save(input) {
    const credentials = this.resolve(input);
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw azureError("AZURE_SECURE_STORAGE_UNAVAILABLE", "Windows 보안 저장소를 사용할 수 없어 키를 저장하지 않았습니다.");
    }
    try {
      const encryptedKey = this.safeStorage.encryptString(credentials.key).toString("base64");
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempFile = `${this.filePath}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify({ version: 1, region: credentials.region, encryptedKey }), { mode: 0o600 });
      fs.renameSync(tempFile, this.filePath);
    } catch {
      throw azureError("AZURE_SAVE_FAILED", "Azure 키를 저장하지 못했습니다. 다시 시도해 주세요.");
    }
    return this.status();
  }

  clear() {
    try { fs.rmSync(this.filePath, { force: true }); }
    catch { throw azureError("AZURE_DELETE_FAILED", "Azure 키를 삭제하지 못했습니다."); }
    return this.status();
  }
}

module.exports = { AzureCredentialStore };
