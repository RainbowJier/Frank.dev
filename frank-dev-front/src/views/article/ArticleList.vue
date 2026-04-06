<template>
  <div class="article-list-container">
    <!-- 搜索栏 -->
    <el-card class="search-card" shadow="never">
      <el-form :model="queryParams" inline>
        <el-form-item label="标题">
          <el-input
            v-model="queryParams.title"
            placeholder="请输入文章标题"
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="queryParams.categoryId" placeholder="请选择分类" clearable>
            <el-option
              v-for="category in articleStore.categories"
              :key="category.id"
              :label="category.categoryName"
              :value="category.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryParams.status" placeholder="请选择状态" clearable>
            <el-option label="草稿" :value="0" />
            <el-option label="已发布" :value="1" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 操作栏 -->
    <el-card class="table-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>文章列表</span>
          <el-button type="primary" @click="handleCreate">新建文章</el-button>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="articleStore.articleList" border stripe>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="categoryName" label="分类" width="120" />
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'">
              {{ row.status === 1 ? '已发布' : '草稿' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="isTop" label="置顶" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isTop === 1" type="warning">置顶</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="viewCount" label="浏览量" width="90" align="center" />
        <el-table-column prop="createTime" label="创建时间" width="180" />
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleView(row)">查看</el-button>
            <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button
              link
              :type="row.status === 1 ? 'warning' : 'success'"
              @click="handleToggleStatus(row)"
            >
              {{ row.status === 1 ? '取消发布' : '发布' }}
            </el-button>
            <el-button
              link
              :type="row.isTop === 1 ? 'warning' : 'success'"
              @click="handleToggleTop(row)"
            >
              {{ row.isTop === 1 ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="articleStore.pageNum"
          v-model:page-size="articleStore.pageSize"
          :total="articleStore.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSearch"
          @current-change="handleSearch"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import useArticleStore from '@/store/article/article';

const router = useRouter();
const articleStore = useArticleStore();
const loading = ref(false);

const queryParams = ref({
  title: '',
  categoryId: null,
  status: null,
});

onMounted(() => {
  articleStore.fetchCategories();
  handleSearch();
});

function handleSearch() {
  loading.value = true;
  articleStore.fetchArticles(queryParams.value).finally(() => {
    loading.value = false;
  });
}

function handleReset() {
  queryParams.value = { title: '', categoryId: null, status: null };
  handleSearch();
}

function handleCreate() {
  router.push('/article/create');
}

function handleView(row) {
  router.push(`/article/detail/${row.id}`);
}

function handleEdit(row) {
  router.push(`/article/edit/${row.id}`);
}

function handleToggleStatus(row) {
  const newStatus = row.status === 1 ? 0 : 1;
  const text = newStatus === 1 ? '发布' : '取消发布';
  ElMessageBox.confirm(`确认${text}文章「${row.title}」？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    articleStore.updateStatus(row.id, newStatus).then(() => {
      ElMessage.success(`${text}成功`);
      handleSearch();
    });
  }).catch(() => {});
}

function handleToggleTop(row) {
  const newTop = row.isTop === 1 ? 0 : 1;
  const text = newTop === 1 ? '置顶' : '取消置顶';
  ElMessageBox.confirm(`确认${text}文章「${row.title}」？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    articleStore.updateTop(row.id, newTop).then(() => {
      ElMessage.success(`${text}成功`);
      handleSearch();
    });
  }).catch(() => {});
}

function handleDelete(row) {
  ElMessageBox.confirm(`确认删除文章「${row.title}」？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    articleStore.deleteArticle(row.id).then(() => {
      ElMessage.success('删除成功');
      handleSearch();
    });
  }).catch(() => {});
}
</script>

<style scoped>
.article-list-container {
  padding: 20px;
}

.search-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
