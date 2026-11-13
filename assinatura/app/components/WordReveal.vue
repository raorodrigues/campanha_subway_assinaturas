<script setup lang="ts">
/**
 * Live text that enters word by word (fade + short rise) and leaves all at
 * once; timing lives in motion.css (.m-word). Each entry of `lines` is one
 * line; wrap words in *asterisks* to highlight them (yellow, and the attract
 * flash on the welcome screen), e.g. 'ELEJA *FRANGO*'.
 */
const props = withDefaults(defineProps<{
  lines: string[]
  tag?: string
}>(), { tag: 'p' })

interface Word {
  key: string
  text: string
  index: number
  highlight: boolean
}

const parsedLines = computed(() => {
  let index = 0
  return props.lines.map((line, lineIndex) => {
    const words: Word[] = []
    let highlight = false
    for (const token of line.split(/\s+/).filter(Boolean)) {
      const opens = token.startsWith('*')
      const closes = token.endsWith('*')
      if (opens) highlight = true
      words.push({ key: `${lineIndex}-${index}`, text: token.replace(/\*/g, ''), index: index++, highlight })
      if (closes) highlight = false
    }
    return { key: lineIndex, words }
  })
})
</script>

<template>
  <component :is="tag" class="word-reveal">
    <template v-for="(line, lineIndex) in parsedLines" :key="line.key">
      <span class="word-reveal__line">
        <template v-for="(word, position) in line.words" :key="word.key">
          <span
            class="word-reveal__word m m-word"
            :class="{ 'word-reveal__word--highlight': word.highlight }"
            :style="{ '--w': word.index }"
          >{{ word.text }}</span>{{ position < line.words.length - 1 ? ' ' : '' }}
        </template>
      </span>
      <!-- Lines are blocks: the space keeps screen readers from joining the last and first words. -->
      {{ lineIndex < parsedLines.length - 1 ? ' ' : '' }}
    </template>
  </component>
</template>

<style scoped>
.word-reveal {
  margin: 0;
}

.word-reveal__line {
  display: block;
  white-space: nowrap;
}

/* inline-block so each word can move on its own. */
.word-reveal__word {
  display: inline-block;
}
</style>
