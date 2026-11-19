// Background music from the agency (audio/background_music.aif at the repo
// root), converted to Ogg Opus for the browser. Played through Web Audio
// rather than <audio loop>: a looping buffer restarts sample-accurate, while
// a media element leaves an audible gap at every loop.
const SRC = '/audio/background_music.ogg'

// Mixed under the UI sounds (button/success play at full volume).
const VOLUME = 0.4
// While a UI sound plays the music drops to this level, then comes back.
const DUCKED_VOLUME = 0.08
// Time constants (seconds) of the fade down and back up.
const DUCK_ATTACK = 0.05
const DUCK_RELEASE = 0.4

export function useBackgroundMusic() {
  let context: AudioContext | null = null
  let source: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  let disposed = false
  // UI sounds currently playing; the music stays ducked while any is left.
  const ducking = new Set<HTMLMediaElement>()

  function fadeTo(volume: number, timeConstant: number) {
    if (!context || !gain) return
    gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.setTargetAtTime(volume, context.currentTime, timeConstant)
  }

  // Lowers the music until `sound` ends (or is paused/fails). Calling it again
  // for a sound that restarts keeps the music down without stacking listeners.
  function duckWhile(sound: HTMLMediaElement) {
    if (ducking.has(sound)) return
    ducking.add(sound)
    fadeTo(DUCKED_VOLUME, DUCK_ATTACK)

    const release = () => {
      sound.removeEventListener('ended', release)
      sound.removeEventListener('pause', release)
      sound.removeEventListener('error', release)
      ducking.delete(sound)
      if (ducking.size === 0) fadeTo(VOLUME, DUCK_RELEASE)
    }
    sound.addEventListener('ended', release)
    sound.addEventListener('pause', release)
    sound.addEventListener('error', release)
  }

  // Without --autoplay-policy=no-user-gesture-required the browser keeps the
  // context suspended until the first touch; every touch retries until it runs.
  function resume() {
    if (!context || context.state !== 'suspended') return
    context.resume()
      .then(() => window.removeEventListener('pointerdown', resume, true))
      .catch(() => undefined)
  }

  // A missing or undecodable file only means silence: music must never stop the kiosk.
  async function start() {
    context = new AudioContext()
    gain = context.createGain()
    gain.gain.value = VOLUME
    gain.connect(context.destination)
    window.addEventListener('pointerdown', resume, true)
    resume()

    try {
      const response = await fetch(SRC)
      if (!response.ok) return
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (disposed) return
      source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(gain)
      source.start()
    } catch {
      // Silence is the fallback.
    }
  }

  function dispose() {
    disposed = true
    window.removeEventListener('pointerdown', resume, true)
    source?.stop()
    source = null
    context?.close().catch(() => undefined)
    context = null
    gain = null
    ducking.clear()
  }

  return { start, duckWhile, dispose }
}
