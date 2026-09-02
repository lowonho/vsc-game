function normalizeKorean(text = '') {
  return text.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
}

function similarity(a, b) {
  const x = normalizeKorean(a);
  const y = normalizeKorean(b);
  if (!x || !y) return 0;
  const rows = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  rows[0] = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
  }
  return Math.max(0, 1 - rows[x.length][y.length] / Math.max(x.length, y.length));
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const targetScore = (value, target, tolerance) => clamp01(1 - Math.abs(value - target) / tolerance);

function evaluateVoice({ transcript, expected, volume = 0, duration = 1, timing = 1, profile = {} }) {
  const accuracy = similarity(transcript, expected);
  const cps = normalizeKorean(transcript).length / Math.max(duration, 0.4);
  const volumeScore = targetScore(volume, profile.targetVolume ?? 0.5, profile.volumeTolerance ?? 0.55);
  const speedScore = targetScore(cps, profile.targetCps ?? 4.5, profile.speedTolerance ?? 5);
  const weights = profile.weights ?? { accuracy: .35, volume: .3, speed: .15, timing: .2 };
  const total = Math.round(100 * (
    accuracy * weights.accuracy +
    volumeScore * weights.volume +
    speedScore * weights.speed +
    clamp01(timing) * weights.timing
  ));

  let grade = '실패';
  if (total >= 88) grade = '완벽';
  else if (total >= 70) grade = '성공';
  else if (total >= 48) grade = '아쉬움';

  return { total, grade, transcript, volume, accuracy, volumeScore, speedScore, timing: clamp01(timing), cps };
}
