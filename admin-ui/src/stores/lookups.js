import { ref, shallowRef } from 'vue';
import { api, whenSettled } from '../api.js';

const classes = shallowRef(null);
const classesError = shallowRef(null);
let classesPromise = null;

export function useClasses() {
  if (!classesPromise) {
    classesPromise = whenSettled()
      .then(() => api.dataClasses())
      .then((list) => {
        classes.value = Array.isArray(list) ? list : [];
        classesError.value = null;
      })
      .catch((err) => {
        classesError.value = err;
        classesPromise = null;
      });
  }
  return { classes, error: classesError };
}

const maps = shallowRef(null);
const mapsError = shallowRef(null);
const mapsLoading = ref(false);
let mapsFetchedAt = 0;
let mapsPromise = null;

function loadMaps() {
  if (mapsPromise) return mapsPromise;
  mapsLoading.value = true;
  mapsPromise = whenSettled()
    .then(() => api.maps())
    .then((list) => {
      maps.value = Array.isArray(list) ? [...list].sort((a, b) => a.id - b.id) : [];
      mapsError.value = null;
      mapsFetchedAt = Date.now();
    })
    .catch((err) => {
      mapsError.value = err;
    })
    .finally(() => {
      mapsLoading.value = false;
      mapsPromise = null;
    });
  return mapsPromise;
}

export function useMapList(maxAgeMs = 60000) {
  if (!maps.value || Date.now() - mapsFetchedAt > maxAgeMs) loadMaps();
  return { maps, error: mapsError, loading: mapsLoading, refresh: loadMaps };
}

export function mapLabel(id) {
  const found = maps.value && maps.value.find((m) => m.id === id);
  return found && found.name ? `${id} · ${found.name}` : `Map ${id}`;
}
