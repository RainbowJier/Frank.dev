import ElementPlus from 'element-plus'
import Cookies from 'js-cookie'
import { createApp } from 'vue'


import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import locale from 'element-plus/es/locale/lang/zh-cn'

import { download } from '@/utils/request'

import App from './App'
import router from './router'
import store from './store'

// 注册指令
import * as ElementPlusIconsVue from '@element-plus/icons-vue' // Import Element Plus icons


const app = createApp(App)

app.config.globalProperties.download = download

app.use(router)
app.use(store)

// Register all Element Plus Icons
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 使用element-plus 并且设置全局的大小
app.use(ElementPlus, {
  locale,
  // 支持 large、default、small
  size: Cookies.get('size') || 'default'
})

app.mount('#app')


