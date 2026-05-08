# Open Source Base

本项目按 BoxyHQ SaaS Starter Kit 的产品结构思路落地：多租户组织、团队角色、审计日志、SaaS 设置、可自部署基础设施。由于当前工作区为空，首版实现采用干净 monorepo 搭建，保留可替换认证层和 RBAC 边界，便于后续直接吸收 BoxyHQ 的 SSO/Directory Sync 能力。

UI 采用 shadcn/admin 风格：密集、扫描友好、后台优先，不做营销型落地页。组件先使用本地 CSS token 与轻量 React 组件实现，后续可无痛替换为 shadcn/ui primitives。
