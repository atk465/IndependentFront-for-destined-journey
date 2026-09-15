/**
 * CreateStepDestinyCore — 命定核心单选步骤
 *
 * 工坊下线后这一步回到单轴：只管命定核心单选。本文件盯的是「单选语义」与
 * 「选中详情卡片」，不是像素。
 *
 * store mock 用 reactive: 裸对象会切断响应式链，"勾选后卡片变 checked" 那条
 * 断言会变得恒真/恒假，测不出东西。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import CreateStepDestinyCore from './CreateStepDestinyCore.vue';

let mockCreate: any;

vi.mock('../../stores/create-store', () => ({
  useCreateStore: () => mockCreate,
}));

beforeEach(() => {
  mockCreate = reactive({
    systemCoreEntries: [
      { uid: 413, name: '剑之魂', content: '一柄剑的低语。' },
      { uid: 414, name: '书之灵', content: '无尽书库的守门人。' },
    ],
    selectedSystemCoreEntryUid: null as number | null,
    get selectedSystemCoreEntry() {
      return (
        this.systemCoreEntries.find((e: any) => e.uid === this.selectedSystemCoreEntryUid) ?? null
      );
    },
    selectSystemCoreEntry(uid: number | null) {
      mockCreate.selectedSystemCoreEntryUid = uid;
    },
  });
});

describe('CreateStepDestinyCore — 命定核心单选', () => {
  it('核心名单完整渲染全部内置条目', () => {
    const wrapper = mount(CreateStepDestinyCore);
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(2);
    expect(wrapper.text()).toContain('剑之魂');
    expect(wrapper.text()).toContain('书之灵');
  });

  it('命定核心单选照旧可用', async () => {
    const wrapper = mount(CreateStepDestinyCore);
    await wrapper.findAll('.core-row-body')[1].trigger('click');
    expect(mockCreate.selectedSystemCoreEntryUid).toBe(414);
    expect(wrapper.find('.selected-detail').text()).toContain('书之灵');
  });

  it('取消选择后详情卡片消失', async () => {
    const wrapper = mount(CreateStepDestinyCore);
    await wrapper.findAll('.core-row-body')[0].trigger('click');
    expect(wrapper.find('.selected-detail').exists()).toBe(true);
    await wrapper.find('.sd-deselect').trigger('click');
    expect(mockCreate.selectedSystemCoreEntryUid).toBeNull();
    expect(wrapper.find('.selected-detail').exists()).toBe(false);
  });
});
