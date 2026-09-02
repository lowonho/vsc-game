const GAME_ASSETS = Object.freeze({
  images: Object.freeze({
    // lobbyBackground: './assets/images/backgrounds/lobby.webp',
    // taxiBackground: './assets/images/backgrounds/taxi.webp',
    // courtBackground: './assets/images/backgrounds/court.webp',
    // ramenBackground: './assets/images/backgrounds/ramen.webp',
    // summaryBackground: './assets/images/backgrounds/summary.webp',
  }),
  spritesheets: Object.freeze({
    // 예: player: { url: './assets/images/characters/player.png', frameWidth: 256, frameHeight: 384 },
  }),
  audio: Object.freeze({
    // 예: buttonClick: ['./assets/audio/sfx/button-click.ogg', './assets/audio/sfx/button-click.mp3'],
  }),
});

function preloadGameAssets(scene) {
  Object.entries(GAME_ASSETS.images).forEach(([key, url]) => scene.load.image(key, url));
  Object.entries(GAME_ASSETS.spritesheets).forEach(([key, config]) => {
    const { url, ...frameConfig } = config;
    scene.load.spritesheet(key, url, frameConfig);
  });
  Object.entries(GAME_ASSETS.audio).forEach(([key, urls]) => scene.load.audio(key, urls));
}
