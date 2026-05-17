const VOICEBOARD = window.voiceboard;

const dom = {
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  outputDeviceSelect: document.querySelector("#outputDeviceSelect"),
  masterVolumeInput: document.querySelector("#masterVolumeInput"),
  masterVolumeValue: document.querySelector("#masterVolumeValue"),
  monitorEnabledInput: document.querySelector("#monitorEnabledInput"),
  setupCableButton: document.querySelector("#setupCableButton"),
  releaseCableButton: document.querySelector("#releaseCableButton"),
  refreshDevicesButton: document.querySelector("#refreshDevicesButton"),
  openDataButton: document.querySelector("#openDataButton"),
  stopAllButton: document.querySelector("#stopAllButton"),
  speakButton: document.querySelector("#speakButton"),
  ttsText: document.querySelector("#ttsText"),
  engineSelect: document.querySelector("#engineSelect"),
  voiceSelect: document.querySelector("#voiceSelect"),
  rateInput: document.querySelector("#rateInput"),
  pitchInput: document.querySelector("#pitchInput"),
  ttsVolumeInput: document.querySelector("#ttsVolumeInput"),
  rateValue: document.querySelector("#rateValue"),
  pitchValue: document.querySelector("#pitchValue"),
  ttsVolumeValue: document.querySelector("#ttsVolumeValue"),
  phraseLabel: document.querySelector("#phraseLabel"),
  savePhraseButton: document.querySelector("#savePhraseButton"),
  phraseGrid: document.querySelector("#phraseGrid"),
  emptyPhrases: document.querySelector("#emptyPhrases"),
  stopSoundsButton: document.querySelector("#stopSoundsButton"),
  youtubeUrlInput: document.querySelector("#youtubeUrlInput"),
  playYoutubeButton: document.querySelector("#playYoutubeButton"),
  saveYoutubeButton: document.querySelector("#saveYoutubeButton"),
  importSoundsButton: document.querySelector("#importSoundsButton"),
  soundGrid: document.querySelector("#soundGrid"),
  emptySounds: document.querySelector("#emptySounds"),
  logGrid: document.querySelector("#logGrid"),
  emptyLogs: document.querySelector("#emptyLogs"),
  soundEditModal: document.querySelector("#soundEditModal"),
  soundEditTitle: document.querySelector("#soundEditTitle"),
  soundEditStartInput: document.querySelector("#soundEditStartInput"),
  soundEditDurationInput: document.querySelector("#soundEditDurationInput"),
  saveSoundEditButton: document.querySelector("#saveSoundEditButton"),
  cancelSoundEditButton: document.querySelector("#cancelSoundEditButton"),
  cableInstallModal: document.querySelector("#cableInstallModal"),
  downloadCableButton: document.querySelector("#downloadCableButton"),
  retryCableButton: document.querySelector("#retryCableButton"),
  dismissCableButton: document.querySelector("#dismissCableButton")
};

let state = {
  settings: {
    outputDeviceId: "",
    ttsEngine: "edge",
    voice: "ko-KR-SunHiNeural",
    rate: 0,
    pitch: 0,
    ttsVolume: 0,
    masterVolume: 0.95,
    monitorEnabled: true
  },
  phrases: [],
  sounds: [],
  logs: []
};

const activePlayers = new Set();
let cableInstallModalDismissed = false;
let isSpeaking = false;
let editingSoundId = "";

function setStatus(text, tone = "ready") {
  dom.statusText.textContent = text;
  dom.statusDot.classList.toggle("busy", tone === "busy");
  dom.statusDot.classList.toggle("error", tone === "error");
}

function signed(value, suffix) {
  const numeric = Number(value) || 0;
  return `${numeric > 0 ? "+" : ""}${numeric}${suffix}`;
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatLogTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "시간 정보 없음";
  }

  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function updateControlValues() {
  dom.outputDeviceSelect.value = state.settings.outputDeviceId || "";
  dom.masterVolumeInput.value = state.settings.masterVolume;
  dom.masterVolumeValue.textContent = percent(state.settings.masterVolume);
  dom.monitorEnabledInput.checked = state.settings.monitorEnabled;
  dom.engineSelect.value = state.settings.ttsEngine;
  dom.voiceSelect.value = state.settings.voice;
  dom.voiceSelect.disabled = state.settings.ttsEngine === "windows";
  dom.rateInput.value = state.settings.rate;
  dom.pitchInput.value = state.settings.pitch;
  dom.ttsVolumeInput.value = state.settings.ttsVolume;
  dom.rateValue.textContent = signed(state.settings.rate, "%");
  dom.pitchValue.textContent = signed(state.settings.pitch, "Hz");
  dom.ttsVolumeValue.textContent = signed(state.settings.ttsVolume, "%");
}

async function saveSettings(patch) {
  state = await VOICEBOARD.updateSettings(patch);
  updateControlValues();
}

function createButton(className, icon, label, title) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.title = title || label;
  button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  return button;
}

function createIconButton(icon, title, danger = false) {
  const button = document.createElement("button");
  button.className = `icon-button${danger ? " danger" : ""}`;
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  return button;
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showCableInstallModal() {
  if (cableInstallModalDismissed) {
    return;
  }

  dom.cableInstallModal.hidden = false;
  refreshIcons();
}

function hideCableInstallModal() {
  dom.cableInstallModal.hidden = true;
}

function findPreferredCableOutput(outputs) {
  return outputs.find((device) => {
    const label = (device.label || "").toLowerCase();
    return (
      label.includes("cable input") ||
      label.includes("vb-audio virtual cable") ||
      label.includes("vb-cable")
    );
  });
}

async function refreshDevices(options = {}) {
  const { forceCable = false } = options;
  const currentValue = state.settings.outputDeviceId || "";
  dom.outputDeviceSelect.innerHTML = "";

  const defaultOption = new Option("시스템 기본 출력", "");
  dom.outputDeviceSelect.append(defaultOption);

  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    setStatus("오디오 장치 목록을 사용할 수 없음", "error");
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === "audiooutput");

    outputs.forEach((device, index) => {
      const label = device.label || `오디오 출력 ${index + 1}`;
      dom.outputDeviceSelect.append(new Option(label, device.deviceId));
    });

    const hasCurrentValue = [...dom.outputDeviceSelect.options].some(
      (option) => option.value === currentValue
    );
    const preferredCable = findPreferredCableOutput(outputs);

    dom.outputDeviceSelect.value = hasCurrentValue ? currentValue : "";

    if (forceCable && preferredCable) {
      dom.outputDeviceSelect.value = preferredCable.deviceId;
    }

    if (dom.outputDeviceSelect.value !== currentValue) {
      await saveSettings({ outputDeviceId: dom.outputDeviceSelect.value });
    }

    setStatus(
      forceCable && preferredCable
        ? "Voiceboard 출력이 VB-CABLE로 설정됨"
        : outputs.length
          ? "장치 목록 갱신됨"
          : "기본 출력만 사용 가능"
    );

    return preferredCable || null;
  } catch (error) {
    console.error(error);
    setStatus("장치 목록 갱신 실패", "error");
    return null;
  }
}

async function checkCableInstallation(options = {}) {
  const { showWhenMissing = true } = options;
  const outputDevice = await refreshDevices();

  try {
    const status = await VOICEBOARD.getCableStatus();
    const installed = Boolean(outputDevice && status.captureInstalled);

    if (installed) {
      hideCableInstallModal();
      return true;
    }

    if (showWhenMissing) {
      showCableInstallModal();
    }

    setStatus("VB-CABLE 설치 필요", "error");
    return false;
  } catch (error) {
    console.error(error);
    if (showWhenMissing) {
      showCableInstallModal();
    }
    setStatus("가상 케이블 확인 실패", "error");
    return false;
  }
}

async function applySink(audio, deviceId) {
  if (!deviceId || typeof audio.setSinkId !== "function") {
    return;
  }

  await audio.setSinkId(deviceId);
}

function trackAudio(audio, role, kind) {
  const entry = { audio, role, kind };
  activePlayers.add(entry);

  const cleanup = () => activePlayers.delete(entry);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", () => {
    cleanup();
    setStatus("재생 실패", "error");
  });

  return entry;
}

function updateLiveSendVolume() {
  activePlayers.forEach((entry) => {
    if (entry.role === "send") {
      entry.audio.volume = state.settings.masterVolume;
    }
  });
}

async function playUrl(fileUrl, options = {}) {
  const { kind = "sound" } = options;
  const sendAudio = new Audio(fileUrl);
  sendAudio.volume = state.settings.masterVolume;
  trackAudio(sendAudio, "send", kind);
  await applySink(sendAudio, state.settings.outputDeviceId);

  const players = [sendAudio];
  if (state.settings.monitorEnabled && state.settings.outputDeviceId) {
    const monitorAudio = new Audio(fileUrl);
    monitorAudio.volume = 1;
    trackAudio(monitorAudio, "monitor", kind);
    players.push(monitorAudio);
  }

  await Promise.all(players.map((audio) => audio.play()));
  setStatus("재생 중", "busy");
}

function stopMatchingPlayers(predicate, successText, emptyText) {
  let stopped = 0;
  activePlayers.forEach((entry) => {
    if (!predicate(entry)) {
      return;
    }

    entry.audio.pause();
    entry.audio.currentTime = 0;
    activePlayers.delete(entry);
    stopped += 1;
  });
  setStatus(stopped ? successText : emptyText);
}

function stopAll() {
  stopMatchingPlayers(() => true, "정지됨", "정지할 재생 없음");
}

function stopSounds() {
  stopMatchingPlayers((entry) => entry.kind === "sound", "사운드 정지됨", "정지할 사운드 없음");
}

async function setupCableRouting() {
  dom.setupCableButton.disabled = true;
  dom.releaseCableButton.disabled = true;

  try {
    setStatus("VB-CABLE 세팅 중", "busy");
    const preferredCable = await refreshDevices({ forceCable: true });
    if (!preferredCable) {
      setStatus("CABLE Input 출력 장치를 찾지 못함", "error");
      showCableInstallModal();
      return;
    }

    const result = await VOICEBOARD.setupCableAudio();
    state = result.state;
    render();
    setStatus(`세팅 완료: ${result.target.name}`, "ready");
  } catch (error) {
    console.error(error);
    showCableInstallModal();
    setStatus("VB-CABLE 세팅 실패", "error");
  } finally {
    dom.setupCableButton.disabled = false;
    dom.releaseCableButton.disabled = false;
  }
}

async function releaseCableRouting() {
  dom.setupCableButton.disabled = true;
  dom.releaseCableButton.disabled = true;

  try {
    setStatus("VB-CABLE 해제 중", "busy");
    const result = await VOICEBOARD.releaseCableAudio();
    state = result.state;
    state = await VOICEBOARD.updateSettings({ outputDeviceId: "" });
    render();
    setStatus(result.restored ? "기본 마이크로 복원됨" : "복원할 이전 마이크 없음", "ready");
  } catch (error) {
    console.error(error);
    setStatus("VB-CABLE 해제 실패", "error");
  } finally {
    dom.setupCableButton.disabled = false;
    dom.releaseCableButton.disabled = false;
  }
}

async function speakText(text, options = {}) {
  const { clearComposer = false } = options;
  const normalized = text.trim();
  if (!normalized) {
    setStatus("문장을 입력하세요", "error");
    dom.ttsText.focus();
    return;
  }

  if (isSpeaking) {
    return;
  }

  try {
    isSpeaking = true;
    setStatus("TTS 생성 중", "busy");
    dom.speakButton.disabled = true;
    const result = await VOICEBOARD.synthesizeTts({
      text: normalized,
      settings: state.settings
    });
    await playUrl(result.fileUrl, { kind: "tts" });
    state = await VOICEBOARD.addLog({ text: normalized });
    render();

    if (clearComposer && dom.ttsText.value.trim() === normalized) {
      dom.ttsText.value = "";
    }

    if (result.engine === "windows-fallback") {
      setStatus("Windows 음성으로 재생 중", "busy");
    }
  } catch (error) {
    console.error(error);
    setStatus("TTS 생성 실패", "error");
  } finally {
    isSpeaking = false;
    dom.speakButton.disabled = false;
  }
}

function speakFromComposer() {
  return speakText(dom.ttsText.value, { clearComposer: true });
}

async function playYoutubeUrl() {
  const url = dom.youtubeUrlInput.value.trim();
  if (!url) {
    setStatus("YouTube 링크를 입력하세요", "error");
    dom.youtubeUrlInput.focus();
    return;
  }

  try {
    setStatus("YouTube 오디오 불러오는 중", "busy");
    dom.playYoutubeButton.disabled = true;
    dom.saveYoutubeButton.disabled = true;
    const result = await VOICEBOARD.resolveYoutube(url);
    await playUrl(result.fileUrl, { kind: "sound" });
    dom.youtubeUrlInput.value = "";
    setStatus(`YouTube 재생 중: ${result.title}`, "busy");
  } catch (error) {
    console.error(error);
    setStatus("YouTube 재생 실패", "error");
  } finally {
    dom.playYoutubeButton.disabled = false;
    dom.saveYoutubeButton.disabled = false;
  }
}

async function saveYoutubeToSoundboard() {
  const url = dom.youtubeUrlInput.value.trim();
  if (!url) {
    setStatus("YouTube 링크를 입력하세요", "error");
    dom.youtubeUrlInput.focus();
    return;
  }

  try {
    setStatus("YouTube 사운드 저장 중", "busy");
    dom.playYoutubeButton.disabled = true;
    dom.saveYoutubeButton.disabled = true;
    state = await VOICEBOARD.importYoutubeSound(url);
    render();
    dom.youtubeUrlInput.value = "";
    setStatus("YouTube 사운드 추가됨");
  } catch (error) {
    console.error(error);
    setStatus("YouTube 사운드 추가 실패", "error");
  } finally {
    dom.playYoutubeButton.disabled = false;
    dom.saveYoutubeButton.disabled = false;
  }
}

function openSoundEditor(sound) {
  editingSoundId = sound.id;
  dom.soundEditTitle.textContent = `${sound.label} 편집`;
  dom.soundEditStartInput.value = "0";
  dom.soundEditDurationInput.value = "5";
  dom.soundEditModal.hidden = false;
  refreshIcons();
  dom.soundEditStartInput.focus();
}

function closeSoundEditor() {
  editingSoundId = "";
  dom.soundEditModal.hidden = true;
}

async function saveSoundEdit() {
  if (!editingSoundId) {
    closeSoundEditor();
    return;
  }

  try {
    setStatus("사운드 편집 중", "busy");
    dom.saveSoundEditButton.disabled = true;
    state = await VOICEBOARD.trimSound({
      id: editingSoundId,
      startSeconds: Number(dom.soundEditStartInput.value),
      durationSeconds: Number(dom.soundEditDurationInput.value)
    });
    render();
    closeSoundEditor();
    setStatus("사운드 편집 저장됨");
  } catch (error) {
    console.error(error);
    setStatus("사운드 편집 실패", "error");
  } finally {
    dom.saveSoundEditButton.disabled = false;
  }
}

function renderPhrases() {
  dom.phraseGrid.innerHTML = "";
  dom.emptyPhrases.hidden = state.phrases.length > 0;

  state.phrases.forEach((phrase) => {
    const item = document.createElement("article");
    item.className = "library-item";
    item.innerHTML = `
      <strong></strong>
      <p></p>
      <div class="item-actions"></div>
    `;
    item.querySelector("strong").textContent = phrase.label;
    item.querySelector("p").textContent = phrase.text;

    const actions = item.querySelector(".item-actions");
    const playButton = createButton("secondary-button", "play", "실행", "문장 실행");
    const deleteButton = createIconButton("trash-2", "문장 삭제", true);

    playButton.addEventListener("click", () => speakText(phrase.text));
    deleteButton.addEventListener("click", async () => {
      state = await VOICEBOARD.deletePhrase(phrase.id);
      render();
      setStatus("문장 삭제됨");
    });

    actions.append(playButton, deleteButton);
    dom.phraseGrid.append(item);
  });
}

function renderSounds() {
  dom.soundGrid.innerHTML = "";
  dom.emptySounds.hidden = state.sounds.length > 0;

  state.sounds.forEach((sound) => {
    const item = document.createElement("article");
    item.className = "library-item";
    item.innerHTML = `
      <strong></strong>
      <p></p>
      <div class="item-actions"></div>
    `;
    item.querySelector("strong").textContent = sound.label;
    item.querySelector("p").textContent = sound.exists ? "Ready" : "파일 없음";

    const actions = item.querySelector(".item-actions");
    const playButton = createButton("secondary-button", "play", "실행", "사운드 실행");
    const editButton = createButton("secondary-button", "scissors", "편집", "사운드 편집");
    const deleteButton = createIconButton("trash-2", "사운드 삭제", true);

    playButton.disabled = !sound.exists;
    editButton.disabled = !sound.exists;
    playButton.addEventListener("click", () => playUrl(sound.fileUrl));
    editButton.addEventListener("click", () => openSoundEditor(sound));
    deleteButton.addEventListener("click", async () => {
      state = await VOICEBOARD.deleteSound(sound.id);
      render();
      setStatus("사운드 삭제됨");
    });

    actions.append(playButton, editButton, deleteButton);
    dom.soundGrid.append(item);
  });
}

function renderLogs() {
  dom.logGrid.innerHTML = "";
  dom.emptyLogs.hidden = state.logs.length > 0;

  state.logs.forEach((log) => {
    const item = document.createElement("article");
    item.className = "library-item log-item";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `${log.text} 다시 전송`);
    item.innerHTML = `
      <strong></strong>
      <p></p>
      <div class="item-actions"></div>
    `;
    item.querySelector("strong").textContent = log.text;
    item.querySelector("p").textContent = formatLogTime(log.createdAt);

    const actions = item.querySelector(".item-actions");
    const playButton = createButton("secondary-button", "rotate-ccw", "다시 전송", "로그 다시 전송");

    playButton.addEventListener("click", () => speakText(log.text));
    item.addEventListener("click", (event) => {
      if (!(event.target instanceof Element && event.target.closest("button"))) {
        speakText(log.text);
      }
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        speakText(log.text);
      }
    });

    actions.append(playButton);
    dom.logGrid.append(item);
  });
}

function render() {
  updateControlValues();
  renderPhrases();
  renderSounds();
  renderLogs();
  refreshIcons();
}

function bindEvents() {
  dom.refreshDevicesButton.addEventListener("click", refreshDevices);
  dom.openDataButton.addEventListener("click", () => VOICEBOARD.openDataFolder());
  dom.stopAllButton.addEventListener("click", stopAll);
  dom.stopSoundsButton.addEventListener("click", stopSounds);
  dom.speakButton.addEventListener("click", speakFromComposer);
  dom.ttsText.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      speakFromComposer();
    }
  });
  dom.setupCableButton.addEventListener("click", setupCableRouting);
  dom.releaseCableButton.addEventListener("click", releaseCableRouting);
  dom.downloadCableButton.addEventListener("click", () => VOICEBOARD.openVbCableDownload());
  dom.retryCableButton.addEventListener("click", () => checkCableInstallation());
  dom.dismissCableButton.addEventListener("click", () => {
    cableInstallModalDismissed = true;
    hideCableInstallModal();
  });
  dom.playYoutubeButton.addEventListener("click", playYoutubeUrl);
  dom.saveYoutubeButton.addEventListener("click", saveYoutubeToSoundboard);
  dom.youtubeUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      playYoutubeUrl();
    }
  });
  dom.saveSoundEditButton.addEventListener("click", saveSoundEdit);
  dom.cancelSoundEditButton.addEventListener("click", closeSoundEditor);
  dom.soundEditModal.addEventListener("click", (event) => {
    if (event.target === dom.soundEditModal) {
      closeSoundEditor();
    }
  });
  dom.soundEditModal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSoundEditor();
    }
  });

  dom.outputDeviceSelect.addEventListener("change", () =>
    saveSettings({ outputDeviceId: dom.outputDeviceSelect.value })
  );
  dom.masterVolumeInput.addEventListener("input", async () => {
    await saveSettings({ masterVolume: Number(dom.masterVolumeInput.value) });
    updateLiveSendVolume();
  });
  dom.monitorEnabledInput.addEventListener("change", () =>
    saveSettings({ monitorEnabled: dom.monitorEnabledInput.checked })
  );
  dom.engineSelect.addEventListener("change", () => saveSettings({ ttsEngine: dom.engineSelect.value }));
  dom.voiceSelect.addEventListener("change", () => saveSettings({ voice: dom.voiceSelect.value }));
  dom.rateInput.addEventListener("input", () => saveSettings({ rate: Number(dom.rateInput.value) }));
  dom.pitchInput.addEventListener("input", () =>
    saveSettings({ pitch: Number(dom.pitchInput.value) })
  );
  dom.ttsVolumeInput.addEventListener("input", () =>
    saveSettings({ ttsVolume: Number(dom.ttsVolumeInput.value) })
  );

  dom.savePhraseButton.addEventListener("click", async () => {
    const text = dom.ttsText.value.trim();
    if (!text) {
      setStatus("저장할 문장이 필요함", "error");
      return;
    }

    state = await VOICEBOARD.addPhrase({
      label: dom.phraseLabel.value,
      text
    });
    dom.phraseLabel.value = "";
    render();
    setStatus("문장 저장됨");
  });

  dom.importSoundsButton.addEventListener("click", async () => {
    state = await VOICEBOARD.importSounds();
    render();
    setStatus("사운드 보관함 갱신됨");
  });
}

async function init() {
  bindEvents();
  state = await VOICEBOARD.getLibrary();
  render();
  await checkCableInstallation();
}

init().catch((error) => {
  console.error(error);
  setStatus("초기화 실패", "error");
});
