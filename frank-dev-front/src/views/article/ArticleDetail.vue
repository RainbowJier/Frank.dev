<template>
  <div class="article-detail-container">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>文章详情</span>
          <div>
            <el-button type="primary" @click="handleEdit">编辑</el-button>
            <el-button @click="handleBack">返回</el-button>
          </div>
        </div>
      </template>

      <div v-loading="loading" class="article-content">
        <template v-if="article">
          <h1 class="article-title">{{ article.title }}</h1>

          <div class="article-meta">
            <el-tag :type="article.status === 1 ? 'success' : 'info'" class="meta-item">
              {{ article.status === 1 ? '已发布' : '草稿' }}
            </el-tag>
            <el-tag v-if="article.isTop === 1" type="warning" class="meta-item">置顶</el-tag>
            <span class="meta-item">分类：{{ article.categoryName || '未分类' }}</span>
            <span class="meta-item">浏览：{{ article.viewCount }}</span>
            <span class="meta-item">创建时间：{{ article.createTime }}</span>
          </div>

          <el-divider />

          <div class="article-body" v-html="article.content" />
        </template>

        <el-empty v-else description="文章不存在" />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import useArticleStore from '@/store/article/article';

const route = useRoute();
const router = useRouter();
const articleStore = useArticleStore();
const loading = ref(false);
const article = ref(null);

onMounted(() => {
  loading.value = true;
  articleStore.fetchArticle(route.params.id).then(() => {
    article.value = articleStore.currentArticle;
  }).finally(() => {
    loading.value = false;
  });
});

function handleEdit() {
  router.push(`/article/edit/${route.params.id}`);
}

function handleBack() {
  router.push('/article/list');
}
</script>

<style scoped>
.article-detail-container {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.article-content {
  min-height: 300px;
}

.article-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 16px;
}

.article-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  color: #909399;
  font-size: 14px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
}

.article-body {
  line-height: 1.8;
  font-size: 16px;
}
</style>
