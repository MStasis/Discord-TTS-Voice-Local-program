const VOICEBOARD = window.voiceboard;

const dom = {
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  outputDeviceSelect: document.querySelector("#outputDeviceSelect"),
  masterVolumeInput: document.querySelector("#masterVolumeInput"),
  masterVolumeValue: document.querySelector("#masterVolumeValue"),
  monitorVolumeInput: document.querySelector("#monitorVolumeInput"),
  monitorVolumeValue: document.querySelector("#monitorVolumeValue"),
  monitorEnabledInput: document.querySelector("#monitorEnabledInput"),
  closeToTrayInput: document.querySelector("#closeToTrayInput"),
  setupCableButton: document.querySelector("#setupCableButton"),
  releaseCableButton: document.querySelector("#releaseCableButton"),
  refreshDevicesButton: document.querySelector("#refreshDevicesButton"),
  openDataButton: document.querySelector("#openDataButton"),
  stopAllButton: document.querySelector("#stopAllButton"),
  speakButton: document.querySelector("#speakButton"),
  ttsText: document.querySelector("#ttsText"),
  engineSelect: document.querySelector("#engineSelect"),
  azureSettingsButton: document.querySelector("#azureSettingsButton"),
  azureSettingsModal: document.querySelector("#azureSettingsModal"),
  closeAzureSettingsButton: document.querySelector("#closeAzureSettingsButton"),
  azureRegionInput: document.querySelector("#azureRegionInput"),
  azureKeyInput: document.querySelector("#azureKeyInput"),
  azureSettingsStatus: document.querySelector("#azureSettingsStatus"),
  saveAzureSettingsButton: document.querySelector("#saveAzureSettingsButton"),
  testAzureConnectionButton: document.querySelector("#testAzureConnectionButton"),
  deleteAzureSettingsButton: document.querySelector("#deleteAzureSettingsButton"),
  openAzurePortalButton: document.querySelector("#openAzurePortalButton"),
  voiceSelect: document.querySelector("#voiceSelect"),
  rateInput: document.querySelector("#rateInput"),
  pitchInput: document.querySelector("#pitchInput"),
  ttsVolumeInput: document.querySelector("#ttsVolumeInput"),
  rateValue: document.querySelector("#rateValue"),
  pitchValue: document.querySelector("#pitchValue"),
  ttsVolumeValue: document.querySelector("#ttsVolumeValue"),
  phraseGrid: document.querySelector("#phraseGrid"),
  emptyPhrases: document.querySelector("#emptyPhrases"),
  stopSoundsButton: document.querySelector("#stopSoundsButton"),
  youtubeUrlInput: document.querySelector("#youtubeUrlInput"),
  playYoutubeButton: document.querySelector("#playYoutubeButton"),
  saveYoutubeButton: document.querySelector("#saveYoutubeButton"),
  importSoundsButton: document.querySelector("#importSoundsButton"),
  soundGrid: document.querySelector("#soundGrid"),
  emptySounds: document.querySelector("#emptySounds"),
  phraseCount: document.querySelector("#phraseCount"),
  soundCount: document.querySelector("#soundCount"),
  soundPagination: document.querySelector("#soundPagination"),
  soundPageLabel: document.querySelector("#soundPageLabel"),
  previousSoundsButton: document.querySelector("#previousSoundsButton"),
  nextSoundsButton: document.querySelector("#nextSoundsButton"),
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
    ttsEngine: "azure",
    voice: "ko-KR-SunHiNeural",
    rate: 0,
    pitch: 0,
    ttsVolume: 0,
    masterVolume: 0.95,
    monitorVolume: 1,
    monitorEnabled: true,
    closeToTray: false
  },
  phrases: [],
  recentPhrases: [],
  sounds: []
};

const activePlayers = new Set();
let cableInstallModalDismissed = false;
let speechChain = Promise.resolve();
let speechGeneration = 0;
let editingSoundId = "";
let soundPage = 0;
let azureStatus = { configured: false, region: "" };
let azureBusy = false;
let azureOpener;
const compactSounds = window.matchMedia?.("(max-width: 650px)");

function setStatus(text, tone = "ready") {
  dom.statusText.textContent = text;
  dom.statusText.title = text;
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

function updateControlValues() {
  dom.outputDeviceSelect.value = state.settings.outputDeviceId || "";
  dom.masterVolumeInput.value = state.settings.masterVolume;
  dom.masterVolumeValue.textContent = percent(state.settings.masterVolume);
  dom.monitorVolumeInput.value = state.settings.monitorVolume;
  dom.monitorVolumeValue.textContent = percent(state.settings.monitorVolume);
  dom.monitorVolumeInput.disabled = !state.settings.monitorEnabled;
  dom.monitorEnabledInput.checked = state.settings.monitorEnabled;
  dom.closeToTrayInput.checked = state.settings.closeToTray;
  dom.engineSelect.value = state.settings.ttsEngine;
  dom.azureSettingsButton.hidden = state.settings.ttsEngine !== "azure";
  for (const option of dom.voiceSelect.options) {
    if (option.hasAttribute?.("data-azure-only")) {
      option.hidden = state.settings.ttsEngine !== "azure";
      option.disabled = option.hidden;
    }
  }
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

function azureFailureMessage(error) {
  const message = typeof error === "string" ? error : String(error?.message || "");
  return message.match(/AZURE_[A-Z_]+: ([^\n]*)/)?.[1] || "Azure 설정을 처리하지 못했습니다.";
}

function renderAzureStatus(message, failed = false) {
  dom.azureSettingsStatus.textContent = message || (azureStatus.configured ? "키 저장됨" : "키 미등록");
  dom.azureSettingsStatus.classList.toggle("error", failed);
  dom.azureKeyInput.placeholder = azureStatus.configured ? "저장된 키 유지" : "Azure Speech 키";
  dom.deleteAzureSettingsButton.disabled = azureBusy || !azureStatus.configured;
}

async function openAzureSettings() {
  azureOpener = document.activeElement;
  dom.azureKeyInput.value = "";
  dom.azureSettingsModal.hidden = false;
  renderAzureStatus("불러오는 중");
  try {
    azureStatus = await VOICEBOARD.getAzureSettings();
    if (dom.azureSettingsModal.hidden) return;
    dom.azureRegionInput.value = azureStatus.region || "koreacentral";
    renderAzureStatus(azureStatus.message ? azureFailureMessage(azureStatus.message) : "", Boolean(azureStatus.message));
    dom.azureRegionInput.focus({ preventScroll: true });
  } catch (error) {
    renderAzureStatus(azureFailureMessage(error), true);
  }
}

function closeAzureSettings() {
  dom.azureSettingsModal.hidden = true;
  dom.azureKeyInput.value = "";
  azureOpener?.focus({ preventScroll: true });
}

async function updateAzureConnection(action) {
  if (azureBusy) return;
  azureBusy = true;
  const payload = { region: dom.azureRegionInput.value.trim(), key: dom.azureKeyInput.value.trim() };
  const controls = [dom.saveAzureSettingsButton, dom.testAzureConnectionButton, dom.deleteAzureSettingsButton, dom.azureRegionInput, dom.azureKeyInput];
  controls.forEach((control) => { control.disabled = true; });
  renderAzureStatus(action === "test" ? "연결 확인 중" : "처리 중");
  try {
    if (action === "test") {
      const result = await VOICEBOARD.testAzureConnection(payload);
      renderAzureStatus(`연결 확인됨 · 한국어 목소리 ${result.koreanVoices}개`);
    } else {
      azureStatus = action === "save"
        ? await VOICEBOARD.saveAzureSettings(payload) : await VOICEBOARD.deleteAzureSettings();
      dom.azureKeyInput.value = "";
      renderAzureStatus();
      setStatus(action === "save" ? "Azure 연결 설정 저장됨" : "Azure 키 삭제됨");
    }
  } catch (error) {
    renderAzureStatus(azureFailureMessage(error), true);
  } finally {
    azureBusy = false;
    controls.forEach((control) => { control.disabled = false; });
    dom.deleteAzureSettingsButton.disabled = !azureStatus.configured;
  }
}

function createButton(className, icon, label, title) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.title = title || label;
  button.innerHTML = `<i data-lucide="${icon}"></i><span></span>`;
  button.querySelector("span").textContent = label;
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

  entry.finished = new Promise((resolve) => {
    entry.finish = (ok = true) => { activePlayers.delete(entry); resolve(ok); };
  });
  audio.addEventListener("ended", () => entry.finish(), { once: true });
  audio.addEventListener("error", () => {
    entry.finish(false);
    setStatus("재생 실패", "error");
  });

  return entry;
}

function updateLiveOutputVolumes() {
  activePlayers.forEach((entry) => {
    entry.audio.volume = entry.role === "send"
      ? state.settings.masterVolume
      : state.settings.monitorEnabled ? state.settings.monitorVolume : 0;
  });
}

async function savePlaybackSettings(patch) {
  try {
    await saveSettings(patch);
    updateLiveOutputVolumes();
  } catch {
    updateControlValues();
    setStatus("출력 설정 저장 실패", "error");
  }
}

async function playUrl(fileUrl, options = {}) {
  const { kind = "sound" } = options;
  const sendAudio = new Audio(fileUrl);
  sendAudio.volume = state.settings.masterVolume;
  const entries = [trackAudio(sendAudio, "send", kind)];
  try {
    await applySink(sendAudio, state.settings.outputDeviceId);

    const players = [sendAudio];
    if (state.settings.monitorEnabled && state.settings.outputDeviceId) {
      const monitorAudio = new Audio(fileUrl);
      monitorAudio.volume = state.settings.monitorVolume;
      entries.push(trackAudio(monitorAudio, "monitor", kind));
      players.push(monitorAudio);
    }

    await Promise.all(players.map((audio) => audio.play()));
    setStatus("재생 중", "busy");
    return { finished: Promise.all(entries.map((entry) => entry.finished)) };
  } catch (error) {
    entries.forEach((entry) => { entry.audio.pause(); entry.finish(false); });
    throw error;
  }
}

function stopMatchingPlayers(predicate, successText, emptyText) {
  let stopped = 0;
  activePlayers.forEach((entry) => {
    if (!predicate(entry)) {
      return;
    }

    entry.audio.pause();
    entry.audio.currentTime = 0;
    entry.finish(false);
    stopped += 1;
  });
  setStatus(stopped ? successText : emptyText);
}

function stopAll() {
  speechGeneration += 1;
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
    setStatus(
      result.discord.applied ? "세팅 완료: 잡음 없음 · 에코 끔 · 감도 -95dB" : `케이블 세팅됨 · ${result.discord.message}`,
      result.discord.applied ? "ready" : "error"
    );
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
    const routingStatus = result.restored ? "기본 마이크로 복원됨" : "복원할 마이크 없음";
    setStatus(
      result.discord.applied
        ? `${routingStatus} · Krisp · 에코 켬 · 감도 -55dB`
        : `${routingStatus} · ${result.discord.message}`,
      result.restored && result.discord.applied ? "ready" : "error"
    );
  } catch (error) {
    console.error(error);
    setStatus("VB-CABLE 해제 실패", "error");
  } finally {
    dom.setupCableButton.disabled = false;
    dom.releaseCableButton.disabled = false;
  }
}

function speakText(text, options = {}) {
  const { clearComposer = false } = options;
  const normalized = text.trim();
  if (!normalized) {
    setStatus("문장을 입력하세요", "error");
    dom.ttsText.focus();
    return Promise.resolve({ ok: false });
  }

  const submittedDraft = clearComposer ? dom.ttsText.value : "";
  if (clearComposer) {
    dom.ttsText.value = "";
    dom.ttsText.focus();
  }

  const generation = speechGeneration;
  const settings = { ...state.settings };
  const job = speechChain.then(async () => {
    try {
      if (generation !== speechGeneration) return { ok: false };
      setStatus("TTS 생성 중", "busy");
      const result = await VOICEBOARD.synthesizeTts({ text: normalized, settings });
      if (generation !== speechGeneration) return { ok: false };
      const playback = await playUrl(result.fileUrl, { kind: "tts" });

      try {
        state.recentPhrases = await VOICEBOARD.addRecentPhrase(normalized);
        renderPhrases();
        refreshIcons();
      } catch (error) {
        console.error(error);
        setStatus("음성 재생됨 · 최근 대화 저장 실패", "error");
      }

      const results = await playback.finished;
      return { ok: results.every(Boolean) };
    } catch (error) {
      console.error(error);
      if (clearComposer) {
        // Preserve new typing while restoring a failed submission.
        dom.ttsText.value = dom.ttsText.value ? `${submittedDraft}\n${dom.ttsText.value}` : submittedDraft;
      }
      const unavailable = String(error?.message).includes("TTS_VOICE_UNAVAILABLE");
      const forbidden = unavailable && String(error.message).includes("HTTP 403");
      const message = String(error?.message).includes("AZURE_") ? azureFailureMessage(error) : forbidden
        ? "온라인 목소리 연결 거부 (403) · 자동 전환 안 함"
        : unavailable ? "온라인 목소리 연결 실패 · 자동 전환 안 함" : "TTS 생성 실패 · 다시 전송해 주세요";
      setStatus(message, "error");
      return { ok: false, message };
    }
  });
  speechChain = job.catch(() => {});
  return job;
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
  dom.phraseCount.textContent = String(state.recentPhrases.length);
  dom.emptyPhrases.hidden = state.recentPhrases.length > 0;

  state.recentPhrases.forEach((phrase) => {
    const item = document.createElement("article");
    item.className = "recent-item";
    const playButton = createButton("recent-play", "rotate-ccw", phrase.text, phrase.text);
    playButton.setAttribute("aria-label", `다시 전송: ${phrase.text}`);
    const deleteButton = createIconButton("trash-2", "최근 대화 삭제", true);

    playButton.addEventListener("click", () => speakText(phrase.text));
    deleteButton.addEventListener("click", async () => {
      state.recentPhrases = await VOICEBOARD.deleteRecentPhrase(phrase.id);
      renderPhrases();
      refreshIcons();
      setStatus("최근 대화 삭제됨");
    });

    item.append(playButton, deleteButton);
    dom.phraseGrid.append(item);
  });
}

function renderSounds() {
  dom.soundGrid.innerHTML = "";
  dom.soundCount.textContent = String(state.sounds.length);
  dom.emptySounds.hidden = state.sounds.length > 0;
  dom.soundGrid.hidden = state.sounds.length === 0;
  const pageSize = compactSounds?.matches ? 3 : 6;
  const pageCount = Math.max(1, Math.ceil(state.sounds.length / pageSize));
  soundPage = Math.min(Math.max(soundPage, 0), pageCount - 1);
  dom.soundPagination.hidden = pageCount === 1;
  dom.previousSoundsButton.disabled = soundPage === 0;
  dom.nextSoundsButton.disabled = soundPage === pageCount - 1;
  dom.soundPageLabel.textContent = `${soundPage + 1} / ${pageCount}`;

  state.sounds.slice(soundPage * pageSize, (soundPage + 1) * pageSize).forEach((sound) => {
    const item = document.createElement("article");
    item.className = "sound-item";
    const playButton = createButton("sound-play", "play", sound.label, sound.exists ? sound.label : `${sound.label} · 파일 없음`);
    playButton.setAttribute("aria-label", `재생: ${sound.label}`);
    const editButton = createIconButton("scissors", "사운드 편집");
    const deleteButton = createIconButton("trash-2", "사운드 삭제", true);

    playButton.disabled = !sound.exists;
    editButton.disabled = !sound.exists;
    playButton.addEventListener("click", () => playUrl(sound.fileUrl).catch(() => setStatus("사운드 재생 실패", "error")));
    editButton.addEventListener("click", () => openSoundEditor(sound));
    deleteButton.addEventListener("click", async () => {
      state = await VOICEBOARD.deleteSound(sound.id);
      render();
      setStatus("사운드 삭제됨");
    });

    item.append(playButton, editButton, deleteButton);
    dom.soundGrid.append(item);
  });
}

function render() {
  updateControlValues();
  renderPhrases();
  renderSounds();
  refreshIcons();
}

function bindEvents() {
  dom.azureSettingsButton.addEventListener("click", openAzureSettings);
  dom.closeAzureSettingsButton.addEventListener("click", closeAzureSettings);
  dom.saveAzureSettingsButton.addEventListener("click", () => updateAzureConnection("save"));
  dom.testAzureConnectionButton.addEventListener("click", () => updateAzureConnection("test"));
  dom.deleteAzureSettingsButton.addEventListener("click", () => updateAzureConnection("delete"));
  dom.openAzurePortalButton.addEventListener("click", () => VOICEBOARD.openAzurePortal().catch(() => renderAzureStatus("Azure 포털을 열지 못했습니다.", true)));
  dom.azureSettingsModal.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAzureSettings(); }
    if (event.key === "Tab") {
      const controls = [...dom.azureSettingsModal.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  dom.previousSoundsButton.addEventListener("click", () => { soundPage--; renderSounds(); refreshIcons(); });
  dom.nextSoundsButton.addEventListener("click", () => { soundPage++; renderSounds(); refreshIcons(); });
  compactSounds?.addEventListener("change", () => { soundPage = 0; renderSounds(); refreshIcons(); });
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
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.repeat
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
      event.stopPropagation();
      closeSoundEditor();
    }
  });

  dom.outputDeviceSelect.addEventListener("change", () =>
    saveSettings({ outputDeviceId: dom.outputDeviceSelect.value })
  );
  dom.masterVolumeInput.addEventListener("input", () =>
    savePlaybackSettings({ masterVolume: Number(dom.masterVolumeInput.value) })
  );
  dom.monitorVolumeInput.addEventListener("input", () =>
    savePlaybackSettings({ monitorVolume: Number(dom.monitorVolumeInput.value) })
  );
  dom.monitorEnabledInput.addEventListener("change", () =>
    savePlaybackSettings({ monitorEnabled: dom.monitorEnabledInput.checked })
  );
  dom.closeToTrayInput.addEventListener("change", async () => {
    dom.closeToTrayInput.disabled = true;
    try {
      await saveSettings({ closeToTray: dom.closeToTrayInput.checked });
      setStatus(state.settings.closeToTray ? "백그라운드 실행 켜짐" : "백그라운드 실행 꺼짐");
    } catch (error) {
      updateControlValues();
      setStatus("백그라운드 실행 설정 실패", "error");
    } finally { dom.closeToTrayInput.disabled = false; }
  });
  dom.engineSelect.addEventListener("change", async () => {
    const ttsEngine = dom.engineSelect.value;
    const azureOnly = /^ko-KR-(JiMin|SeoHyeon|SoonBok|YuJin)Neural$/.test(state.settings.voice);
    try { await saveSettings({ ttsEngine, voice: ttsEngine !== "azure" && azureOnly ? "ko-KR-SunHiNeural" : state.settings.voice }); }
    catch { updateControlValues(); setStatus("엔진 설정 저장 실패", "error"); }
  });
  dom.voiceSelect.addEventListener("change", () => saveSettings({ voice: dom.voiceSelect.value }));
  dom.rateInput.addEventListener("input", () => saveSettings({ rate: Number(dom.rateInput.value) }));
  dom.pitchInput.addEventListener("input", () =>
    saveSettings({ pitch: Number(dom.pitchInput.value) })
  );
  dom.ttsVolumeInput.addEventListener("input", () =>
    saveSettings({ ttsVolume: Number(dom.ttsVolumeInput.value) })
  );

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
  VOICEBOARD.onShortcutStatus?.(({ registered }) => {
    if (!registered) setStatus("Space+Enter를 사용할 수 없습니다 · 앱을 다시 실행해 주세요", "error");
  });
  VOICEBOARD.onOverlaySpeak?.(async ({ id, text }) => {
    try {
      const result = await speakText(text);
      VOICEBOARD.overlayResult({ id, ok: Boolean(result?.ok), message: result?.message });
    } catch {
      VOICEBOARD.overlayResult({ id, ok: false });
    }
  });
  const overlayStatus = await VOICEBOARD.overlayReady?.();
  await checkCableInstallation();
  if (overlayStatus?.startupWarning) {
    setStatus(overlayStatus.startupWarning, "error");
  } else if (overlayStatus && !overlayStatus.registered) {
    setStatus("Space+Enter를 사용할 수 없습니다 · 앱을 다시 실행해 주세요", "error");
  }
}

init().catch((error) => {
  console.error(error);
  setStatus("초기화 실패", "error");
});
