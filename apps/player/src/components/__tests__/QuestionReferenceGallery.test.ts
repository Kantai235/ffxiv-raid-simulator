import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { QuestionReferenceImage } from '@ffxiv-sim/shared';
import QuestionReferenceGallery from '../question/QuestionReferenceGallery.vue';

function makeImage(overrides: Partial<QuestionReferenceImage> = {}): QuestionReferenceImage {
  return {
    id: 'ref-1',
    src: 'https://example.com/image.png',
    alt: '參考圖',
    caption: '四連尖甲示意',
    sourceUrl: 'https://example.com/guide',
    sourceLabel: '攻略來源',
    ...overrides,
  };
}

describe('QuestionReferenceGallery', () => {
  it('顯示圖片、圖說與來源連結', () => {
    const wrapper = mount(QuestionReferenceGallery, {
      props: { images: [makeImage()] },
    });

    expect(wrapper.get('[data-testid="question-reference-gallery"]').text()).toContain(
      '題目參考圖片',
    );
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/image.png');
    expect(wrapper.text()).toContain('四連尖甲示意');
    expect(wrapper.get('a').attributes('href')).toBe('https://example.com/guide');
  });

  it('圖片載入失敗時改顯示提示框', async () => {
    const wrapper = mount(QuestionReferenceGallery, {
      props: { images: [makeImage()] },
    });

    await wrapper.get('img').trigger('error');

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="question-reference-placeholder"]').text()).toContain(
      '載入失敗',
    );
  });

  it('過濾空 src，沒有可顯示圖片時不渲染區塊', () => {
    const wrapper = mount(QuestionReferenceGallery, {
      props: { images: [makeImage({ src: '   ' })] },
    });

    expect(wrapper.find('[data-testid="question-reference-gallery"]').exists()).toBe(false);
  });
});
