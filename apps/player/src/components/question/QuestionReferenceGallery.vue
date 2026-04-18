<script setup lang="ts">
import { computed, ref } from 'vue';
import type { QuestionReferenceImage } from '@ffxiv-sim/shared';

interface Props {
  images: QuestionReferenceImage[];
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '題目參考圖片',
});

const failedImageMap = ref<Record<string, boolean>>({});

const displayImages = computed(() =>
  props.images.filter((image) => typeof image.src === 'string' && image.src.trim().length > 0),
);

function imageKey(image: QuestionReferenceImage, index: number): string {
  return image.id ?? `${index}-${image.src}`;
}

function markImageFailed(key: string): void {
  failedImageMap.value = { ...failedImageMap.value, [key]: true };
}

function hasImageFailed(key: string): boolean {
  return failedImageMap.value[key] === true;
}

function resolveAltText(image: QuestionReferenceImage, index: number): string {
  return image.alt?.trim() || image.caption?.trim() || `題目參考圖片 ${index + 1}`;
}

function resolveSourceLabel(image: QuestionReferenceImage): string {
  return image.sourceLabel?.trim() || '來源';
}
</script>

<template>
  <section
    v-if="displayImages.length > 0"
    class="bg-ffxiv-panel/40 rounded-lg p-4 mb-4"
    data-testid="question-reference-gallery"
  >
    <div class="text-xs text-ffxiv-accent font-bold mb-2">{{ title }}</div>
    <div class="grid gap-4 md:grid-cols-2">
      <figure
        v-for="(image, idx) in displayImages"
        :key="imageKey(image, idx)"
        class="rounded-lg border border-white/10 bg-ffxiv-bg/60 p-3"
        :data-reference-image-index="idx"
      >
        <div
          class="rounded border border-white/10 bg-black/20 overflow-hidden min-h-48 flex items-center justify-center"
        >
          <img
            v-if="!hasImageFailed(imageKey(image, idx))"
            :src="image.src"
            :alt="resolveAltText(image, idx)"
            class="w-full max-h-80 object-contain"
            @error="markImageFailed(imageKey(image, idx))"
          />
          <div
            v-else
            class="px-4 py-6 text-center text-sm text-gray-400"
            data-testid="question-reference-placeholder"
          >
            參考圖片載入失敗
          </div>
        </div>

        <figcaption v-if="image.caption || image.sourceUrl" class="mt-3 space-y-1">
          <p v-if="image.caption" class="text-sm text-gray-200 leading-relaxed">
            {{ image.caption }}
          </p>
          <a
            v-if="image.sourceUrl"
            :href="image.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex text-xs text-ffxiv-accent hover:underline"
          >
            {{ resolveSourceLabel(image) }}
          </a>
        </figcaption>
      </figure>
    </div>
  </section>
</template>
