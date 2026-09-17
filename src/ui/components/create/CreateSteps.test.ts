/**
 * CreateSteps.vue — 5 步指示器测试
 * （2026-09-16 精简 9→6 步；2026-09-17 删「启用角色」步 → 5 步）
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CreateSteps from './CreateSteps.vue';

describe('CreateSteps', () => {
  it('渲染 5 个步骤按钮', () => {
    const wrapper = mount(CreateSteps, {
      props: { current: 0 },
    });
    const dots = wrapper.findAll('.step-dot');
    expect(dots).toHaveLength(5);
  });

  it('当前步骤有 active class', () => {
    const wrapper = mount(CreateSteps, {
      props: { current: 3 },
    });
    const dots = wrapper.findAll('.step-dot');
    expect(dots[3].classes()).toContain('active');
    expect(dots[0].classes()).not.toContain('active');
  });

  it('已完成步骤有 done class', () => {
    const wrapper = mount(CreateSteps, {
      props: { current: 3 },
    });
    const dots = wrapper.findAll('.step-dot');
    expect(dots[0].classes()).toContain('done');
    expect(dots[1].classes()).toContain('done');
    expect(dots[2].classes()).toContain('done');
    expect(dots[3].classes()).not.toContain('done');
  });

  it('步骤标签文本正确', () => {
    const wrapper = mount(CreateSteps, {
      props: { current: 0 },
    });
    const labels = wrapper.findAll('.step-label');
    expect(labels[0].text()).toBe('难度选择');
    expect(labels[1].text()).toBe('基础信息');
    expect(labels[2].text()).toBe('出身天赋');
    expect(labels[3].text()).toBe('装备选择');
    expect(labels[4].text()).toBe('剧情规划');
  });
});
