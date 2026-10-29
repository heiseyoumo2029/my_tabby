# Features

## Purpose

跟踪 SSH 标签操作与 SFTP 功能的实现和待验证事项。

## Status Rules

`planned` 为已规划，`in progress` 为开发或验证中，`implemented` 为实现并完成验证，`deferred` 为暂缓。

## Current Capabilities

- SSH 标签支持单标签重连及打开 SFTP；SSH shell 使用 OSC 1337 上报工作目录。
- SFTP 支持浏览目录、上传和下载；分屏标签可通过 `SplitTabComponent.getAllTabs()` 枚举。

## Planned Features

### 连接信息复制

- 状态：`in progress`；目标是在连接信息旁复制配置主机、端口或二者。
- 实现：连接信息旁分别提供主机、端口和组合的一键按钮；`tabby-ssh/src/components/sshTab.component.*` 使用剪贴板 API，IPv6 地址加方括号；域名不解析为 IP。
- 后续：安装依赖后验证菜单、剪贴板、默认端口和 IPv6。

### 批量重连 SSH 标签

- 状态：`in progress`；目标是一次重连所有 SSH 标签及分屏中的 SSH 标签。
- 实现：在 SSH 工具栏选择仅断开会话或全部会话后逐个调用既有重连逻辑；跳过正在连接的会话并报告失败，不包含本地、Telnet 或 Serial。
- 风险及后续：验证认证提示、共享连接、标签关闭和失败处理；重连会中断当前 shell。

### SFTP 对应终端目录

- 状态：`in progress`；目标是打开面板或手动同步到 shell 或 tmux pane 目录。
- 实现：SFTP 面板可使用 shell 目录上报，也可查询 tmux pane 并选择对应目录；支持按标签设置 tmux 可执行文件和自定义 socket 绝对路径，独立 SSH exec channel 返回远端错误。
- 风险及后续：需在远端 CI 和实际桌面应用验证；自定义 socket 需要手动指定，不同用户或嵌套 SSH 的 tmux 无法直接查询，tmux 目录需要手动选择 pane。

### 跨标签文件传输

- 状态：`in progress`；目标是 SSH 标签之间通过客户端中转复制文件。
- 实现：选择目标标签后可输入目标主机绝对目录，并通过 SFTP 检查目录；复用两端句柄分块传输，接入传输面板和取消功能；目标使用排他创建，重名不覆盖，失败后尝试清理。
- 风险及后续：需在远端 CI 和实际桌面应用验证；连接中断可能使不完整目标文件残留。目录、符号链接、批量和断点续传暂不支持。

## Technical Principles

- 优先复用现有连接和 SFTP API；保持内存有界，避免意外覆盖文件。
- 未经实际验证的多 pane 目录不应被当作可靠的当前目录。

## Delivery Plan

1. 通过 GitHub Actions 验证构建、传输及 tmux 查询测试。
2. 在实际桌面应用验证菜单、批量重连和跨标签传输。
3. 后续考虑自动识别 tmux pane、目录传输和断点续传。

## Change Log

- 2026-10-29：记录 SSH 工具栏复制、批量重连、SFTP 目录同步和跨标签传输的进度。
- 2026-10-29：加入 tmux pane 选择、跨标签单文件中转和远端 CI 测试。
- 2026-10-29：改为单击复制，并为跨标签传输增加目标目录输入和验证。
- 2026-10-29：增加仅重连断开会话选项和 tmux 自定义 socket 及远端错误提示。
- 2026-10-29：增加独立 tmux 客户端路径设置，并在远端 CI 用真实 SSH 通道与 tmux 3.0a、3.4 验证 pane 和目录查询。
