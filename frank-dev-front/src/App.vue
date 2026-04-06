<template>
  <Transition name="loader-fade">
    <div v-if="isLoading" class="global-loader-wrapper">
      <AnimatedLoader />
    </div>
  </Transition>
  <router-view />
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import AnimatedLoader from '@/components/AnimatedLoader.vue'

const router = useRouter()
const isLoading = ref(false)

router.beforeEach((to, from, next) => {
  isLoading.value = true
  next()
})

router.afterEach(() => {
  // 无延迟，直接在新页面渲染时隐藏加载动画
  nextTick(() => {
    isLoading.value = false
  })
})
</script>

<style>
.global-loader-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  z-index: 9999;
}

.loader-fade-enter-active,
.loader-fade-leave-active {
  transition: opacity 0.15s ease;
  pointer-events: none; /* 确保渐隐时即使有残影也不会遮挡底部页面的点击事件 */
}

.loader-fade-enter-from,
.loader-fade-leave-to {
  opacity: 0;
}
</style>
