class MicTestController {
  constructor() {
    this.modal = document.querySelector('#mic-test-modal');
    this.startButton = document.querySelector('#mic-test-start');
    this.closeButtons = [document.querySelector('#mic-test-close'), document.querySelector('#mic-test-close-x')];
    this.deviceSelect = document.querySelector('#test-device-select');
    this.statusDot = document.querySelector('#test-status-dot');
    this.statusText = document.querySelector('#test-status-text');
    this.levelText = document.querySelector('#test-level-text');
    this.meterFill = document.querySelector('#test-meter-fill');
    this.transcript = document.querySelector('#test-transcript');
    this.active = false;

    this.startButton.addEventListener('click', () => this.toggle());
    this.closeButtons.forEach((button) => button.addEventListener('click', () => this.close()));
    this.deviceSelect.addEventListener('change', () => this.changeDevice());
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
  }

  open() {
    this.modal.classList.remove('is-hidden');
    this.setStatus('ready', '테스트 대기 중');
    this.transcript.textContent = '아직 인식된 목소리가 없습니다.';
    this.levelText.textContent = '입력 레벨 0%';
    this.meterFill.style.width = '0%';
    this.refreshDevices(false);
  }

  close() {
    this.stop(false);
    this.modal.classList.add('is-hidden');
  }

  async toggle() {
    if (this.active) {
      this.stop(true);
      return;
    }
    await this.start();
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('error', '이 브라우저에서는 마이크를 사용할 수 없습니다.');
      return;
    }

    this.startButton.disabled = true;
    this.setStatus('listening', '마이크 권한을 확인하는 중');
    try {
      const selectedDeviceId = this.deviceSelect.value;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        },
      });
      this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      source.connect(this.analyser);
      this.active = true;
      this.startButton.disabled = false;
      this.startButton.textContent = '테스트 종료';
      this.startButton.classList.add('recording');
      await this.refreshDevices(true);
      this.setStatus('listening', '듣는 중 — 테스트 문장을 말하세요');
      this.measure();
      this.startSpeechRecognition();
    } catch (error) {
      this.startButton.disabled = false;
      this.setStatus('error', '마이크 권한 또는 장치를 확인하세요');
      this.transcript.textContent = '마이크를 열지 못했습니다. 주소창 왼쪽의 권한 설정을 확인하세요.';
    }
  }

  startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.transcript.textContent = '이 브라우저는 문장 인식을 지원하지 않지만 입력 음량은 확인할 수 있습니다.';
      return;
    }
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'ko-KR';
    this.recognition.interimResults = true;
    this.recognition.continuous = false;
    this.recognition.onresult = (event) => {
      const value = Array.from(event.results).map((result) => result[0].transcript).join(' ').trim();
      if (value) {
        this.transcript.textContent = `“${value}”`;
        this.setStatus('detected', '목소리와 문장 인식이 정상입니다');
      }
    };
    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        this.transcript.textContent = '문장이 인식되지 않았습니다. 테스트 종료 후 다시 시작해 보세요.';
      } else if (event.error !== 'aborted') {
        this.transcript.textContent = `음성 인식 오류: ${event.error}`;
      }
    };
    this.recognition.start();
  }

  measure() {
    if (!this.active || !this.analyser) return;
    const values = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(values);
    let sum = 0;
    for (const value of values) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / values.length);
    const level = Math.min(100, Math.round(rms * 720));
    this.meterFill.style.width = `${level}%`;
    this.levelText.textContent = `입력 레벨 ${level}%`;
    if (rms > .018 && !this.transcript.textContent.startsWith('“')) this.setStatus('detected', '목소리 입력이 감지되었습니다');
    this.frame = requestAnimationFrame(() => this.measure());
  }

  async refreshDevices(hasPermission = Boolean(this.stream)) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
      const activeTrack = this.stream?.getAudioTracks?.()[0];
      const activeDeviceId = activeTrack?.getSettings?.().deviceId || this.deviceSelect.value;
      this.deviceSelect.replaceChildren();
      if (!devices.length) {
        this.deviceSelect.add(new Option('사용 가능한 마이크 없음', ''));
        this.deviceSelect.disabled = true;
        return;
      }
      devices.forEach((device, index) => this.deviceSelect.add(new Option(device.label || `마이크 ${index + 1}`, device.deviceId)));
      const labelsVisible = devices.some((device) => device.label);
      this.deviceSelect.disabled = !(hasPermission || labelsVisible);
      if (activeDeviceId && devices.some((device) => device.deviceId === activeDeviceId)) this.deviceSelect.value = activeDeviceId;
      const activeLabel = activeTrack?.label || this.deviceSelect.selectedOptions[0]?.textContent;
      if (activeLabel && hasPermission) this.deviceSelect.title = `현재 사용 중: ${activeLabel}`;
    } catch (error) {
      this.deviceSelect.replaceChildren(new Option('장치 목록을 불러오지 못함', ''));
      this.deviceSelect.disabled = true;
    }
  }

  async changeDevice() {
    const shouldRestart = this.active;
    this.stop(false);
    if (shouldRestart) await this.start();
  }

  stop(showStatus = true) {
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.recognition?.abort?.();
    this.recognition = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser?.disconnect?.();
    this.analyser = null;
    this.audioContext?.close?.();
    this.audioContext = null;
    this.startButton.disabled = false;
    this.startButton.textContent = '마이크 테스트 시작';
    this.startButton.classList.remove('recording');
    this.meterFill.style.width = '0%';
    this.levelText.textContent = '입력 레벨 0%';
    if (showStatus) this.setStatus('ready', '테스트가 종료되었습니다');
  }

  setStatus(state, label) {
    this.statusDot.className = 'test-status-dot';
    if (state !== 'ready') this.statusDot.classList.add(state);
    this.statusText.textContent = label;
  }
}
