<template>
  <div class="title-card" v-if="title">
    <h3>{{ title }}</h3>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' }
})
</script>

<style scoped>
.title-card {
  margin-bottom: 10px; /* 减小边距 */
  padding: 0 4px;
}

.title-card h3 {
  margin: 0;
  font-size: 16px; /* 稍微减小字体 */
  font-weight: 600;
  color: #2c3e50;
  padding: 8px 8px;
}
</style>
