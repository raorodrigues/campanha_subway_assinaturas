<script setup lang="ts">
// Subway wave background of the signature kiosk: the agency's animation
// (fatiado/FUNDO_1080x1920_v01+.webm, 6.07 s, 30 fps). Its last frame matches
// the first, so it loops without a visible cut. Served locally: the kiosk
// runs offline.
const VIDEO_SRC = '/videos/fundo-1080x1920.webm'
</script>

<template>
  <div class="wave-background" aria-hidden="true">
    <video
      class="wave-background__video"
      :src="VIDEO_SRC"
      width="1080"
      height="1920"
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
  top: 0;
  left: 0;
  width: 1080px;
  height: 1920px;
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
