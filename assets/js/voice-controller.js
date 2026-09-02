class VoiceController {
  constructor() {
    this.panel = document.querySelector('#voice-panel');
    this.line = document.querySelector('#voice-line');
    this.hint = document.querySelector('#voice-hint');
    this.kicker = document.querySelector('#voice-kicker');
    this.micState = document.querySelector('#mic-auto-status');
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
    this.requestId = 0;
    this.cycleId = 0;
    this.audioPromise = null;
    this.audioTrack = null;
    this.trackEndedHandler = null;
    this.silenceTimeoutMs = 5000;
    this.fallbackButton.addEventListener('click', () => this.useFallback('2'));
    this.micSelect.addEventListener('change', () => this.switchMicrophone());
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
    window.addEventListener?.('pointerdown', () => this.resumeAudioContext(), { passive: true });
    window.addEventListener?.('keydown', () => this.resumeAudioContext());
    window.addEventListener?.('keydown', (event) => this.handleFallbackKey(event), true);
  }

  request(config) {
    this.cancel('replaced');
    this.enterStage(config);
    return new Promise((resolve) => {
      const request = { config, resolve, id: ++this.requestId, starting: false, started: false };
      this.activeRequest = request;
      void this.startRecording(request);
    });
  }

  enterStage(config = {}) {
    const expected = config.expected ?? '잠시 후 말할 대사가 표시됩니다.';
    const kicker = config.kicker ?? '마이크 사용 준비';
    const hint = config.hint ?? '대사가 표시되면 마이크가 자동으로 듣기 시작합니다.';
    this.gameFrame.classList.add('stage-mode');
    this.panel.classList.remove('is-hidden');
    this.stagePrompt.classList.add('is-hidden');
    this.kicker.textContent = kicker;
    this.line.textContent = `“${expected}”`;
    this.hint.textContent = hint;
    this.stagePromptContext.textContent = kicker;
    this.stagePromptLine.textContent = `“${expected}”`;
    this.stagePromptHint.textContent = hint;
    this.micLabel.textContent = '마이크 자동 연결 중';
    this.setStatus('ready', '대사가 시작되면 자동으로 듣습니다');
  }

  hideStageUi() {
    this.panel.classList.add('is-hidden');
    this.stagePrompt.classList.add('is-hidden');
  }

  leaveStage() {
    this.gameFrame.classList.remove('stage-mode');
    this.hideStageUi();
  }

  async ensureAudio() {
    const hasLiveTrack = this.stream?.getAudioTracks?.().some((track) => track.readyState === 'live');
    if (hasLiveTrack && this.analyser) {
      this.resumeAudioContext();
      return;
    }
    if (this.audioPromise) return this.audioPromise;

    this.audioPromise = (async () => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('AudioContextUnavailable');
      if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new AudioContextClass();
      if (this.stream) this.releaseAudioStream();
      this.resumeAudioContext();
      const selectedDeviceId = this.micSelect.value;
      const audioOptions = (deviceId = '') => ({
        echoCancellation: true,
        noiseSuppression: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      });
      try {
        this.stream = await this.getUserMediaWithTimeout({ audio: audioOptions(selectedDeviceId) });
      } catch (error) {
        const selectedDeviceMissing = selectedDeviceId && ['OverconstrainedError', 'NotFoundError'].includes(error?.name);
        if (!selectedDeviceMissing) throw error;
        this.micSelect.value = '';
        this.stream = await this.getUserMediaWithTimeout({ audio: audioOptions() });
      }
      this.source?.disconnect?.();
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      this.watchAudioTrack(this.stream.getAudioTracks?.()[0]);
      this.resumeAudioContext();
      void this.refreshDevices().catch(() => {});
    })();

    try {
      await this.audioPromise;
    } finally {
      this.audioPromise = null;
    }
  }

  resumeAudioContext() {
    if (this.audioContext?.state !== 'suspended') return;
    try {
      const resumeResult = this.audioContext.resume();
      resumeResult?.catch?.(() => {});
    } catch (error) {
      // 음성 인식은 계속 사용하고, 다음 사용자 입력 때 음량 분석을 다시 활성화합니다.
    }
  }

  getUserMediaWithTimeout(constraints, timeoutMs = 6000) {
    const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        const error = new Error('Microphone connection timed out');
        error.name = 'MicrophoneTimeoutError';
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([mediaPromise, timeoutPromise]).then(
      (stream) => {
        clearTimeout(timeoutId);
        return stream;
      },
      (error) => {
        clearTimeout(timeoutId);
        if (error?.name === 'MicrophoneTimeoutError') {
          mediaPromise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {});
        }
        throw error;
      },
    );
  }

  watchAudioTrack(track) {
    this.detachAudioTrackWatcher();
    if (!track) return;
    this.audioTrack = track;
    this.trackEndedHandler = () => {
      if (track !== this.audioTrack) return;
      const request = this.activeRequest;
      this.detachAudioTrackWatcher();
      this.stopRecognitionCycle();
      this.releaseAudioStream();
      if (request === this.activeRequest) {
        this.hint.textContent = '마이크 연결이 끊겨 자동으로 다시 연결합니다. 같은 대사를 유지합니다.';
        this.setStatus('ready', '마이크 자동 재연결 중');
        this.micLabel.textContent = '마이크 자동 재연결 중';
        this.scheduleRestart(request, 700);
      }
    };
    track.addEventListener?.('ended', this.trackEndedHandler, { once: true });
  }

  detachAudioTrackWatcher() {
    this.audioTrack?.removeEventListener?.('ended', this.trackEndedHandler);
    this.audioTrack = null;
    this.trackEndedHandler = null;
  }

  releaseAudioStream() {
    this.detachAudioTrackWatcher();
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.source?.disconnect?.();
    this.source = null;
    this.analyser?.disconnect?.();
    this.analyser = null;
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
    const request = this.activeRequest;
    clearTimeout(this.restartTimer);
    this.stopRecognitionCycle();
    this.releaseAudioStream();
    this.micLabel.textContent = '마이크 변경 중';
    this.setStatus('listening', '선택한 마이크에 연결하는 중');
    try {
      await this.ensureAudio();
      const label = this.stream?.getAudioTracks?.()[0]?.label || this.micSelect.selectedOptions[0]?.textContent || '선택한 마이크';
      this.setStatus('detected', `${label} 연결됨`);
      this.micLabel.textContent = '마이크 자동 듣기 준비';
      if (request === this.activeRequest) this.scheduleRestart(request, 250);
    } catch (error) {
      this.setStatus('error', '마이크 변경 실패');
      this.hint.textContent = '선택한 마이크를 열 수 없습니다. 브라우저 권한을 확인하세요.';
      this.micLabel.textContent = '마이크 연결 확인 필요';
      const permissionBlocked = ['NotAllowedError', 'SecurityError'].includes(error?.name);
      if (!permissionBlocked && request === this.activeRequest) this.scheduleRestart(request, 1500);
    }
  }

  showMicrophoneError(error) {
    const name = error?.name ?? error;
    if (['NotAllowedError', 'SecurityError', 'not-allowed', 'service-not-allowed'].includes(name)) {
      this.hint.textContent = '주소창 왼쪽의 마이크 권한을 허용한 뒤 새로고침하세요. 키보드 테스트도 사용할 수 있습니다.';
      this.setStatus('error', '마이크 권한이 차단됨');
      this.micLabel.textContent = '마이크 권한 확인 필요';
      return;
    }
    if (name === 'NotFoundError') {
      this.hint.textContent = '사용 가능한 마이크를 찾지 못했습니다. 마이크 연결 상태를 확인하세요.';
      this.setStatus('error', '마이크 장치 없음');
      this.micLabel.textContent = '마이크 연결 필요';
      return;
    }
    if (['NotReadableError', 'AbortError', 'audio-capture'].includes(name)) {
      this.hint.textContent = '다른 프로그램이 마이크를 사용 중일 수 있습니다. 자동으로 다시 연결합니다. 키보드 1·2·3 또는 Enter로도 진행할 수 있습니다.';
      this.setStatus('error', '마이크를 열 수 없음');
      this.micLabel.textContent = '마이크 자동 재연결 대기';
      return;
    }
    if (name === 'MicrophoneTimeoutError') {
      this.hint.textContent = '마이크 연결 응답이 늦어 자동으로 다시 연결합니다. 키보드 1·2·3 또는 Enter로도 진행할 수 있습니다.';
      this.setStatus('error', '마이크 연결 지연');
      this.micLabel.textContent = '마이크 자동 재연결 대기';
      return;
    }
    this.hint.textContent = '마이크 연결을 확인한 뒤 새로고침하거나 키보드 테스트를 이용하세요.';
    this.setStatus('error', '마이크 연결 실패');
    this.micLabel.textContent = '마이크 연결 확인 필요';
  }

  isCurrentCycle(request, cycleId, recognition) {
    return request === this.activeRequest && cycleId === this.cycleId && recognition === this.recognition;
  }

  stopRecognitionCycle() {
    this.cycleId += 1;
    this.recording = false;
    clearTimeout(this.maxTimer);
    clearTimeout(this.silenceTimer);
    clearTimeout(this.recognitionStartTimer);
    clearTimeout(this.cycleWatchdogTimer);
    cancelAnimationFrame(this.volumeFrame);
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      try {
        recognition.abort();
      } catch (error) {
        // 이미 종료된 음성 인식은 추가로 중단할 필요가 없습니다.
      }
    }
    this.micState.classList.remove('listening', 'detected', 'error');
    this.meterFill.style.width = '2%';
  }

  scheduleRestart(request, delay = 500) {
    clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      if (request === this.activeRequest && !this.recording) void this.startRecording(request);
    }, delay);
  }

  startRecognitionWithActiveTrack(recognition) {
    const track = this.stream?.getAudioTracks?.()[0];
    if (track?.readyState === 'live') {
      try {
        recognition.start(track);
        return;
      } catch (error) {
        if (!['TypeError', 'NotSupportedError'].includes(error?.name)) throw error;
      }
    }
    recognition.start();
  }

  async startRecording(request = this.activeRequest) {
    if (!request || request !== this.activeRequest || this.recording || request.starting) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !navigator.mediaDevices?.getUserMedia) {
      this.hint.textContent = '이 브라우저에서는 음성 입력을 지원하지 않습니다. 키보드 테스트를 이용하세요.';
      this.setStatus('error', '음성 입력 미지원');
      this.micLabel.textContent = '자동 음성 인식 미지원';
      return;
    }

    request.starting = true;
    this.micLabel.textContent = '마이크 자동 연결 중';
    this.setStatus('listening', '마이크에 연결하는 중');
    try {
      await this.ensureAudio();
    } catch (error) {
      request.starting = false;
      if (request === this.activeRequest) {
        this.showMicrophoneError(error);
        const permissionBlocked = ['NotAllowedError', 'SecurityError'].includes(error?.name);
        if (!permissionBlocked) this.scheduleRestart(request, 1500);
      }
      return;
    }
    request.starting = false;
    if (request !== this.activeRequest) return;

    const cycleId = ++this.cycleId;
    this.recording = true;
    this.samples = [];
    this.transcript = '';
    this.voiceDetected = false;
    this.detectedFrames = 0;
    this.startedAt = null;
    this.speechEndedAt = null;
    this.startTiming = null;
    this.lastSpeechError = null;
    request.silenceStartedAt ??= performance.now();
    this.micLabel.textContent = '마이크 자동 듣기 중';
    this.hint.textContent = '마이크가 자동으로 듣고 있습니다. 5초 안에 대사를 말해 주세요.';
    this.setStatus('listening', '자동 듣는 중 — 대사를 말하세요');

    const recognition = new SpeechRecognition();
    this.recognition = recognition;
    let recognitionStarted = false;
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;
    recognition.onstart = () => {
      if (!this.isCurrentCycle(request, cycleId, recognition)) return;
      recognitionStarted = true;
      clearTimeout(this.recognitionStartTimer);
      this.micLabel.textContent = '마이크 자동 듣기 중';
      this.setStatus('listening', '자동 듣는 중 — 대사를 말하세요');
    };
    recognition.onspeechstart = () => {
      recognitionStarted = true;
      clearTimeout(this.recognitionStartTimer);
      this.markVoiceDetected('목소리 입력 확인됨', request, cycleId, recognition);
    };
    recognition.onspeechend = () => {
      if (this.isCurrentCycle(request, cycleId, recognition)) this.speechEndedAt = performance.now();
    };
    recognition.onresult = (event) => {
      if (!this.isCurrentCycle(request, cycleId, recognition)) return;
      recognitionStarted = true;
      clearTimeout(this.recognitionStartTimer);
      this.transcript = Array.from(event.results).map((result) => result[0].transcript).join(' ');
      this.hint.textContent = this.transcript || '듣고 있어요…';
      if (this.transcript) this.markVoiceDetected('음성 인식 확인됨', request, cycleId, recognition);
    };
    recognition.onerror = (event) => {
      if (!this.isCurrentCycle(request, cycleId, recognition) || event.error === 'aborted') return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        this.stopRecognitionCycle();
        this.showMicrophoneError(event.error);
        if (event.error === 'audio-capture' && request === this.activeRequest) {
          this.releaseAudioStream();
          this.scheduleRestart(request, 1500);
        }
        return;
      }
      this.lastSpeechError = event.error;
    };
    recognition.onend = () => this.finishRecording(request, cycleId, recognition);
    this.recognitionStartTimer = window.setTimeout(() => {
      if (!this.isCurrentCycle(request, cycleId, recognition) || recognitionStarted) return;
      this.stopRecognitionCycle();
      this.hint.textContent = '음성 인식 시작이 늦어 자동으로 다시 연결합니다. 같은 대사를 말해 주세요.';
      this.setStatus('ready', '음성 인식 자동 재연결 중');
      this.micLabel.textContent = '마이크 자동 재연결 중';
      this.scheduleRestart(request, 700);
    }, 3500);
    this.cycleWatchdogTimer = window.setTimeout(() => {
      if (!this.isCurrentCycle(request, cycleId, recognition)) return;
      if (this.transcript.trim()) {
        this.finishRecording(request, cycleId, recognition);
        return;
      }
      this.stopRecognitionCycle();
      request.silenceStartedAt = null;
      this.hint.textContent = '음성 인식 응답이 멈춰 자동으로 초기화했습니다. 같은 대사를 다시 듣습니다.';
      this.setStatus('ready', '음성 인식 자동 초기화 중');
      this.micLabel.textContent = '마이크 자동 재연결 중';
      this.scheduleRestart(request, 700);
    }, 12000);
    try {
      this.startRecognitionWithActiveTrack(recognition);
    } catch (error) {
      if (!this.isCurrentCycle(request, cycleId, recognition)) return;
      this.stopRecognitionCycle();
      if (['NotAllowedError', 'SecurityError'].includes(error?.name)) {
        this.showMicrophoneError(error);
      } else {
        this.hint.textContent = '음성 인식을 다시 준비하고 있습니다.';
        this.setStatus('ready', '음성 인식 재연결 중');
        this.micLabel.textContent = '마이크 자동 재연결 중';
        this.scheduleRestart(request, 800);
      }
      return;
    }
    this.measureVolume(request, cycleId, recognition);
    clearTimeout(this.silenceTimer);
    const silenceRemaining = Math.max(0, this.silenceTimeoutMs - (performance.now() - request.silenceStartedAt));
    this.silenceTimer = window.setTimeout(
      () => this.resetSilentRecording(request, cycleId, recognition),
      silenceRemaining,
    );
  }

  markVoiceDetected(label = '목소리 입력 확인됨', request = this.activeRequest, cycleId = this.cycleId, recognition = this.recognition) {
    if (!this.isCurrentCycle(request, cycleId, recognition) || this.voiceDetected) return;
    this.voiceDetected = true;
    this.startedAt = performance.now();
    this.startTiming = request.config.timingProvider?.() ?? 1;
    this.samples = [];
    request.silenceStartedAt = null;
    if (!request.started) {
      request.started = true;
      request.config.onStart?.();
    }
    clearTimeout(this.silenceTimer);
    clearTimeout(this.maxTimer);
    this.maxTimer = window.setTimeout(() => {
      if (!this.isCurrentCycle(request, cycleId, recognition)) return;
      try {
        recognition.stop();
      } catch (error) {
        this.stopRecognitionCycle();
        this.hint.textContent = '음성 인식을 자동으로 다시 준비하고 있습니다.';
        this.setStatus('ready', '음성 인식 자동 재연결 중');
        this.micLabel.textContent = '마이크 자동 재연결 중';
        this.scheduleRestart(request, 700);
      }
    }, 6500);
    this.micLabel.textContent = '목소리 감지됨';
    this.setStatus('detected', label);
  }

  resetSilentRecording(request, cycleId, recognition) {
    if (!this.isCurrentCycle(request, cycleId, recognition) || !this.recording || this.voiceDetected) return;
    this.stopRecognitionCycle();
    this.samples = [];
    this.transcript = '';
    request.silenceStartedAt = null;
    this.micLabel.textContent = '마이크 자동 재대기 중';
    this.hint.textContent = '5초 동안 입력이 없어 점수 없이 초기화했습니다. 같은 대사를 자동으로 다시 듣습니다.';
    this.setStatus('ready', '입력 없음 · 자동으로 다시 듣는 중');
    this.scheduleRestart(request, 700);
  }

  measureVolume(request, cycleId, recognition) {
    if (!this.isCurrentCycle(request, cycleId, recognition) || !this.recording || !this.analyser) return;
    const values = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(values);
    let sum = 0;
    for (const value of values) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / values.length);
    this.meterFill.style.width = `${Math.min(100, 4 + rms * 720)}%`;
    if (rms > .025) {
      this.detectedFrames += 1;
      if (this.detectedFrames >= 3) this.markVoiceDetected('목소리 입력 확인됨', request, cycleId, recognition);
    } else {
      this.detectedFrames = 0;
    }
    if (this.voiceDetected) this.samples.push(rms);
    this.volumeFrame = requestAnimationFrame(() => this.measureVolume(request, cycleId, recognition));
  }

  finishRecording(request, cycleId, recognition) {
    if (!this.isCurrentCycle(request, cycleId, recognition) || !this.recording) return;
    const transcript = this.transcript.trim();
    const speechError = this.lastSpeechError;
    const silentEnd = !transcript && !this.voiceDetected && (!speechError || speechError === 'no-speech');
    if (silentEnd) {
      const silentFor = performance.now() - (request.silenceStartedAt ?? performance.now());
      if (silentFor < this.silenceTimeoutMs) {
        this.stopRecognitionCycle();
        this.micLabel.textContent = '마이크 자동 듣기 중';
        this.hint.textContent = '마이크가 자동으로 계속 듣고 있습니다.';
        this.setStatus('listening', '자동 듣는 중 — 대사를 말하세요');
        this.scheduleRestart(request, Math.min(300, this.silenceTimeoutMs - silentFor));
        return;
      }
      this.resetSilentRecording(request, cycleId, recognition);
      return;
    }
    const endedAt = this.speechEndedAt ?? performance.now();
    const duration = this.startedAt ? Math.max(.4, (endedAt - this.startedAt) / 1000) : .4;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const useful = sorted.slice(Math.floor(sorted.length * .18));
    const rms = useful.reduce((sum, value) => sum + value, 0) / Math.max(1, useful.length);
    const volume = Math.min(1, rms * 9.5);
    const timing = this.startTiming ?? 1;
    this.stopRecognitionCycle();
    this.micLabel.textContent = '마이크 자동 듣기 준비';
    this.activeRequest = null;
    this.hideStageUi();
    const status = transcript ? 'ok' : speechError && speechError !== 'no-speech' ? 'speech-error' : 'no-speech';
    request.resolve({ status, transcript, volume, duration, timing, error: speechError });
    this.lastSpeechError = null;
  }

  handleFallbackKey(event) {
    if (!this.activeRequest || event.repeat) return;
    const answer = event.key === 'Enter' ? '2' : event.key;
    if (!['1', '2', '3'].includes(answer)) return;
    const tagName = event.target?.tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tagName)) return;
    if (event.key === 'Enter' && tagName === 'BUTTON' && event.target !== this.fallbackButton) return;
    event.preventDefault();
    this.useFallback(answer);
  }

  useFallback(answer) {
    const request = this.activeRequest;
    if (!request) return;
    const selectedAnswer = ['1', '2', '3'].includes(answer) ? answer : '2';
    const target = request.config.profile?.targetVolume ?? .5;
    const volume = selectedAnswer === '1' ? Math.max(.02, target - .48) : selectedAnswer === '3' ? Math.min(1, target + .5) : target;
    const timing = this.startTiming ?? request.config.timingProvider?.() ?? 1;
    if (!request.started) {
      request.started = true;
      request.config.onStart?.();
    }
    clearTimeout(this.restartTimer);
    this.stopRecognitionCycle();
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
    this.micState.classList.remove('listening', 'detected', 'error');
    if (state !== 'ready') this.micState.classList.add(state);
    this.statusText.textContent = label;
  }

  cancel(reason = 'cancelled') {
    const request = this.activeRequest;
    this.activeRequest = null;
    this.requestId += 1;
    clearTimeout(this.restartTimer);
    this.stopRecognitionCycle();
    this.leaveStage();
    request?.resolve({ status: reason });
  }
}
