import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { QuestionOption } from '@ffxiv-sim/shared';
import QuestionOptionMedia from '../question/QuestionOptionMedia.vue';

function makeOption(overrides: Partial<QuestionOption> = {}): QuestionOption {
  return {
    id: 'opt-1',
    label: '看 A 圖處理',
    imageSrc: 'https://example.com/option-a.png',
    imageAlt: 'A 圖站位',
    ...overrides,
  };
}

describe('QuestionOptionMedia', () => {
  it('顯示選項圖片與文字', () => {
    const wrapper = mount(QuestionOptionMedia, {
      props: {
        option: makeOption(),
      },
    });

    expect(wrapper.get('[data-testid="question-option-image"]').attributes('src')).toBe(
      'https://example.com/option-a.png',
    );
    expect(wrapper.text()).toContain('看 A 圖處理');
  });

  it('圖片載入失敗時顯示 placeholder', async () => {
    const wrapper = mount(QuestionOptionMedia, {
      props: {
        option: makeOption(),
      },
    });

    await wrapper.get('img').trigger('error');

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="question-option-image-placeholder"]').text()).toContain(
      '載入失敗',
    );
  });

  it('沒有 imageSrc 時只顯示文字', () => {
    const wrapper = mount(QuestionOptionMedia, {
      props: {
        option: makeOption({ imageSrc: undefined, imageAlt: undefined }),
      },
    });

    expect(wrapper.find('[data-testid="question-option-image"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('看 A 圖處理');
  });
});
