// UI sounds from the agency (audio/ at the repo root), served locally: the
// kiosk runs offline. Loaded once when the page mounts, so the first tap
// plays without waiting for the network.
const SOUNDS = {
  button: '/audio/button.mp3',
  success: '/audio/success.mp3',
} as const

export type KioskSound = keyof typeof SOUNDS

export function useKioskSounds() {
  const players = new Map<KioskSound, HTMLAudioElement>()

  function preload() {
    for (const [name, src] of Object.entries(SOUNDS) as [KioskSound, string][]) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      players.set(name, audio)
    }
  }

  // Restarts the sound if it is still playing. A blocked or failed play is
  // ignored on purpose: a missing sound must never stop the kiosk. Browsers
  // allow it once the page has been touched, which every sound here follows.
  function play(name: KioskSound) {
    const audio = players.get(name)
    if (!audio) return
    audio.currentTime = 0
    audio.play().catch(() => undefined)
  }

  function dispose() {
    for (const audio of players.values()) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    players.clear()
  }

  return { preload, play, dispose }
}
