<script setup lang="ts">
// A comment body: plain text with light markdown (**bold**, *italic* or _italic_, `code`), links, and `<@id>`
// mentions shown as names. Built as text nodes and elements, never v-html, so nothing in a body can inject markup.
import type { SocialPerson } from '../../../shared/types/social'

const props = defineProps<{ body: string, mentions: SocialPerson[] }>()
const profileLink = useSocialProfileLink()

type Token =
  | { type: 'text' | 'bold' | 'italic' | 'code', text: string }
  | { type: 'link', text: string, href: string }
  | { type: 'mention', text: string, href: string | null }

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<![\w_])_[^_\s][^_\n]*_(?![\w_]))/g

function inline(text: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const raw = m[0]
    if (raw.startsWith('**')) out.push({ type: 'bold', text: raw.slice(2, -2) })
    else if (raw.startsWith('`')) out.push({ type: 'code', text: raw.slice(1, -1) })
    else out.push({ type: 'italic', text: raw.slice(1, -1) })
    last = m.index! + raw.length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

const tokens = computed<Token[]>(() => {
  const people = new Map(props.mentions.map((p) => [p.id, p]))
  const out: Token[] = []
  const SPLIT = new RegExp(`${MENTION_TOKEN.source}|${URL_RE.source}`, 'gi')
  let last = 0
  for (const m of props.body.matchAll(SPLIT)) {
    if (m.index! > last) out.push(...inline(props.body.slice(last, m.index)))
    if (m[1]) {
      const person = people.get(m[1].toLowerCase())
      out.push({ type: 'mention', text: `@${person?.name ?? 'member'}`, href: person ? profileLink(person.id) : null })
    } else {
      out.push({ type: 'link', text: m[0].replace(/^https?:\/\/(www\.)?/, ''), href: m[0] })
    }
    last = m.index! + m[0].length
  }
  if (last < props.body.length) out.push(...inline(props.body.slice(last)))
  return out
})
</script>

<template>
  <p class="text-sm leading-5 break-words whitespace-pre-line">
    <template v-for="(t, i) in tokens" :key="i">
      <template v-if="t.type === 'text'">{{ t.text }}</template>
      <strong v-else-if="t.type === 'bold'">{{ t.text }}</strong>
      <em v-else-if="t.type === 'italic'">{{ t.text }}</em>
      <code v-else-if="t.type === 'code'" class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{{ t.text }}</code>
      <a v-else-if="t.type === 'link'" :href="t.href" target="_blank" rel="nofollow ugc noopener noreferrer" class="text-brand underline-offset-2 hover:underline">{{ t.text }}</a>
      <NuxtLink v-else-if="t.type === 'mention' && t.href" :to="t.href" class="font-bold text-brand hover:underline">{{ t.text }}</NuxtLink>
      <span v-else class="font-bold text-brand">{{ t.text }}</span>
    </template>
  </p>
</template>
