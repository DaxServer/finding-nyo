import { onMounted } from "vue";

export function useInitOnResize(
  wrapEl: () => HTMLDivElement,
  mapEl: () => HTMLDivElement,
  init: (h: number) => void,
) {
  onMounted(() => {
    let initialized = false;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h === 0 || initialized) return;
      initialized = true;
      observer.disconnect();
      mapEl().style.height = h + "px";
      init(h);
    });
    observer.observe(wrapEl());
  });
}
