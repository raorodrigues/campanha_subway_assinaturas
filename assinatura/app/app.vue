<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
</template>

<style>
/*
 * Shared by both screens: the touch kiosk (/) and the LED counter (/counter).
 * Each page tags <html> (page-signature / page-counter) and sets its own
 * colours there, so one screen never restyles the other.
 */
:root {
  font-family: "Subway Sans Cond", "Arial Narrow", sans-serif;
  font-weight: 700;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

html,
body,
#__nuxt {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

/* Kiosk hardening: no text selection, callouts, overscroll, pinch/double-tap zoom or image drag. */
html,
body {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
}

/*
 * Desktop Chrome/Edge on Windows ignore `user-scalable=no`, and `manipulation`
 * still allows pinch zoom. Set on every element (touch-action is not inherited);
 * the signature canvas overrides it with `none`.
 */
* {
  touch-action: pan-x pan-y;
}

img {
  -webkit-user-drag: none;
}

button {
  font: inherit;
}
</style>
