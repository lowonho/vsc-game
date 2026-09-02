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
    this.desiredActive = false;
    this.starting = false;
    this.runId = 0;
    this.cycleId = 0;
    this.silenceTimeoutMs = 5000;
    this.voiceDetected = false;
    this.detectedFrames = 0;
    this.streamTrack = null;
    this.trackEndedHandler = null;
    this.recognitionReady = false;
    this.preferRecognitionTrack = true;
    this.recognitionUsesTrack = false;
    this.recognitionStartFailures = 0;
    this.connectionFailures = 0;

    this.startButton.addEventListener('click', () => this.toggle());
    this.closeButtons.forEach((button) => button.addEventListener('click', () => this.close()));
    this.deviceSelect.addEventListener('change', () => this.changeDevice());
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
    window.addEventListener?.('pointerdown', () => this.resumeAudioContext(), { passive: true });
    window.addEventListener?.('keydown', () => this.resumeAudioContext());
  }

  open() {
    this.connectionFailures = 0;
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
    if (this.desiredActive) {
      this.stop(true);
      return;
    }
    await this.start();
  }

  async start() {
    if (this.desiredActive || this.starting) return;
    clearTimeout(this.connectionRetryTimer);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('error', '이 브라우저에서는 마이크를 사용할 수 없습니다.');
      return;
    }

    const runId = ++this.runId;
    this.desiredActive = true;
    this.starting = true;
    this.startButton.disabled = true;
    this.setStatus('listening', '마이크 권한을 확인하는 중');
    let stream = null;
    let audioContext = null;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('AudioContextUnavailable');
      audioContext = new AudioContextClass();
      this.pendingAudioContext = audioContext;
      this.resumeAudioContext(audioContext);
      const selectedDeviceId = this.deviceSelect.value;
      const audioOptions = (deviceId = '') => ({
        echoCancellation: true,
        noiseSuppression: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      });
      try {
        stream = await this.getUserMediaWithTimeout({ audio: audioOptions(selectedDeviceId) });
      } catch (error) {
        const selectedDeviceMissing = selectedDeviceId && ['OverconstrainedError', 'NotFoundError'].includes(error?.name);
        if (!selectedDeviceMissing) throw error;
        this.deviceSelect.value = '';
        stream = await this.getUserMediaWithTimeout({ audio: audioOptions() });
      }
      if (runId !== this.runId || !this.desiredActive) {
        stream.getTracks().forEach((track) => track.stop());
        audioContext.close?.();
        return;
      }
      this.pendingAudioContext = null;
      this.stream = stream;
      this.watchStreamTrack(this.stream.getAudioTracks?.()[0]);
      this.audioContext = audioContext;
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      this.resumeAudioContext();
      this.active = true;
      this.connectionFailures = 0;
      this.starting = false;
      this.startButton.disabled = false;
      this.startButton.textContent = '테스트 종료';
      this.startButton.classList.add('recording');
      void this.refreshDevices(true);
      this.measure();
      this.beginListeningCycle(runId);
    } catch (error) {
      if (runId !== this.runId) {
        stream?.getTracks?.().forEach((track) => track.stop());
        audioContext?.close?.();
        return;
      }
      this.desiredActive = false;
      this.active = false;
      this.starting = false;
      this.pendingAudioContext = null;
      this.detachStreamTrackWatcher();
      if (this.stream === stream) this.stream = null;
      this.source?.disconnect?.();
      this.source = null;
      this.analyser?.disconnect?.();
      this.analyser = null;
      if (this.audioContext === audioContext) this.audioContext = null;
      stream?.getTracks?.().forEach((track) => track.stop());
      audioContext?.close?.();
      this.startButton.disabled = false;
      if (['NotAllowedError', 'SecurityError'].includes(error?.name)) {
        this.setStatus('error', '마이크 권한이 차단되었습니다');
        this.transcript.textContent = '주소창 왼쪽에서 마이크 권한을 허용한 뒤 다시 시작하세요.';
      } else {
        this.setStatus('ready', '마이크 자동 재연결 중');
        this.transcript.textContent = '마이크 연결 응답이 없어 자동으로 다시 연결합니다.';
        this.connectionFailures += 1;
        const retryDelay = Math.min(12000, 1200 * (2 ** Math.min(3, this.connectionFailures - 1)));
        this.scheduleConnectionRetry(retryDelay);
      }
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
          mediaPromise.then((lateStream) => lateStream.getTracks().forEach((track) => track.stop())).catch(() => {});
        }
        throw error;
      },
    );
  }

  scheduleConnectionRetry(delay = 1200) {
    clearTimeout(this.connectionRetryTimer);
    this.connectionRetryTimer = window.setTimeout(() => {
      const modalOpen = !this.modal.classList.contains('is-hidden');
      if (modalOpen && !this.desiredActive && !this.starting) void this.start();
    }, delay);
  }

  watchStreamTrack(track) {
    this.detachStreamTrackWatcher();
    if (!track) return;
    this.streamTrack = track;
    this.trackEndedHandler = () => {
      if (track !== this.streamTrack) return;
      this.detachStreamTrackWatcher();
      this.stop(false);
      this.setStatus('ready', '마이크 연결 끊김 · 자동 재연결 중');
      this.transcript.textContent = '마이크 연결이 끊겨 자동으로 다시 연결합니다.';
      this.scheduleConnectionRetry(700);
    };
    track.addEventListener?.('ended', this.trackEndedHandler, { once: true });
  }

  detachStreamTrackWatcher() {
    this.streamTrack?.removeEventListener?.('ended', this.trackEndedHandler);
    this.streamTrack = null;
    this.trackEndedHandler = null;
  }

  resumeAudioContext(context = this.audioContext ?? this.pendingAudioContext) {
    if (context?.state !== 'suspended') return;
    try {
      const resumeResult = context.resume();
      resumeResult?.catch?.(() => {});
    } catch (error) {
      // 다음 사용자 입력 때 다시 활성화를 시도합니다.
    }
  }

  stopRecognitionOnly() {
    clearTimeout(this.recognitionRetryTimer);
    clearTimeout(this.speechMaxTimer);
    clearTimeout(this.recognitionStartTimer);
    clearTimeout(this.recognitionWatchdogTimer);
    this.recognitionReady = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onspeechstart = null;
    try {
      recognition.abort();
    } catch (error) {
      // 이미 끝난 음성 인식은 추가로 중단하지 않습니다.
    }
  }

  isCurrentCycle(runId, cycleId) {
    return this.active && this.desiredActive && this.runId === runId && this.cycleId === cycleId;
  }

  startRecognitionWithActiveTrack(recognition) {
    const track = this.stream?.getAudioTracks?.()[0];
    this.recognitionUsesTrack = false;
    if (this.preferRecognitionTrack && track?.readyState === 'live') {
      try {
        recognition.start(track);
        this.recognitionUsesTrack = true;
        return;
      } catch (error) {
        if (!['TypeError', 'NotSupportedError'].includes(error?.name)) throw error;
      }
    }
    recognition.start();
  }

  armSilenceTimer(runId, cycleId) {
    if (!this.isCurrentCycle(runId, cycleId) || !this.testCycleActive || this.voiceDetected) return;
    this.cycleDeadline ??= performance.now() + this.silenceTimeoutMs;
    clearTimeout(this.silenceTimer);
    const remaining = Math.max(0, this.cycleDeadline - performance.now());
    this.silenceTimer = window.setTimeout(
      () => this.resetSilentCycle(runId, cycleId),
      remaining,
    );
  }

  beginListeningCycle(runId = this.runId, preserveTranscript = false) {
    if (!this.active || !this.desiredActive || runId !== this.runId) return;
    clearTimeout(this.silenceTimer);
    clearTimeout(this.cycleRestartTimer);
    this.stopRecognitionOnly();
    const cycleId = ++this.cycleId;
    this.testCycleActive = true;
    this.voiceDetected = false;
    this.recognitionReady = false;
    this.detectedFrames = 0;
    this.cycleDeadline = null;
    this.recognitionStartFailures = 0;
    this.meterFill.style.width = '0%';
    this.levelText.textContent = '입력 레벨 0%';
    if (!preserveTranscript) this.transcript.textContent = '아직 인식된 목소리가 없습니다.';
    this.setStatus('listening', '자동 테스트 중 — 5초 안에 말하세요');
    this.startSpeechRecognition(runId, cycleId);
  }

  startSpeechRecognition(runId, cycleId) {
    if (!this.isCurrentCycle(runId, cycleId) || !this.testCycleActive) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.recognitionReady = true;
      this.armSilenceTimer(runId, cycleId);
      this.transcript.textContent = '이 브라우저는 문장 인식을 지원하지 않지만 입력 음량은 확인할 수 있습니다.';
      return;
    }
    this.recognitionReady = false;
    const recognition = new SpeechRecognition();
    this.recognition = recognition;
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = false;
    let recognitionStarted = false;
    recognition.onstart = () => {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition) return;
      recognitionStarted = true;
      this.recognitionStartFailures = 0;
      this.recognitionReady = true;
      clearTimeout(this.recognitionStartTimer);
      this.armSilenceTimer(runId, cycleId);
      this.setStatus('listening', '자동 테스트 중 — 5초 안에 말하세요');
    };
    recognition.onspeechstart = () => {
      recognitionStarted = true;
      this.recognitionReady = true;
      clearTimeout(this.recognitionStartTimer);
      this.armSilenceTimer(runId, cycleId);
      this.markVoiceDetected(runId, cycleId, '목소리 입력이 감지되었습니다');
    };
    recognition.onresult = (event) => {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition) return;
      recognitionStarted = true;
      this.recognitionReady = true;
      clearTimeout(this.recognitionStartTimer);
      this.armSilenceTimer(runId, cycleId);
      const value = Array.from(event.results).map((result) => result[0].transcript).join(' ').trim();
      if (value) {
        this.transcript.textContent = `“${value}”`;
        this.markVoiceDetected(runId, cycleId, '목소리와 문장 인식이 정상입니다');
      }
    };
    recognition.onerror = (event) => {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition || event.error === 'aborted') return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        if (event.error === 'audio-capture') {
          if (this.recognitionUsesTrack) this.preferRecognitionTrack = false;
          this.stop(false);
          this.setStatus('ready', '마이크 자동 재연결 중');
          this.transcript.textContent = '마이크 캡처가 멈춰 자동으로 다시 연결합니다.';
          this.scheduleConnectionRetry(900);
          return;
        }
        this.testCycleActive = false;
        clearTimeout(this.silenceTimer);
        this.stopRecognitionOnly();
        this.setStatus('error', event.error === 'audio-capture' ? '마이크 장치를 찾지 못했습니다' : '음성 인식 권한이 차단되었습니다');
        this.transcript.textContent = '브라우저의 마이크 권한과 장치 연결 상태를 확인하세요.';
      }
    };
    recognition.onend = () => {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition || !this.testCycleActive) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition.onspeechstart = null;
      clearTimeout(this.recognitionStartTimer);
      clearTimeout(this.recognitionWatchdogTimer);
      this.recognition = null;
      this.recognitionReady = false;
      if (!recognitionStarted) {
        this.recognitionStartFailures += 1;
        this.setStatus('ready', '음성 인식 자동 재연결 중');
        this.transcript.textContent = '음성 인식이 시작되지 않아 자동으로 다시 테스트합니다.';
        if (this.recognitionStartFailures >= 4) {
          this.testCycleActive = false;
          this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 3000);
          return;
        }
        this.recognitionRetryTimer = window.setTimeout(
          () => this.startSpeechRecognition(runId, cycleId),
          Math.min(1400, 250 + this.recognitionStartFailures * 200),
        );
        return;
      }
      if (this.voiceDetected) {
        this.testCycleActive = false;
        clearTimeout(this.silenceTimer);
        this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 900);
        return;
      }
      const remaining = (this.cycleDeadline ?? performance.now()) - performance.now();
      if (remaining <= 0) {
        this.resetSilentCycle(runId, cycleId);
        return;
      }
      this.recognitionRetryTimer = window.setTimeout(
        () => this.startSpeechRecognition(runId, cycleId),
        Math.min(250, remaining),
      );
    };
    this.recognitionStartTimer = window.setTimeout(() => {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition || recognitionStarted) return;
      this.testCycleActive = false;
      clearTimeout(this.silenceTimer);
      this.stopRecognitionOnly();
      this.setStatus('ready', '음성 인식 자동 재연결 중');
      this.transcript.textContent = '음성 인식 시작이 늦어 자동으로 다시 테스트합니다.';
      this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 700);
    }, 3500);
    this.recognitionWatchdogTimer = window.setTimeout(() => {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition) return;
      this.testCycleActive = false;
      clearTimeout(this.silenceTimer);
      this.stopRecognitionOnly();
      this.setStatus('ready', '음성 인식 자동 초기화 중');
      this.transcript.textContent = '음성 인식 응답이 멈춰 자동으로 다시 테스트합니다.';
      this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 700);
    }, 10000);
    try {
      this.startRecognitionWithActiveTrack(recognition);
    } catch (error) {
      if (!this.isCurrentCycle(runId, cycleId) || recognition !== this.recognition) return;
      this.stopRecognitionOnly();
      if (['NotAllowedError', 'SecurityError'].includes(error?.name)) {
        this.testCycleActive = false;
        clearTimeout(this.silenceTimer);
        this.setStatus('error', '음성 인식 권한이 차단되었습니다');
        this.transcript.textContent = '브라우저의 마이크 권한을 확인하세요.';
      } else {
        const remaining = this.cycleDeadline == null ? 500 : this.cycleDeadline - performance.now();
        this.recognitionRetryTimer = window.setTimeout(
          () => this.startSpeechRecognition(runId, cycleId),
          Math.min(500, Math.max(100, remaining)),
        );
      }
    }
  }

  markVoiceDetected(runId, cycleId, label) {
    if (!this.isCurrentCycle(runId, cycleId) || !this.testCycleActive) return;
    if (!this.voiceDetected) {
      this.voiceDetected = true;
      clearTimeout(this.silenceTimer);
      const supportsRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
      if (!supportsRecognition) {
        this.testCycleActive = false;
        this.setStatus('detected', '마이크 음량 입력이 정상입니다');
        this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 900);
        return;
      }
      clearTimeout(this.speechMaxTimer);
      this.speechMaxTimer = window.setTimeout(() => {
        if (!this.isCurrentCycle(runId, cycleId)) return;
        try {
          this.recognition?.stop?.();
        } catch (error) {
          this.testCycleActive = false;
          this.stopRecognitionOnly();
          this.setStatus('ready', '음성 인식 자동 재연결 중');
          this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 700);
        }
      }, 6500);
    }
    this.setStatus('detected', label);
  }

  resetSilentCycle(runId, cycleId) {
    if (!this.isCurrentCycle(runId, cycleId) || !this.testCycleActive || this.voiceDetected) return;
    this.testCycleActive = false;
    clearTimeout(this.silenceTimer);
    this.stopRecognitionOnly();
    this.cycleId += 1;
    this.detectedFrames = 0;
    this.meterFill.style.width = '0%';
    this.levelText.textContent = '입력 레벨 0%';
    this.transcript.textContent = '5초 동안 입력이 없어 자동으로 초기화했습니다. 같은 문장을 다시 말해 주세요.';
    this.setStatus('ready', '입력 없음 · 자동으로 다시 테스트 중');
    this.cycleRestartTimer = window.setTimeout(() => this.beginListeningCycle(runId, true), 700);
  }

  measure() {
    if (!this.active || !this.analyser) return;
    this.resumeAudioContext();
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
    if (rms > .025) {
      this.detectedFrames += 1;
      if (this.recognitionReady && this.detectedFrames >= 3) this.markVoiceDetected(this.runId, this.cycleId, '목소리 입력이 감지되었습니다');
    } else {
      this.detectedFrames = 0;
    }
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
    const shouldRestart = this.desiredActive || this.active || this.starting;
    this.stop(false);
    if (shouldRestart) await this.start();
  }

  stop(showStatus = true) {
    this.desiredActive = false;
    this.active = false;
    this.starting = false;
    this.testCycleActive = false;
    this.runId += 1;
    this.cycleId += 1;
    clearTimeout(this.silenceTimer);
    clearTimeout(this.cycleRestartTimer);
    clearTimeout(this.recognitionRetryTimer);
    clearTimeout(this.speechMaxTimer);
    clearTimeout(this.connectionRetryTimer);
    clearTimeout(this.recognitionStartTimer);
    clearTimeout(this.recognitionWatchdogTimer);
    cancelAnimationFrame(this.frame);
    this.stopRecognitionOnly();
    this.detachStreamTrackWatcher();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source?.disconnect?.();
    this.source = null;
    this.analyser?.disconnect?.();
    this.analyser = null;
    this.audioContext?.close?.();
    this.audioContext = null;
    this.pendingAudioContext?.close?.();
    this.pendingAudioContext = null;
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
