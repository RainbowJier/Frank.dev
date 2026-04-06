<template>
  <div class="category-list-container">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>分类管理</span>
          <el-button type="primary" @click="handleAdd">新建分类</el-button>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="articleStore.categories" border stripe>
        <el-table-column prop="categoryName" label="分类名称" min-width="200" />
        <el-table-column prop="sortOrder" label="排序" width="100" align="center" />
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="articleCount" label="文章数" width="100" align="center" />
        <el-table-column prop="createTime" label="创建时间" width="180" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑分类' : '新建分类'"
      width="500px"
    >
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="80px">
        <el-form-item label="分类名称" prop="categoryName">
          <el-input v-model="formData.categoryName" placeholder="请输入分类名称" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="排序" prop="sortOrder">
          <el-input-number v-model="formData.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="formData.status">
            <el-radio :value="1">正常</el-radio>
            <el-radio :value="0">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="formData.remark" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import useArticleStore from '@/store/article/article';

const articleStore = useArticleStore();
const loading = ref(false);
const dialogVisible = ref(false);
const isEdit = ref(false);
const formRef = ref(null);

const formData = ref({
  id: null,
  categoryName: '',
  sortOrder: 0,
  status: 1,
  remark: '',
});

const rules = {
  categoryName: [
    { required: true, message: '请输入分类名称', trigger: 'blur' },
    { min: 1, max: 50, message: '分类名称长度在1到50之间', trigger: 'blur' },
  ],
};

onMounted(() => {
  loadCategories();
});

function loadCategories() {
  loading.value = true;
  articleStore.fetchCategories().finally(() => {
    loading.value = false;
  });
}

function handleAdd() {
  isEdit.value = false;
  formData.value = { id: null, categoryName: '', sortOrder: 0, status: 1, remark: '' };
  dialogVisible.value = true;
}

function handleEdit(row) {
  isEdit.value = true;
  formData.value = {
    id: row.id,
    categoryName: row.categoryName,
    sortOrder: row.sortOrder,
    status: row.status,
    remark: row.remark,
  };
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid) => {
    if (!valid) return;

    const action = isEdit.value
      ? articleStore.updateCategory(formData.value)
      : articleStore.createCategory(formData.value);

    action.then(() => {
      ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
      dialogVisible.value = false;
      loadCategories();
    });
  });
}

function handleDelete(row) {
  ElMessageBox.confirm(`确认删除分类「${row.categoryName}」？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    articleStore.deleteCategory(row.id).then(() => {
      ElMessage.success('删除成功');
      loadCategories();
    });
  }).catch(() => {});
}
</script>

<style scoped>
.category-list-container {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
