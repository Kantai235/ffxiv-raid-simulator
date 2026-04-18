<script setup lang="ts">
import { computed, ref } from 'vue';
import type { QuestionOption } from '@ffxiv-sim/shared';

interface Props {
  option: QuestionOption;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
});

const failed = ref(false);

const hasImage = computed(
  () => typeof props.option.imageSrc === 'string' && props.option.imageSrc.trim().length > 0,
);

function markFailed(): void {
  failed.value = true;
}

function resolveAlt(): string {
  return props.option.imageAlt?.trim() || props.option.label.trim() || '選項圖片';
}
</script>

<template>
  <div class="flex-1 min-w-0 space-y-2">
    <div
      v-if="hasImage"
      class="rounded border border-white/10 bg-black/20 overflow-hidden"
      :class="compact ? 'max-w-32' : ''"
    >
      <img
        v-if="!failed"
        :src="option.imageSrc"
        :alt="resolveAlt()"
        class="w-full object-contain"
        :class="compact ? 'max-h-24' : 'max-h-48'"
        data-testid="question-option-image"
        @error="markFailed"
      />
      <div
        v-else
        class="px-3 py-4 text-xs text-center text-gray-400"
        data-testid="question-option-image-placeholder"
      >
        選項圖片載入失敗
      </div>
    </div>
    <div class="text-sm leading-relaxed break-words">{{ option.label }}</div>
  </div>
</template>
