# Agent Note: Pairing hashes must not sit next to scanner vendor tokens

Status: implemented

[English](2026-09-13-pairing-hash-scanner-collision.md) | 中文

## Problem

双语配对 sidecar 把每一侧记为紧挨 Markdown basename 的 40 位十六进制 git blob hash。把厂商名附近的 40 字符 token 当作该厂商 API 密钥的密钥扫描器会因此误报。basename 含 `cohere` 的配对 sidecar 曾对英文与中文 Agent Note 的 hash 各产生一条 GitGuardian「Cohere API Key」事件；那些值是 `git hash-object` 的输出，不是凭证。

## Decision

配对的英文 basename 不得包含 [`scripts/translation-pairing-record.ts`](../../../../scripts/translation-pairing-record.ts) 中 `PAIRING_BASENAME_SCANNER_COLLISIONS` 的词。`verify-translation-pairing` 在检查与 `--write` 时拒绝这些 slug。该列表从 `cohere` 开始，仅在现行检测器会匹配 sidecar 格式时扩展。[`.gitguardian.yaml`](../../../../.gitguardian.yaml) 忽略 `**/*.i18n.yaml`，因为按[配对约定](../../../../docs/i18n/README.md#the-pairing-contract)这些文件只保存 hash。正文仍可写出厂商名。

## Alternatives considered

**给每条已记录 hash 加前缀（`git-blob:<sha>`）。** 否决：为了让扫描器安静，就要改写每份 sidecar、合并驱动与恢复 ref，而不是保持 `git hash-object` 打印的 hash。

**改写引入提交，从历史中去掉碰撞 slug。** 对此次误报否决：这些值是公开的 blob hash，不是凭证。在 GitGuardian 中把事件标为误报；不要轮换从未提交过的密钥。

**在整个仓库关闭 Cohere 检测器。** 否决：源码、配置或夹具里的真实 `COHERE_API_KEY` 值仍必须告警。

**只重命名碰撞的配对，不对格式设门禁。** 否决：下一份带厂商名的配对会再次触发同一类检测器。

## Consequences

作者为特定厂商写 Note 时，不得把碰撞词放进 slug。源码、overlay 与夹具中的真实 API 密钥仍会告警。配对 hash 上的历史扫描事件会留在厂商控制台，直到被标为误报；后续提交不会抹掉已被扫描的提交。

## Testing

`scripts/translation-pairing.spec.ts` 锁定 `cohere` basename 为碰撞，以及 `coherent` 子串与普通采购 slug 为可通过。`verify-translation-pairing` 是对范围内碰撞配对的已执行检查。
