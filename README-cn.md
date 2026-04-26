# Sub-Store ClashMeta Fixer
## 这是什么

用于修复任何或 Sub-Store 导出的 ClashMeta / Mihomo 订阅。

有些 Sub-Store 输出只有 `proxies:`，没有 `proxy-groups:` 和 `rules:`。这种配置导入 FlClash / Clash.Meta / Mihomo 后，在规则模式下可能没有代理组、没有分流，甚至看起来像没有可用节点。

本工具会补齐：

- 原始节点
- 中文策略组
- 国内直连、其他走代理的基础规则

## 功能

- 修复只有 `proxies:` 的 Sub-Store ClashMeta 输出。
- 自动生成 `proxy-groups:` 和 `rules:`。
- 保留 `trojan`、`vless`、`hysteria2`、`hy2` 等 Mihomo 常用节点。
- 自动按节点名生成地区组。
- 把刷新、到期、流量等信息节点放入 `ℹ️ 订阅信息`，不参与主代理组。
- 同时支持本地 Windows 转换和 Sub-Store 自动转换。

## 文件说明

- `readme.md`
  - 当前用户使用说明。
- `Generate-ClashMeta-Profile.bat`
  - Windows 双击入口。
- `Generate-ClashMeta-Profile.ps1`
  - 本地核心转换脚本。
- `SubStore-ClashMeta-Fixer.js`
  - Sub-Store 面板脚本版本。
- `Output\`
  - 本地生成目录。生成的订阅文件默认不提交到 GitHub。

## 方法一：本地手动转换

双击：

```bat
Generate-ClashMeta-Profile.bat
```

或命令行运行：

```bat
Generate-ClashMeta-Profile.bat "<订阅链接>"
```

生成结果：

```text
Output\ClashMeta_Fixed.yaml
```

把这个文件导入 FlClash / Clash.Meta / Mihomo 即可。

## 方法二：Sub-Store 自动转换

如果不想每次手动复制订阅链接运行 `.bat`，使用：

```text
SubStore-ClashMeta-Fixer.js
```

推荐流程：

1. 在 Sub-Store 中保留原始订阅。
2. 输出目标选择 `ClashMeta`。
3. 进入 `文件`，新建或编辑一个 `Mihomo 配置` 文件。
4. 让这个文件引用原始订阅或组合订阅，例如 `VPN_03`。
5. 把 `SubStore-ClashMeta-Fixer.js` 放到文件编辑页的 `JavaScript/YAML 覆写` 或脚本操作区域。
6. 预览这个文件，确认输出里有 `proxies:`、`proxy-groups:`、`rules:`。
7. 进入 `同步`，新建同步任务，让同步任务引用上面这个文件。
8. 复制同步任务生成的链接，把这个链接填进 FlClash / Mihomo。

之后客户端每次刷新订阅，都会自动拿到修复后的完整配置。

注意：不要把这个脚本只放在“订阅编辑 -> 节点操作 -> 脚本操作”里。那个阶段只能处理节点数组，不能修改最终 YAML，所以无法新增 `proxy-groups:` 和 `rules:`。

## 作为订阅链接使用

最终推荐使用 `同步` 里生成的链接作为订阅链接。

原因是：

- `文件` 负责生成修复后的 Mihomo / ClashMeta 配置。
- `同步` 负责把这个文件变成稳定、可复制、可定时刷新的订阅链接。
- 浏览器里的文件预览只是确认输出内容，不是最方便的客户端订阅入口。

Sub-Store 同步弹窗里显示的链接形如：

```text
http(s)://<你的 Sub-Store 地址>/api/file/<随机文件ID或同步ID>
```

把这个完整链接填进 FlClash / Mihomo 的订阅地址即可。

如果怀疑缓存，可以在链接后加：

```text
?noCache=1
```

## 上传 GitHub 前检查

提交前建议确认：

- 不要提交真实订阅链接、token、机场域名、私有节点信息。
- 不要提交 `Output\ClashMeta_Fixed.yaml` 这类生成结果。
- `.gitignore` 已经忽略 `Output` 里的生成文件，只保留目录占位。
- 如果要开源，请自己选择并添加合适的 `LICENSE` 文件。

## 当前分流逻辑

- 国内域名、`.cn`、常见国内服务、局域网、私有 IP、中国 GeoIP -> `DIRECT`
- 其他未命中流量 -> `🚀 节点选择`

这不是按 App 包名分流。Clash / Mihomo 主要按域名、IP 和规则集分流。

## 策略组

生成配置包含：

- `🚀 节点选择`
- `⚡ 自动测速`
- `🛟 故障转移`
- `🇺🇸 美国节点`
- `🇭🇰 香港节点`
- `🇯🇵 日本节点`
- `🇸🇬 新加坡节点`
- `🇹🇼 台湾节点`
- `🇰🇷 韩国节点`
- `🌐 其他节点`
- `ℹ️ 订阅信息`

注意：`DIRECT` 是 Clash / Mihomo 内置关键字，不能改成中文。
