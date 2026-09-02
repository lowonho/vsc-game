const voice = new VoiceController();
const micTest = new MicTestController();
const toastEl = document.querySelector('#toast');
const lobbyButton = document.querySelector('#lobby-button');

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

document.querySelector('#help-button').addEventListener('click', () => document.querySelector('#help-dialog').showModal());
document.querySelector('#close-help').addEventListener('click', () => document.querySelector('#help-dialog').close());

const palette = {
  ink: 0x0f172a, paper: 0xf8fafc, muted: 0x94a3b8, cyan: 0x22d3ee,
  violet: 0x8b5cf6, pink: 0xec4899, amber: 0xf59e0b, red: 0xef4444,
  green: 0x22c55e, blue: 0x2563eb,
};

const textStyle = { fontFamily: 'Pretendard, Noto Sans KR, sans-serif', color: '#f8fafc' };

class BaseScene extends Phaser.Scene {
  createHeader(stage, title, subtitle) {
    lobbyButton.classList.remove('is-hidden');
    voice.enterStage();
    this.add.text(54, 42, stage, { ...textStyle, fontSize: 16, fontStyle: 'bold', color: '#67e8f9' });
    this.add.text(54, 70, title, { ...textStyle, fontSize: 38, fontStyle: 'bold' });
    this.add.text(56, 120, subtitle, { ...textStyle, fontSize: 17, color: '#cbd5e1' });
    this.scoreText = this.add.text(1090, 48, '0점', { ...textStyle, fontSize: 24, fontStyle: 'bold' }).setOrigin(1, 0);
    this.events.once('shutdown', () => voice.cancel());
  }

  panel(x, y, width, height, color = 0x111827, alpha = .9) {
    return this.add.rectangle(x, y, width, height, color, alpha).setStrokeStyle(1, 0xffffff, .11);
  }

  button(x, y, label, onClick, width = 210) {
    const bg = this.add.rectangle(x, y, width, 54, palette.violet, 1).setInteractive({ useHandCursor: true });
    const copy = this.add.text(x, y, label, { ...textStyle, fontSize: 17, fontStyle: 'bold' }).setOrigin(.5);
    bg.on('pointerover', () => bg.setFillStyle(0xa78bfa));
    bg.on('pointerout', () => bg.setFillStyle(palette.violet));
    bg.on('pointerdown', onClick);
    return this.add.container(0, 0, [bg, copy]);
  }

  showPhraseGuide(config) {
    this.clearPhraseGuide();
    const panel = this.add.rectangle(640, 205, 920, 112, 0x020617, .96)
      .setStrokeStyle(3, palette.amber, .92)
      .setDepth(900);
    const context = this.add.text(640, 166, `지금 말할 대사 · ${config.kicker ?? '상황에 맞게 연기'}`, {
      ...textStyle, fontSize: 14, fontStyle: 'bold', color: '#fde68a',
    }).setOrigin(.5).setDepth(901);
    const line = this.add.text(640, 201, `“${config.expected}”`, {
      ...textStyle, fontSize: 28, fontStyle: 'bold', align: 'center', wordWrap: { width: 850 },
    }).setOrigin(.5).setDepth(901);
    const hint = this.add.text(640, 239, `마이크가 자동으로 듣고 있습니다 · ${config.hint ?? ''}`, {
      ...textStyle, fontSize: 13, color: '#a5f3fc', align: 'center', wordWrap: { width: 850 },
    }).setOrigin(.5).setDepth(901);
    this.phraseGuide = [panel, context, line, hint];
  }

  clearPhraseGuide() {
    this.phraseGuide?.forEach((item) => item.destroy());
    this.phraseGuide = null;
  }

  async capture(config) {
    this.showPhraseGuide(config);
    while (this.scene.isActive()) {
      const raw = await voice.request(config);
      if (raw.status === 'ok') {
        this.clearPhraseGuide();
        return evaluateVoice({ ...raw, expected: config.expected, profile: config.profile });
      }
      if (raw.status === 'no-speech') {
        toast('마이크가 대사를 듣지 못했어요. 점수 없이 자동으로 다시 듣습니다.');
        await new Promise((resolve) => setTimeout(resolve, 450));
        continue;
      }
      if (raw.status === 'speech-error') {
        toast('음성 인식 연결에 실패했어요. 자동으로 다시 연결하거나 키보드 테스트를 이용하세요.');
        await new Promise((resolve) => setTimeout(resolve, 450));
        continue;
      }
      this.clearPhraseGuide();
      return null;
    }
    this.clearPhraseGuide();
    return null;
  }

  addBeatScore(result) {
    if (!result) return;
    this.stageScores ??= [];
    this.stageScores.push(result.total);
    this.scoreText.setText(`${Math.round(this.stageScores.reduce((a, b) => a + b, 0) / this.stageScores.length)}점`);
  }

  showResult(result, reaction, buttonLabel = '계속하기') {
    this.addBeatScore(result);
    return new Promise((resolve) => {
      const blocker = this.add.rectangle(640, 360, 1280, 720, 0x020617, .62).setInteractive();
      const card = this.panel(640, 360, 620, 342, 0x111827, .98);
      const color = result.grade === '완벽' ? '#67e8f9' : result.grade === '성공' ? '#86efac' : result.grade === '아쉬움' ? '#fcd34d' : '#fca5a5';
      const grade = this.add.text(640, 245, result.grade, { ...textStyle, fontSize: 42, fontStyle: 'bold', color }).setOrigin(.5);
      const score = this.add.text(640, 294, `${result.total}점`, { ...textStyle, fontSize: 22, fontStyle: 'bold' }).setOrigin(.5);
      const detail = this.add.text(640, 338,
        `대사 ${Math.round(result.accuracy * 100)}  ·  음량 ${Math.round(result.volumeScore * 100)}  ·  속도 ${Math.round(result.speedScore * 100)}  ·  타이밍 ${Math.round(result.timing * 100)}`,
        { ...textStyle, fontSize: 14, color: '#94a3b8' }).setOrigin(.5);
      const heard = this.add.text(640, 372, `인식된 대사: “${result.transcript || '인식되지 않음'}”`, { ...textStyle, fontSize: 15, color: '#67e8f9', align: 'center', wordWrap: { width: 520 } }).setOrigin(.5);
      const line = this.add.text(640, 410, reaction, { ...textStyle, fontSize: 18, align: 'center', wordWrap: { width: 510 }, lineSpacing: 8 }).setOrigin(.5);
      const next = this.button(640, 468, buttonLabel, () => {
        [blocker, card, grade, score, detail, heard, line, next].forEach((item) => item.destroy());
        resolve();
      }, 190);
    });
  }

  finishStage(nextScene, title, summary) {
    const score = Math.round(this.stageScores.reduce((a, b) => a + b, 0) / this.stageScores.length);
    this.registry.set(`${this.scene.key}Score`, score);
    const blocker = this.add.rectangle(640, 360, 1280, 720, 0x020617, .8).setInteractive();
    this.panel(640, 360, 650, 370, 0x111827, 1);
    this.add.text(640, 242, 'STAGE CLEAR', { ...textStyle, fontSize: 15, fontStyle: 'bold', color: '#67e8f9' }).setOrigin(.5);
    this.add.text(640, 287, title, { ...textStyle, fontSize: 32, fontStyle: 'bold' }).setOrigin(.5);
    this.add.text(640, 352, `${score}점`, { ...textStyle, fontSize: 56, fontStyle: 'bold' }).setOrigin(.5);
    this.add.text(640, 414, summary, { ...textStyle, fontSize: 16, color: '#cbd5e1', align: 'center', wordWrap: { width: 500 } }).setOrigin(.5);
    this.button(640, 500, nextScene === 'Summary' ? '최종 결과 보기' : '다음 스테이지', () => this.scene.start(nextScene), 230);
    return blocker;
  }
}

class TitleScene extends BaseScene {
  constructor() { super('Title'); }
  create() {
    voice.leaveStage();
    lobbyButton.classList.add('is-hidden');
    this.cameras.main.setBackgroundColor('#080d19');
    const glow = this.add.graphics();
    glow.fillStyle(0x7c3aed, .14).fillCircle(1100, 100, 360);
    glow.fillStyle(0x22d3ee, .08).fillCircle(130, 620, 310);
    this.add.text(54, 62, 'PHASER 3 · VOICE ACTING GAME', { ...textStyle, fontSize: 15, fontStyle: 'bold', color: '#67e8f9' });
    this.add.text(54, 104, '상황을 보고,\n목소리로 해결하세요.', { ...textStyle, fontSize: 56, fontStyle: 'bold', lineSpacing: 8 });
    this.add.text(58, 252, '정해진 대사를 언제, 얼마나 크게, 어떤 감정으로 말할지 판단하는\n3스테이지 테스트 버전입니다.', { ...textStyle, fontSize: 19, color: '#cbd5e1', lineSpacing: 9 });

    const cards = [
      ['01', '할증 전 택시 잡기', '거리 + 다급함', 'Taxi'],
      ['02', '법정의 결정적 모순', '타이밍 + 확신', 'Court'],
      ['03', '엄마 몰래 라면', '속삭임 + 침착함', 'Ramen'],
    ];
    cards.forEach(([number, title, tag, scene], index) => {
      const x = 246 + index * 397;
      const bg = this.add.rectangle(x, 447, 360, 210, 0x111827, .94).setStrokeStyle(1, 0xffffff, .11).setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setStrokeStyle(2, palette.cyan, .8));
      bg.on('pointerout', () => bg.setStrokeStyle(1, 0xffffff, .11));
      bg.on('pointerdown', () => this.scene.start(scene));
      this.add.text(x - 145, 370, number, { ...textStyle, fontSize: 16, fontStyle: 'bold', color: '#67e8f9' });
      this.add.text(x - 145, 416, title, { ...textStyle, fontSize: 24, fontStyle: 'bold' });
      this.add.text(x - 145, 459, tag, { ...textStyle, fontSize: 15, color: '#94a3b8' });
      this.add.text(x - 145, 518, '직접 테스트 →', { ...textStyle, fontSize: 15, fontStyle: 'bold', color: '#c4b5fd' });
    });
    const launchHint = location.protocol === 'file:'
      ? '⚠ index.html을 직접 열지 말고 GitHub Pages 주소로 접속하세요.'
      : '✓ 웹 주소로 실행 중 · 허용한 마이크 권한을 같은 주소에서 다시 사용합니다.';
    this.add.text(640, 612, launchHint, { ...textStyle, fontSize: 14, fontStyle: 'bold', color: location.protocol === 'file:' ? '#fcd34d' : '#86efac' }).setOrigin(.5);
    this.button(500, 665, '마이크 테스트', () => micTest.open(), 240);
    this.button(780, 665, '처음부터 플레이', () => this.scene.start('Taxi'), 240);
  }
}

class TaxiScene extends BaseScene {
  constructor() { super('Taxi'); }
  create() {
    this.cameras.main.setBackgroundColor('#111827');
    this.createHeader('STAGE 01', '할증 2분 전, 빈 택시를 잡아라', '빈차가 적정 거리에 들어왔을 때 불러 세우고 목적지를 전달하세요.');
    this.add.rectangle(640, 300, 1280, 260, 0x172554);
    for (let i = 0; i < 9; i++) this.add.rectangle(i * 170 + 40, 352 - (i % 3) * 35, 115, 180, i % 2 ? 0x1e293b : 0x334155);
    this.add.rectangle(640, 505, 1280, 260, 0x1e293b);
    for (let i = 0; i < 8; i++) this.add.rectangle(i * 190 + 80, 510, 90, 8, 0xf8fafc, .45);
    this.add.rectangle(705, 495, 270, 210, 0x22d3ee, .08).setStrokeStyle(2, palette.cyan, .55);
    this.add.text(705, 400, '호출 적정 거리', { ...textStyle, fontSize: 15, fontStyle: 'bold', color: '#67e8f9' }).setOrigin(.5);
    this.player = this.add.container(280, 510, [
      this.add.circle(0, -64, 24, 0xfbbf24), this.add.rectangle(0, -18, 48, 76, palette.violet),
      this.add.text(0, 50, '나', { ...textStyle, fontSize: 14, fontStyle: 'bold' }).setOrigin(.5),
    ]);
    this.taxi = this.makeTaxi(1360, 520);
    this.taxiActive = true;
    this.stageScores = [];
    this.firstBeat();
  }

  makeTaxi(x, y) {
    const body = this.add.rectangle(0, 0, 190, 70, 0xfacc15).setStrokeStyle(4, 0x0f172a);
    const roof = this.add.triangle(0, -44, -60, 45, -25, 0, 70, 45, 0x38bdf8).setStrokeStyle(4, 0x0f172a);
    const sign = this.add.text(0, -77, '빈차', { ...textStyle, fontSize: 15, fontStyle: 'bold', backgroundColor: '#16a34a', padding: { x: 9, y: 4 } }).setOrigin(.5);
    const wheels = [this.add.circle(-62, 38, 18, 0x0f172a), this.add.circle(62, 38, 18, 0x0f172a)];
    return this.add.container(x, y, [roof, body, sign, ...wheels]);
  }

  update(_, delta) {
    if (!this.taxiActive) return;
    this.taxi.x -= delta * .22;
    if (this.taxi.x < 200) this.taxi.x = 1360;
  }

  taxiTiming() {
    const distance = Math.abs(this.taxi.x - 705);
    return Math.max(0, 1 - distance / 430);
  }

  async firstBeat() {
    const result = await this.capture({
      kicker: '빈차가 가까워지면 호출', expected: '택시! 여기요!', hint: '너무 멀거나 가까우면 택시가 지나칩니다. 다급하고 크게 말하세요.',
      profile: { targetVolume: .78, targetCps: 5.4, volumeTolerance: .55, speedTolerance: 5, weights: { accuracy: .3, volume: .3, speed: .15, timing: .25 } },
      timingProvider: () => this.taxiTiming(), onStart: () => { this.taxiActive = false; },
    });
    if (!result) return;
    const reaction = result.total >= 70 ? '끼이익—! 택시가 플레이어 앞에 정확히 멈췄다.' : result.timing < .45 ? '택시가 호출을 알아채지 못하고 지나쳤다.' : '기사가 주변을 둘러보며 애매한 위치에 멈췄다.';
    await this.showResult(result, reaction, '택시에 타기');
    this.taxi.x = 475;
    this.add.text(640, 405, '기사: 어디 가세요?', { ...textStyle, fontSize: 25, fontStyle: 'bold', backgroundColor: '#0f172a', padding: { x: 24, y: 14 } }).setOrigin(.5);
    this.secondBeat();
  }

  async secondBeat() {
    const result = await this.capture({
      kicker: '할증까지 30초', expected: '강남역이요. 빨리 부탁드릴게요.', hint: '소리를 지르기보다 명료하고 다급하게 말하세요.',
      profile: { targetVolume: .5, targetCps: 5.8, volumeTolerance: .5, speedTolerance: 4, weights: { accuracy: .42, volume: .18, speed: .3, timing: .1 } },
    });
    if (!result) return;
    const reaction = result.total >= 70 ? '기사: “네, 안전하게 최대한 빨리 가겠습니다!”' : '기사: “강남… 어디라고요?” 목적지를 다시 확인하느라 시간이 흘렀다.';
    await this.showResult(result, reaction, '스테이지 마무리');
    this.finishStage('Court', '할증 전 택시 잡기', '거리 판단과 호출 음량, 목적지 전달의 명료도를 함께 평가했습니다.');
  }
}

class CourtScene extends BaseScene {
  constructor() { super('Court'); }
  create() {
    this.cameras.main.setBackgroundColor('#2b1721');
    this.createHeader('STAGE 02', '결정적 모순이 나온 순간', '아무 때나 외치면 감점입니다. 증언을 끝까지 듣고 모순이 드러난 순간 이의를 제기하세요.');
    this.stageScores = [];
    this.add.rectangle(640, 483, 1280, 360, 0x3f2634);
    this.add.rectangle(640, 298, 520, 120, 0x78350f).setStrokeStyle(5, 0x451a03);
    this.add.text(640, 267, '판 사', { ...textStyle, fontSize: 21, fontStyle: 'bold' }).setOrigin(.5);
    this.add.circle(640, 197, 42, 0xf3c7a6);
    this.add.rectangle(640, 213, 80, 44, 0x111827);
    this.add.circle(340, 430, 42, 0xf1bfa1);
    this.add.rectangle(340, 510, 96, 125, 0x475569);
    this.add.text(340, 590, '증인', { ...textStyle, fontSize: 15, fontStyle: 'bold' }).setOrigin(.5);
    this.statementBox = this.panel(750, 455, 690, 170, 0x111827, .96);
    this.statement = this.add.text(750, 455, '', { ...textStyle, fontSize: 23, align: 'center', wordWrap: { width: 620 }, lineSpacing: 8 }).setOrigin(.5);
    this.statementIndex = 0;
    this.statements = [
      '증인: 사건 당일 저는 집에 있었습니다.',
      '증인: 밤 10시에는 이미 잠들어 있었고요.',
      '증인: 택시는 밤 11시에 도착했습니다.',
      '증인: 그래서 현장에는 갈 수 없었습니다.',
    ];
    this.showStatement();
    this.statementTimer = this.time.addEvent({ delay: 2600, loop: true, callback: () => {
      this.statementIndex = Math.min(this.statementIndex + 1, this.statements.length - 1);
      this.showStatement();
    }});
    this.firstBeat();
  }

  showStatement() {
    this.statement.setText(this.statements[this.statementIndex]);
    this.statement.setColor(this.statementIndex === 2 ? '#fde68a' : '#f8fafc');
  }

  objectionTiming() {
    return [0.08, .2, 1, .38][this.statementIndex];
  }

  async firstBeat() {
    const result = await this.capture({
      kicker: '증언을 듣고 결정적 순간에', expected: '이의 있습니다!', hint: '모순이 나올 때까지 기다렸다가 확신 있게 외치세요.',
      profile: { targetVolume: .72, targetCps: 4.8, volumeTolerance: .55, speedTolerance: 4.5, weights: { accuracy: .28, volume: .25, speed: .12, timing: .35 } },
      timingProvider: () => this.objectionTiming(), onStart: () => this.statementTimer.paused = true,
    });
    if (!result) return;
    this.cameras.main.shake(result.total >= 70 ? 220 : 90, result.total >= 70 ? .007 : .002);
    const reaction = result.timing >= .8 ? '재판장이 조용해지고, 증인의 표정이 굳었다.' : '판사: “아직 증언이 끝나지 않았습니다. 타이밍을 지키세요.”';
    await this.showResult(result, reaction, '근거 제시하기');
    this.statement.setText('판사: 이의의 근거를 설명하세요.').setColor('#f8fafc');
    this.secondBeat();
  }

  async secondBeat() {
    const result = await this.capture({
      kicker: '이번에는 침착하게 설명', expected: '열한 시라는 증언은 모순입니다.', hint: '흥분을 낮추고 또렷하고 안정적으로 말하세요.',
      profile: { targetVolume: .48, targetCps: 4.2, volumeTolerance: .48, speedTolerance: 3.6, weights: { accuracy: .48, volume: .22, speed: .22, timing: .08 } },
    });
    if (!result) return;
    const reaction = result.total >= 70 ? '판사: “지적을 받아들이겠습니다. 증인은 다시 답하세요.”' : '판사: “흥분하지 말고 근거를 명확하게 설명하세요.”';
    await this.showResult(result, reaction, '스테이지 마무리');
    this.finishStage('Ramen', '법정에서 이의 제기', '모순을 포착한 타이밍과 강한 이의 제기, 이후 침착한 설명의 대비를 평가했습니다.');
  }
}

class RamenScene extends BaseScene {
  constructor() { super('Ramen'); }
  create() {
    this.cameras.main.setBackgroundColor('#101827');
    this.createHeader('STAGE 03', '새벽 1시, 엄마 몰래 라면', '라면은 먹고 싶지만 엄마를 깨우면 끝입니다. 화가 나도 목소리를 낮게 유지하세요.');
    this.stageScores = [];
    this.add.rectangle(640, 470, 1280, 430, 0x1f2937);
    this.add.rectangle(305, 470, 480, 260, 0x334155).setStrokeStyle(3, 0x64748b);
    this.add.rectangle(305, 350, 430, 45, 0x94a3b8);
    this.add.rectangle(320, 412, 170, 36, 0x0f172a);
    this.pot = this.add.container(320, 355, [
      this.add.rectangle(0, 0, 130, 58, 0x64748b).setStrokeStyle(4, 0x0f172a),
      this.add.rectangle(-82, -5, 40, 12, 0x64748b), this.add.rectangle(82, -5, 40, 12, 0x64748b),
    ]);
    for (let i = 0; i < 4; i++) {
      const steam = this.add.circle(285 + i * 24, 306 - (i % 2) * 12, 7, 0xe2e8f0, .5);
      this.tweens.add({ targets: steam, y: steam.y - 28, alpha: .05, yoyo: true, repeat: -1, duration: 800 + i * 120 });
    }
    this.add.rectangle(1000, 445, 90, 360, 0x451a03).setStrokeStyle(6, 0x78350f);
    this.door = this.add.rectangle(1000, 445, 68, 330, 0x78350f);
    this.add.text(1000, 642, '엄마 방', { ...textStyle, fontSize: 15, color: '#94a3b8' }).setOrigin(.5);
    this.sibling = this.add.container(600, 460, [this.add.circle(0, -65, 25, 0xf1bfa1), this.add.rectangle(0, -15, 55, 80, palette.blue)]);
    this.add.text(600, 530, '동생이 컵을 떨어뜨리려 한다!', { ...textStyle, fontSize: 17, fontStyle: 'bold', color: '#fde68a' }).setOrigin(.5);
    this.noise = 18;
    this.meterBg = this.add.rectangle(640, 610, 500, 24, 0x0f172a);
    this.meterBar = this.add.rectangle(394, 610, 8, 16, palette.green).setOrigin(0, .5);
    this.add.text(385, 642, '안전', { ...textStyle, fontSize: 13, color: '#86efac' });
    this.add.text(895, 642, '엄마가 깸', { ...textStyle, fontSize: 13, color: '#fca5a5' }).setOrigin(1, 0);
    this.firstBeat();
  }

  setNoise(value) {
    this.noise = Phaser.Math.Clamp(value, 0, 100);
    this.meterBar.width = Math.max(8, 492 * this.noise / 100);
    this.meterBar.setFillStyle(this.noise > 68 ? palette.red : this.noise > 42 ? palette.amber : palette.green);
  }

  async firstBeat() {
    const result = await this.capture({
      kicker: '동생에게 속삭이기', expected: '컵 좀 조용히 놔.', hint: '다급하지만 엄마가 깨지 않도록 아주 작게 말하세요.',
      profile: { targetVolume: .16, targetCps: 4.8, volumeTolerance: .38, speedTolerance: 4.2, weights: { accuracy: .34, volume: .38, speed: .18, timing: .1 } },
    });
    if (!result) return;
    this.setNoise(20 + (1 - result.volumeScore) * 78);
    const reaction = result.volumeScore >= .65 ? '동생이 컵을 살며시 내려놓았다. 엄마 방은 조용하다.' : '“쨍그랑!” 놀란 동생이 컵을 놓쳤고 엄마 방에 불이 켜졌다.';
    await this.showResult(result, reaction, '엄마의 질문 듣기');
    this.door.setFillStyle(0xf59e0b);
    this.add.text(895, 350, '엄마: 거기서 뭐 하니?', { ...textStyle, fontSize: 24, fontStyle: 'bold', backgroundColor: '#0f172a', padding: { x: 22, y: 14 } }).setOrigin(.5);
    this.secondBeat();
  }

  async secondBeat() {
    const result = await this.capture({
      kicker: '당황을 숨기고 자연스럽게', expected: '물 마시러 나왔어요.', hint: '크게 속삭이지 말고 평소처럼 안정적으로 답하세요.',
      profile: { targetVolume: .35, targetCps: 3.8, volumeTolerance: .4, speedTolerance: 3.2, weights: { accuracy: .4, volume: .24, speed: .28, timing: .08 } },
    });
    if (!result) return;
    const reaction = result.total >= 70 ? '엄마: “그래, 마시고 얼른 자.” 문이 다시 닫혔다.' : '엄마: “근데 왜 라면 냄새가 나지?” 엄마가 주방으로 다가온다.';
    await this.showResult(result, reaction, '최종 결과 보기');
    this.finishStage('Summary', '엄마 몰래 라면', '낮은 음량의 다급한 속삭임과 들킨 직후의 안정적인 변명을 평가했습니다.');
  }
}

class SummaryScene extends BaseScene {
  constructor() { super('Summary'); }
  create() {
    voice.leaveStage();
    lobbyButton.classList.add('is-hidden');
    this.cameras.main.setBackgroundColor('#080d19');
    const scores = [
      ['택시 잡기', this.registry.get('TaxiScore') ?? 0, '#67e8f9'],
      ['법정 이의 제기', this.registry.get('CourtScore') ?? 0, '#c4b5fd'],
      ['엄마 몰래 라면', this.registry.get('RamenScore') ?? 0, '#fcd34d'],
    ];
    const completed = scores.filter(([, score]) => score > 0);
    const total = completed.length ? Math.round(completed.reduce((sum, [, score]) => sum + score, 0) / completed.length) : 0;
    this.add.text(640, 64, 'PROTOTYPE RESULT', { ...textStyle, fontSize: 15, fontStyle: 'bold', color: '#67e8f9' }).setOrigin(.5);
    this.add.text(640, 104, '오늘의 목소리 연기 결과', { ...textStyle, fontSize: 40, fontStyle: 'bold' }).setOrigin(.5);
    this.add.text(640, 175, `${total}점`, { ...textStyle, fontSize: 72, fontStyle: 'bold' }).setOrigin(.5);
    scores.forEach(([label, score, color], index) => {
      const y = 305 + index * 90;
      this.panel(640, y, 760, 68, 0x111827, .95);
      this.add.text(300, y, label, { ...textStyle, fontSize: 20, fontStyle: 'bold' }).setOrigin(0, .5);
      this.add.rectangle(535, y, 430, 12, 0x1e293b).setOrigin(0, .5);
      this.add.rectangle(535, y, 430 * score / 100, 12, Phaser.Display.Color.HexStringToColor(color).color).setOrigin(0, .5);
      this.add.text(1015, y, score ? `${score}점` : '미플레이', { ...textStyle, fontSize: 18, fontStyle: 'bold', color }).setOrigin(1, .5);
    });
    this.add.text(640, 580, '다음 개발 단계: 개인 음성 보정 · 음높이/억양 분석 · 더 많은 시나리오 데이터화', { ...textStyle, fontSize: 16, color: '#94a3b8' }).setOrigin(.5);
    this.button(500, 652, '다시 플레이', () => this.scene.start('Taxi'), 220);
    this.button(780, 652, '스테이지 선택', () => this.scene.start('Title'), 220);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#080d19',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false },
  scene: [TitleScene, TaxiScene, CourtScene, RamenScene, SummaryScene],
});

lobbyButton.addEventListener('click', () => {
  voice.cancel();
  micTest.close();
  const activeScene = game.scene.getScenes(true)[0];
  if (activeScene) activeScene.scene.start('Title');
});
