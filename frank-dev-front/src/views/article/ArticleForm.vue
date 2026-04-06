<template>
  <div class="article-form-container">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ isEdit ? '编辑文章' : '新建文章' }}</span>
          <el-button @click="handleBack">返回</el-button>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-width="100px"
        style="max-width: 800px"
      >
        <el-form-item label="标题" prop="title">
          <el-input v-model="formData.title" placeholder="请输入文章标题" maxlength="200" show-word-limit />
        </el-form-item>

        <el-form-item label="分类" prop="categoryId">
          <el-select v-model="formData.categoryId" placeholder="请选择分类" clearable>
            <el-option
              v-for="category in articleStore.categories"
              :key="category.id"
              :label="category.categoryName"
              :value="category.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="摘要" prop="summary">
          <el-input
            v-model="formData.summary"
            type="textarea"
            :rows="3"
            placeholder="请输入文章摘要"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="内容" prop="content">
          <el-input
            v-model="formData.content"
            type="textarea"
            :rows="15"
            placeholder="请输入文章内容"
          />
        </el-form-item>

        <el-form-item label="封面图片" prop="coverImage">
          <el-input v-model="formData.coverImage" placeholder="请输入封面图片地址" />
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="formData.status">
            <el-radio :value="0">草稿</el-radio>
            <el-radio :value="1">发布</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="备注" prop="remark">
          <el-input v-model="formData.remark" placeholder="请输入备注" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSubmit">{{ isEdit ? '更新' : '创建' }}</el-button>
          <el-button @click="handleBack">取消</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import useArticleStore from '@/store/article/article';

const route = useRoute();
const router = useRouter();
const articleStore = useArticleStore();
const formRef = ref(null);

const isEdit = computed(() => !!route.params.id);

const formData = ref({
  id: null,
  title: '',
  content: '',
  summary: '',
  coverImage: '',
  categoryId: null,
  status: 0,
  remark: '',
});

const rules = {
  title: [
    { required: true, message: '请输入文章标题', trigger: 'blur' },
    { min: 1, max: 200, message: '标题长度在1到200之间', trigger: 'blur' },
  ],
};

onMounted(() => {
  articleStore.fetchCategories();
  if (isEdit.value) {
    articleStore.fetchArticle(route.params.id).then(() => {
      const article = articleStore.currentArticle;
      formData.value = {
        id: article.id,
        title: article.title,
        content: article.content,
        summary: article.summary,
        coverImage: article.coverImage,
        categoryId: article.categoryId,
        status: article.status,
        remark: article.remark,
      };
    });
  }
});

function handleSubmit() {
  formRef.value.validate((valid) => {
    if (!valid) return;

    const action = isEdit.value
      ? articleStore.updateArticle(formData.value)
      : articleStore.createArticle(formData.value);

    action.then(() => {
      ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
      router.push('/article/list');
    });
  });
}

function handleBack() {
  router.push('/article/list');
}
</script>

<style scoped>
.article-form-container {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
