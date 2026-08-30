# PMData Pattern 数量验证

## 样本口径

- 16 名参与者。
- 每个个人滚动窗口最多覆盖 42 个日历日。
- 每 14 天抽取一个窗口，并补充每名参与者最后一个有效窗口。
- 共回放 135 个窗口。
- Candidate 数量由模型在 1–4 个形态之间选择。
- 可见 Pattern 需要满足 `Emergence ≥ 55`、`Confidence ≥ 55`、`N_eff ≥ 4`。

模型只有在新增 Candidate 同时改善轮廓系数、解释新增结构并通过重采样稳定性检查时，才接受更细的划分。模型不会按目标数量拆分睡眠记录。

## Candidate 数量

| Candidate 数 | 窗口数 | 占比 |
|---:|---:|---:|
| 0 | 6 | 4.4% |
| 1 | 47 | 34.8% |
| 2 | 45 | 33.3% |
| 3 | 26 | 19.3% |
| 4 | 11 | 8.1% |

`0` 主要来自 p12 的有效证据不足。其余窗口会根据实际结构提出 1–4 个 Candidate。

## 可见 Pattern 数量

| 可见 Pattern 数 | 窗口数 | 占比 |
|---:|---:|---:|
| 0 | 24 | 17.8% |
| 1 | 47 | 34.8% |
| 2 | 45 | 33.3% |
| 3 | 17 | 12.6% |
| 4 | 2 | 1.5% |

19 个窗口显示 3–4 个 Pattern，占全部抽样窗口的 14.1%。更多 Candidate 在 Emergence 或 Confidence 未达到发布要求时继续留在学习层。

## 多 Pattern 示例

- p02，窗口结束于 2020-02-11：3 个可见 Pattern，Emergence 为 82、68、56；另有1个Boundary和3个Unassigned Sleep Days。
- p04，窗口结束于 2019-12-18：4 个可见 Pattern，Emergence 为 72、69、64、59；另有3个Boundary和1个Unassigned Sleep Day。
- p06，窗口结束于 2020-03-06：4 个可见 Pattern，Emergence 为 78、70、68、64；另有4个Boundary Sleep Days。

## Pattern之外的Sleep Days

- 121个窗口至少有1个Boundary Sleep Day。
- 102个窗口至少有1个Unassigned Sleep Day。
- 滚动窗口累计包含4,656个有效Sleep Day观察：3,961个Core，占85.1%；453个Boundary，占9.7%；242个Unassigned，占5.2%。
- 由于滚动窗口相互重叠，这些数字属于窗口观察次数，同一个真实夜晚可能在多个窗口中重复出现。
- Core Sleep Days完整参与Pattern形态、图表和Context证据。
- Boundary只降权参与Emergence。
- Unassigned不参与任何Pattern的Emergence、图表、定义和Context证据。

## 结论

PMData 回放支持同一人在六周内出现 1–4 个可见 Pattern。多数窗口显示 1–2 个 Pattern，少数窗口有足够清楚且稳定的证据显示 3–4 个。Core、Boundary和Unassigned归属层减少了异常夜晚对Pattern代表范围的拉宽，同时保留新形态在后续窗口形成Candidate的空间。当前模型保留分离度和重采样稳定性要求，不会为了增加前端数量而降低发布标准。
