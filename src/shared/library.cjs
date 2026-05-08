const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  outputDeviceId: "",
  ttsEngine: "edge",
  voice: "ko-KR-SunHiNeural",
  rate: 0,
  pitch: 0,
  ttsVolume: 0,
  masterVolume: 0.95,
  monitorEnabled: true,
  captureDefaultsBackup: {
    console: "",
    multimedia: "",
    communications: ""
  }
});

const DEFAULT_STATE = Object.freeze({
  version: 1,
  settings: DEFAULT_SETTINGS,
  phrases: [],
  sounds: []
});

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function safeLabel(value, fallback = "Untitled") {
  const text = normalizeText(value).replace(/\s+/g, " ");
  return text.length > 80 ? text.slice(0, 80).trim() : text || fallback;
}

function safeFileName(value) {
  const parsed = path.parse(value || "");
  const base = safeLabel(parsed.name || value, "sound")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\.+$/g, "")
    .slice(0, 70);
  const ext = (parsed.ext || "").toLowerCase().replace(/[^.\w]/g, "");
  return `${base || "sound"}${ext}`;
}

function toEdgePercent(value) {
  const numeric = clampNumber(value, -100, 100, 0);
  return `${numeric >= 0 ? "+" : ""}${numeric}%`;
}

function toEdgePitch(value) {
  const numeric = clampNumber(value, -200, 200, 0);
  return `${numeric >= 0 ? "+" : ""}${numeric}Hz`;
}

function normalizeSettings(settings = {}) {
  const backup = settings.captureDefaultsBackup || {};

  return {
    outputDeviceId: normalizeText(settings.outputDeviceId),
    ttsEngine: normalizeText(settings.ttsEngine) === "windows" ? "windows" : "edge",
    voice: normalizeText(settings.voice) || DEFAULT_SETTINGS.voice,
    rate: clampNumber(settings.rate, -100, 100, DEFAULT_SETTINGS.rate),
    pitch: clampNumber(settings.pitch, -200, 200, DEFAULT_SETTINGS.pitch),
    ttsVolume: clampNumber(settings.ttsVolume, -100, 100, DEFAULT_SETTINGS.ttsVolume),
    masterVolume: clampNumber(settings.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
    monitorEnabled:
      typeof settings.monitorEnabled === "boolean"
        ? settings.monitorEnabled
        : DEFAULT_SETTINGS.monitorEnabled,
    captureDefaultsBackup: {
      console: normalizeText(backup.console),
      multimedia: normalizeText(backup.multimedia),
      communications: normalizeText(backup.communications)
    }
  };
}

function normalizePhrase(item) {
  const text = normalizeText(item && item.text);
  if (!text) {
    return null;
  }

  return {
    id: normalizeText(item.id),
    label: safeLabel(item.label || text.slice(0, 24), "Phrase"),
    text
  };
}

function normalizeSound(item) {
  const sourcePath = normalizeText(item && item.path);
  if (!sourcePath) {
    return null;
  }

  return {
    id: normalizeText(item.id),
    label: safeLabel(item.label || path.parse(sourcePath).name, "Sound"),
    path: sourcePath
  };
}

function normalizeState(input = {}) {
  const phrases = Array.isArray(input.phrases)
    ? input.phrases.map(normalizePhrase).filter(Boolean)
    : [];
  const sounds = Array.isArray(input.sounds)
    ? input.sounds.map(normalizeSound).filter(Boolean)
    : [];

  return {
    version: 1,
    settings: normalizeSettings(input.settings),
    phrases,
    sounds
  };
}

function updateSettings(state, patch) {
  const current = normalizeState(state);
  return normalizeState({
    ...current,
    settings: {
      ...current.settings,
      ...patch
    }
  });
}

function addPhrase(state, phrase) {
  const current = normalizeState(state);
  const normalized = normalizePhrase(phrase);
  if (!normalized || !normalized.id) {
    return current;
  }

  return normalizeState({
    ...current,
    phrases: [...current.phrases.filter((item) => item.id !== normalized.id), normalized]
  });
}

function removePhrase(state, id) {
  const current = normalizeState(state);
  return normalizeState({
    ...current,
    phrases: current.phrases.filter((item) => item.id !== id)
  });
}

function addSound(state, sound) {
  const current = normalizeState(state);
  const normalized = normalizeSound(sound);
  if (!normalized || !normalized.id) {
    return current;
  }

  return normalizeState({
    ...current,
    sounds: [...current.sounds.filter((item) => item.id !== normalized.id), normalized]
  });
}

function removeSound(state, id) {
  const current = normalizeState(state);
  return normalizeState({
    ...current,
    sounds: current.sounds.filter((item) => item.id !== id)
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  addPhrase,
  addSound,
  normalizeState,
  removePhrase,
  removeSound,
  safeFileName,
  safeLabel,
  toEdgePercent,
  toEdgePitch,
  updateSettings
};
