// 全域 UI 小工具：提示訊息與確認視窗
import { reactive } from 'vue';

export const toastState = reactive({ text: '', show: false, gold: false });
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, opts: { gold?: boolean; ms?: number } = {}) {
  toastState.text = text;
  toastState.gold = !!opts.gold;
  toastState.show = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastState.show = false), opts.ms ?? 2800);
}

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  okText: '確定',
  resolve: null as null | ((v: boolean) => void),
});

export function confirmDialog(title: string, message: string, okText = '確定'): Promise<boolean> {
  confirmState.resolve?.(false);
  return new Promise((resolve) => {
    Object.assign(confirmState, { open: true, title, message, okText, resolve });
  });
}

export function closeConfirm(v: boolean) {
  const r = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  r?.(v);
}
