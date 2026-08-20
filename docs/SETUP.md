# recovery-dashboard 自动更新部署说明

## 工作原理

GitHub Actions 每周一 08:30（北京时间）自动执行：

1. 用飞书开放平台 API（自建应用）读取表格 `zXC4uk` 全部数据
2. 本地重新聚合计算（KPI / 图表 / SKU 表 / 每周趋势）
3. 重新生成 `index.html`
4. 提交并推送到 `main` 分支 → GitHub Pages 自动发布

## 一次性配置步骤

### 1. 创建飞书自建应用（约 5 分钟）

1. 打开 https://open.feishu.cn/app ，用你的飞书账号登录
2. 点「创建企业自建应用」，名称随意（如 `recovery-dashboard-sync`）
3. 左侧「权限管理」→「API 权限」，搜索并开通以下权限：
   - `sheets:spreadsheet:readonly`（查看电子表格）——读取表格数据
   - `wiki:wiki:readonly`（查看知识库）——解析 wiki 链接得到真实表格
4. 「版本管理与发布」→ 创建版本 → 申请发布（如企业有管理员审核，需管理员通过；个人自建一般立即生效）

### 2. 把表格分享给该应用

- 打开飞书表格 `MKT_2026年回收管理_S3`（wiki 里那个）
- 右上角「分享」→ 添加协作者 → 搜索刚创建的应用名称 → 权限选「可阅读」

### 3. 获取并配置密钥

- 开发者后台 →「凭证与基础信息」→ 记下 `App ID` 和 `App Secret`
- GitHub 仓库 `1876123508-jpg/recovery-dashboard` → Settings → Secrets and variables → Actions → New repository secret：
  - `FEISHU_APP_ID` = App ID
  - `FEISHU_APP_SECRET` = App Secret

### 4. 推送代码

把本目录下的 `scripts/`、`.github/workflows/update.yml`、`index.html` 上传到仓库（可用 GitHub 网页拖拽，或提供 PAT 由脚本推送）。

### 5. 手动验证

仓库 Actions 页面 → 左侧 `Update Dashboard from Feishu` → Run workflow → 看日志中的列识别结果：
`Column mapping: {...}` 和 `TOTAL=... Pending=...`，确认数字与飞书一致。

## 常见问题

- 日志出现 `WARN unknown status values` → 表格里状态列有未识别取值，把该值和表头贴给维护者调整 `scripts/aggregate.mjs` 的识别规则
- `WARN columns not detected: ...` → 列名与候选不符，把表头发给维护者补充
- wiki 解析返回 `obj_type=bitable` → 该文档是多维表格，需改用 bitable 接口（联系维护者）