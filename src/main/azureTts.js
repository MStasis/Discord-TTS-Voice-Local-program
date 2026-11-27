function azureError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function normalizeAzureCredentials(credentials) {
  if (!credentials || !credentials.key) {
    throw azureError("AZURE_NOT_CONFIGURED", "설정에서 Azure 키와 지역을 저장해 주세요.");
  }
  const region = String(credentials.region || "").trim().toLowerCase();
  const key = String(credentials.key).trim();
  if (!/^[a-z][a-z0-9]{1,39}$/.test(region)) {
    throw azureError("AZURE_INVALID_REGION", "Azure 지역 코드를 확인해 주세요. 예: koreacentral");
  }
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(key)) {
    throw azureError("AZURE_INVALID_KEY", "Azure Speech 리소스의 키를 확인해 주세요.");
  }
  return { region, key };
}

async function readBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw azureError("AZURE_EMPTY_RESPONSE", "Azure에서 응답 내용을 받지 못했습니다.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw azureError("AZURE_RESPONSE_TOO_LARGE", "문장을 더 짧게 나누어 전송해 주세요.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function requestAzure({ credentials, ssml, fetchImpl = globalThis.fetch }) {
  const { region, key } = normalizeAzureCredentials(credentials);
  const isSynthesis = typeof ssml === "string";
  const suffix = isSynthesis ? "v1" : "voices/list";
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/${suffix}`;
  try {
    const response = await fetchImpl(url, {
      method: isSynthesis ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "User-Agent": "Voiceboard",
        ...(isSynthesis ? {
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3"
        } : {})
      },
      ...(isSynthesis ? { body: ssml } : {})
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw azureError("AZURE_AUTH_FAILED", "Azure 키·지역·리소스 권한을 확인해 주세요.");
      }
      if (response.status === 429) {
        throw azureError("AZURE_RATE_LIMIT", "Azure 사용 한도 또는 요청 횟수 제한입니다. 잠시 후 다시 시도해 주세요.");
      }
      if (response.status === 400) {
        throw azureError("AZURE_BAD_REQUEST", "Azure에서 문장 또는 선택한 목소리를 처리하지 못했습니다.");
      }
      throw azureError("AZURE_UNAVAILABLE", `Azure 연결 오류 (${response.status}) · 다른 목소리로 전환하지 않았습니다.`);
    }
    const buffer = await readBody(response, isSynthesis ? 8 * 1024 * 1024 : 2 * 1024 * 1024);
    if (isSynthesis) {
      const contentType = response.headers.get("content-type") || "";
      const isMp3 = buffer.length >= 3 && (
        buffer.subarray(0, 3).toString("ascii") === "ID3" ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
      );
      if (!contentType.toLowerCase().startsWith("audio/") || !isMp3) {
        throw azureError("AZURE_INVALID_AUDIO", "Azure에서 재생 가능한 MP3 음성을 받지 못했습니다.");
      }
      return buffer;
    }
    let voices;
    try { voices = JSON.parse(buffer.toString("utf8")); }
    catch { throw azureError("AZURE_INVALID_RESPONSE", "Azure 목소리 목록 응답을 확인하지 못했습니다."); }
    if (!Array.isArray(voices) || !voices.some((voice) => typeof voice.ShortName === "string")) {
      throw azureError("AZURE_INVALID_RESPONSE", "Azure 목소리 목록 응답을 확인하지 못했습니다.");
    }
    return { ok: true, koreanVoices: voices.filter((voice) => voice.Locale === "ko-KR").length };
  } catch (error) {
    if (error.code?.startsWith("AZURE_")) throw error;
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw azureError("AZURE_TIMEOUT", "Azure 응답 시간이 초과되었습니다. 다시 시도해 주세요.");
    }
    // Never echo response bodies, request headers, or raw transport errors containing credentials.
    throw azureError("AZURE_NETWORK_ERROR", "Azure에 연결하지 못했습니다. 인터넷 연결과 지역을 확인해 주세요.");
  }
}

const synthesizeAzureAudio = (options) => requestAzure(options);
const checkAzureConnection = (options) => requestAzure({ ...options, ssml: undefined });

module.exports = { azureError, normalizeAzureCredentials, synthesizeAzureAudio, checkAzureConnection };
