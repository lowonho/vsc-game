class VoiceController {
  constructor() {
    this.panel = document.querySelector('#voice-panel');
    this.line = document.querySelector('#voice-line');
    this.hint = document.querySelector('#voice-hint');
    this.kicker = document.querySelector('#voice-kicker');
    this.micButton = document.querySelector('#mic-button');
    this.micLabel = document.querySelector('#mic-label');
    this.fallbackButton = document.querySelector('#fallback-button');
    this.meterFill = document.querySelector('#meter-fill');
    this.statusDot = document.querySelector('#mic-status-dot');
    this.statusText = document.querySelector('#mic-status-text');
    this.micSelect = document.querySelector('#mic-device-select');
    this.stagePrompt = document.querySelector('#stage-prompt');
    this.stagePromptContext = document.querySelector('#stage-prompt-context');
    this.stagePromptLine = document.querySelector('#stage-prompt-line');
    this.stagePromptHint = document.querySelector('#stage-prompt-hint');
    this.gameFrame = document.querySelector('.game-frame');
    this.activeRequest = null;
    this.recording = false;
    this.silenceTimeoutMs = 5000;
    this.micButton.addEventListener('click', () => this.toggleRecording());
    this.fallbackButton.addEventListener('click', () => this.useFallback());
    this.micSelect.addEventListener('change', () => this.switchMicrophone());
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
  }

  request(config) {
    this.cancel('replaced');
    this.enterStage(config);
    this.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return new Promise((resolve) => {
      this.activeRequest = { config, resolve };
    });
  }

  enterStage(config = {}) {
    const expected = config.expected ?? '잠시 후 말할 대사가 표시됩니다.';
    const kicker = config.kicker ?? '마이크 사용 준비';
    const hint = config.hint ?? '대사가 표시되면 아래 버튼을 눌러 말하세요.';
    this.gameFrame.classList.add('stage-mode');
    this.panel.classList.remove('is-hidden');
    this.stagePrompt.classList.add('is-hidden');
    this.kicker.textContent = kicker;
    this.line.textContent = `“${expected}”`;
    this.hint.textContent = hint;
    this.stagePromptContext.textContent = kicker;
    this.stagePromptLine.textContent = `“${expected}”`;
    this.stagePromptHint.textContent = hint;
    this.micLabel.textContent = '마이크 켜고 말하기';
    this.setStatus('ready', '말하기 버튼을 누르세요');
  }

  hideStageUi() {
    this.panel.classList.add('is-hidden');
    this.stagePrompt.classList.add('is-hidden');
  }

  leaveStage() {
    this.gameFrame.classList.remove('stage-mode');
    this.hideStageUi();
  }

  async toggleRecording() {
    if (!this.activeRequest) return;
    if (this.recording) {
      this.recognition?.stop();
      return;
    }
    await this.startRecording();
  }

  async ensureAudio() {
    if (this.stream) return;
    this.audioContext ??= new AudioContext();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    const selectedDeviceId = this.micSelect.value;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
      },
    });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    await this.refreshDevices();
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    const activeTrack = this.stream?.getAudioTracks?.()[0];
    const activeDeviceId = activeTrack?.getSettings?.().deviceId ?? this.micSelect.value;
    this.micSelect.replaceChildren();
    if (!devices.length) {
      this.micSelect.add(new Option('사용 가능한 마이크 없음', ''));
      this.micSelect.disabled = true;
      return;
    }
    devices.forEach((device, index) => {
      const label = device.label || `마이크 ${index + 1}`;
      this.micSelect.add(new Option(label, device.deviceId));
    });
    this.micSelect.disabled = false;
    if (activeDeviceId && devices.some((device) => device.deviceId === activeDeviceId)) this.micSelect.value = activeDeviceId;
    const activeLabel = activeTrack?.label || this.micSelect.selectedOptions[0]?.textContent || '기본 마이크';
    this.micSelect.title = `현재 사용 중: ${activeLabel}`;
  }

  async switchMicrophone() {
    if (this.recording) return;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser?.disconnect?.();
    try {
      await this.ensureAudio();
      const label = this.stream?.getAudioTracks?.()[0]?.label || this.micSelect.selectedOptions[0]?.textContent || '선택한 마이크';
      this.setStatus('detected', `${label} 연결됨`);
    } catch (error) {
      this.setStatus('error', '마이크 변경 실패');
      this.hint.textContent = '선택한 마이크를 열 수 없습니다. 브라우저 권한을 확인하세요.';
    }
  }

  async startRecording() {
    const request = this.activeRequest;
    if (!request) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !navigator.mediaDevices?.getUserMedia) {
      this.hint.textContent = '이 브라우저에서는 음성 입력을 지원하지 않습니다. 키보드 테스트를 이용하세요.';
      this.setStatus('error', '음성 입력 미지원');
      return;
    }

    try {
      await this.ensureAudio();
    } catch (error) {
      this.hint.textContent = '마이크 권한을 확인한 뒤 다시 시도하거나 키보드 테스트를 이용하세요.';
      this.setStatus('error', '마이크 권한 필요');
      return;
    }

    this.recording = true;
    this.micSelect.disabled = true;
    this.samples = [];
    this.transcript = '';
    this.voiceDetected = false;
    this.detectedFrames = 0;
    this.startedAt = performance.now();
    this.startTiming = request.config.timingProvider?.() ?? 1;
    request.config.onStart?.();
    this.micButton.classList.add('recording');
    this.micLabel.textContent = '말하는 중…';
    this.hint.textContent = '5초 안에 말해 주세요. 입력이 없으면 자동으로 초기화됩니다.';
    this.setStatus('listening', '듣는 중 — 5초 안에 말해 주세요');

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'ko-KR';
    this.recognition.interimResults = true;
    this.recognition.continuous = false;
    this.recognition.maxAlternatives = 3;
    this.recognition.onresult = (event) => {
      this.transcript = Array.from(event.results).map((result) => result[0].transcript).join(' ');
      this.hint.textContent = this.transcript || '듣고 있어요…';
      if (this.transcript) {
        this.markVoiceDetected('음성 인식 확인됨');
      }
    };
    this.recognition.onerror = (event) => {
      if (event.error !== 'aborted') this.lastSpeechError = event.error;
    };
    this.recognition.onend = () => this.finishRecording();
    this.recognition.start();
    this.measureVolume();
    clearTimeout(this.silenceTimer);
    this.silenceTimer = window.setTimeout(() => this.resetSilentRecording(), this.silenceTimeoutMs);
    this.maxTimer = window.setTimeout(() => this.recognition?.stop(), 6500);
  }

  markVoiceDetected(label = '목소리 입력 확인됨') {
    if (this.voiceDetected) return;
    this.voiceDetected = true;
    clearTimeout(this.silenceTimer);
    this.setStatus('detected', label);
  }

  resetSilentRecording() {
    if (!this.recording || this.voiceDetected) return;
    this.recording = false;
    clearTimeout(this.maxTimer);
    clearTimeout(this.silenceTimer);
    cancelAnimationFrame(this.volumeFrame);
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.abort();
    }
    this.samples = [];
    this.transcript = '';
    this.micButton.classList.remove('recording');
    this.micLabel.textContent = '마이크 켜고 말하기';
    this.micSelect.disabled = false;
    this.meterFill.style.width = '2%';
    this.hint.textContent = '5초 동안 입력이 없어 초기화되었습니다. 버튼을 눌러 다시 말해 주세요.';
    this.setStatus('ready', '입력 없음 · 다시 말하기');
  }

  measureVolume() {
    if (!this.recording || !this.analyser) return;
    const values = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(values);
    let sum = 0;
    for (const value of values) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / values.length);
    this.samples.push(rms);
    this.meterFill.style.width = `${Math.min(100, 4 + rms * 720)}%`;
    if (rms > .025) {
      this.detectedFrames += 1;
      if (this.detectedFrames >= 3) this.markVoiceDetected();
    } else {
      this.detectedFrames = 0;
    }
    this.volumeFrame = requestAnimationFrame(() => this.measureVolume());
  }

  finishRecording() {
    if (!this.recording) return;
    this.recording = false;
    clearTimeout(this.maxTimer);
    clearTimeout(this.silenceTimer);
    cancelAnimationFrame(this.volumeFrame);
    const duration = Math.max(.4, (performance.now() - this.startedAt) / 1000);
    const sorted = [...this.samples].sort((a, b) => a - b);
    const useful = sorted.slice(Math.floor(sorted.length * .18));
    const rms = useful.reduce((sum, value) => sum + value, 0) / Math.max(1, useful.length);
    const volume = Math.min(1, rms * 9.5);
    const request = this.activeRequest;
    this.micButton.classList.remove('recording');
    this.micLabel.textContent = '마이크 켜고 말하기';
    this.micSelect.disabled = false;
    this.meterFill.style.width = '2%';
    this.activeRequest = null;
    this.hideStageUi();
    const status = this.transcript.trim() ? 'ok' : this.lastSpeechError ? 'speech-error' : 'no-speech';
    request?.resolve({ status, transcript: this.transcript.trim(), volume, duration, timing: this.startTiming, error: this.lastSpeechError });
    this.lastSpeechError = null;
  }

  useFallback() {
    const request = this.activeRequest;
    if (!request) return;
    const answer = window.prompt('테스트할 연기 강도를 입력하세요.\n1: 약하게  2: 상황에 맞게  3: 과하게', '2');
    if (!['1', '2', '3'].includes(answer)) return;
    const target = request.config.profile?.targetVolume ?? .5;
    const volume = answer === '1' ? Math.max(.02, target - .48) : answer === '3' ? Math.min(1, target + .5) : target;
    const timing = request.config.timingProvider?.() ?? 1;
    request.config.onStart?.();
    this.activeRequest = null;
    this.hideStageUi();
    request.resolve({
      status: 'ok', transcript: request.config.expected, volume,
      duration: Math.max(.8, request.config.expected.replace(/\s/g, '').length / (request.config.profile?.targetCps ?? 4.5)),
      timing, simulated: true,
    });
  }

  setStatus(state, label) {
    this.statusDot.className = 'mic-status-dot';
    if (state !== 'ready') this.statusDot.classList.add(state);
    this.statusText.textContent = label;
  }

  cancel(reason = 'cancelled') {
    this.leaveStage();
    clearTimeout(this.maxTimer);
    clearTimeout(this.silenceTimer);
    cancelAnimationFrame(this.volumeFrame);
    if (!this.activeRequest) return;
    const request = this.activeRequest;
    this.activeRequest = null;
    if (this.recording) {
      this.recognition?.abort();
      this.recording = false;
      this.micSelect.disabled = false;
    }
    request.resolve({ status: reason });
  }
}
