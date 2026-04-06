<template>
  <div class="app-container" style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
    <div style="text-align: center;">
      <h1>Welcome to the System</h1>
      <p>Authentication successful.</p>
      <el-button type="primary" @click="handleLogout">Logout</el-button>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import useUserStore from '@/store/auth/user';

const router = useRouter();
const userStore = useUserStore();

const handleLogout = async () => {
  await userStore.logout();
  router.push('/login');
};
</script>

<style scoped>
</style>
