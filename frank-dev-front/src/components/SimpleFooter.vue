<template>
  <footer class="simple-footer">
    <slot>
      <p>© {{ year }} {{ company }}. All rights reserved.</p>
    </slot>
  </footer>
</template>

<script setup>
defineProps({
  year: {
    type: [String, Number],
    default: new Date().getFullYear()
  },
  company: {
    type: String,
    default: "Frank.dev"
  }
});
</script>

<style scoped>
.simple-footer {
  width: 100%;
  padding: 1.25rem 0;
  text-align: center;
  color: #A09C8F;
  font-size: 0.875rem;
  font-weight: 600;
}

.simple-footer p {
  margin: 0;
}
</style>
