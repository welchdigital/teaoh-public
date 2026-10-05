import { toValue, watch } from 'vue';
import { useRoute } from 'vue-router';

export const APP_TITLE = 'teaoh admin';

export function titleFor(route) {
  const title = route && route.meta && route.meta.title;
  return title ? `${title} · ${APP_TITLE}` : APP_TITLE;
}

export function usePageTitle(source) {
  const route = useRoute();
  const name = route.name;
  watch(
    [() => toValue(source), () => route.fullPath],
    ([value]) => {
      if (route.name !== name) return;
      document.title = value ? `${value} · ${APP_TITLE}` : titleFor(route);
    },
    { immediate: true },
  );
}
