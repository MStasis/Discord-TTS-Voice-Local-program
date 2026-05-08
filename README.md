# Voiceboard

Windows PC에서 Discord 봇 없이 TTS와 사운드보드를 음성 입력으로 보내는 로컬 데스크톱 앱입니다.

앱의 `세팅` 버튼을 누르면 Voiceboard 출력은 `CABLE Input`으로 바뀌고, Windows 기본 녹음/통신 마이크는 `CABLE Output`으로 바뀝니다. Discord 입력 장치를 `Default`로 두면 이 변경을 따라갑니다. `해제` 버튼은 세팅 전의 Windows 기본 마이크로 되돌리고 Voiceboard 출력도 시스템 기본 출력으로 돌립니다.

VB-CABLE이 설치되어 있지 않으면 앱 시작 시 설치 안내창이 표시됩니다. 안내창의 다운로드 버튼은 공식 VB-Audio 페이지인 `https://vb-audio.com/Cable/`를 엽니다.

## 기능

- Discord 봇 없이 사용자의 PC에서만 동작
- 오디오 출력 장치 선택
- `세팅`/`해제` 버튼으로 VB-CABLE 라우팅 전환
- VB-CABLE 미설치 시 시작 안내창 표시
- Discord 송출 볼륨과 내 듣기 모니터링 분리
- Microsoft Edge Neural TTS 프로토콜 기반 여성 음성 기본값: `ko-KR-SunHiNeural`
- Windows 내장 음성 로컬 엔진 선택 및 Neural TTS 실패 시 fallback
- 자주 쓰는 문장 저장, 삭제, 버튼 실행
- 사운드 파일 가져오기, 삭제, 버튼 실행
- 앱 데이터 보관함 자동 관리

## 참고

기본 TTS는 Microsoft Edge의 온라인 Neural TTS 엔드포인트를 사용하므로 인터넷 연결이 필요합니다. 앱에서 `Windows Local` 엔진을 고르면 Windows에 설치된 로컬 음성으로 WAV를 생성합니다. Discord가 입력 장치를 `Default`가 아닌 특정 장치로 고정해 둔 경우에는 Windows 기본 마이크 변경을 따라오지 않을 수 있습니다.

`내 듣기`가 켜져 있으면 앱이 같은 소리를 기본 스피커로 따로 재생합니다. 이 경로는 `Discord 송출 볼륨`의 영향을 받지 않습니다. Windows의 `이 장치로 듣기` 기능이나 VoiceMeeter 자체 모니터링으로 CABLE Output을 듣고 있다면 그 소리는 케이블 신호 자체를 듣는 것이므로 송출 볼륨과 같이 줄어들 수 있습니다.
