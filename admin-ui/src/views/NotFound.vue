<script setup>
import { RouterLink, useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div class="panel state" style="max-width: 560px; margin: 3rem auto">
    <h1 style="font-size: 2.5rem; margin: 0">404</h1>
    <p style="margin: 0">There is no page at <span class="mono">{{ route.fullPath }}</span>.</p>
    <RouterLink class="btn btn-accent" to="/">Go to the dashboard</RouterLink>
  </div>
</template>
