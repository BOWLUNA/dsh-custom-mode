# 测试

```sh
# 从仓库直接跑（出厂预设不在仓库里，需要指向已安装的 dsh）
DSH_SHIPPED_PRESETS_DIR=/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets \
  node test/composition.test.mjs
```

装进 profile 之后，`editor/composition.mjs` 能自己从 `dsh-agent-presets` 定位出厂预设，
那时不需要环境变量。

## 这些测试在防什么

`composition.mjs` 做的是**文本手术**（保留出厂注释与 `!!js` 表达式），所以它的失败模式
大多是**静默错误行为**，而不是抛错。测试针对的正是这类：

- **未触碰的行必须逐字节不变**——否则会丢掉平台条件、或把出厂默认关闭的行打开。
- **`disabled` 必须定位到本行缩进**——否则关闭分组会改成子行的键，完全没有效果。
- **重新拼接必须无损**——否则注释行会与 YAML 键粘在一起，生成损坏的配置。
- **空区间必须返回空串**——否则每个分组首行前会多一个空行。

历史上这五个 bug 都真实出现过，测试是在它们出现之后补的。
