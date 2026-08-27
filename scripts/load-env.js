// 从站点根目录读取 .env 并注入 process.env（不覆盖已存在的变量），
// 供本地开发提供 AI_CHAT_KEY 等密钥；线上由 CI 环境变量注入，无 .env 时静默跳过。
const { readFileSync } = require('fs')
const { join } = require('path')

try {
  const content = readFileSync(join(__dirname, '..', '.env'), 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const matched = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!matched) continue
    let value = matched[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(matched[1] in process.env)) process.env[matched[1]] = value
  }
} catch (error) {
  // .env 不存在（线上部署即如此），无需处理
}
