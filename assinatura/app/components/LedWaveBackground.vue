<script setup lang="ts">
// Subway wave background of the LED counter: the agency's animation
// (fatiado/FUNDO_384x192_v01+.webm, 6.07 s, 30 fps) at the panel's native
// 384×192. Its last frame matches the first, so it loops without a visible
// cut. Served locally: the kiosk runs offline.
const VIDEO_SRC = '/videos/fundo-384x192.webm'
</script>

<template>
  <div class="wave-background" aria-hidden="true">
    <video
      class="wave-background__video"
      :src="VIDEO_SRC"
      width="384"
      height="192"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      disablepictureinpicture
      disableremoteplayback
      tabindex="-1"
    />
  </div>
</template>

<style scoped>
.wave-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* The video's own green, so nothing flashes before its first frame. */
  background: #0a9d38;
  pointer-events: none;
}

.wave-background__video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
