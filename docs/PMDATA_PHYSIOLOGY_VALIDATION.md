# PMData 生理信号与早期睡眠结构验证

## 提取结果

- 有效分期 Sleep Days：1,844。
- 有可靠睡眠期心率的 Sleep Days：1,841。
- 能匹配 Fitbit 静息心率的 Sleep Days：1,532。
- 能估计入睡后心率稳定时间的 Sleep Days：1,840。
- 能计算前 90 分钟睡眠结构的 Sleep Days：1,844。

每个有效 Sleep Day 当前包含：

- `sleepMedianBpm`：主睡眠区间内心率中位数。
- `sleepLowBpm`：主睡眠区间内心率第 10 百分位。
- `restingBpm`：Fitbit 当日静息心率。
- `heartRateSettlingMinutes`：入睡后心率进入并保持在个人当晚稳定区间所需的分钟数。
- `first90StageTransitions`：入睡后前 90 分钟的睡眠分期转换次数。
- `first90BriefWakeEvents`：入睡后前 90 分钟的短暂清醒事件数。
- `first90DisruptionEvents`：前 90 分钟的短暂清醒与分期转换综合事件数。

## 心率稳定时间

估计只使用入睡后前 90 分钟，并要求该区间至少覆盖 60% 的分钟。算法先计算当晚前 90 分钟心率的低四分位区间，再寻找最早一个 20 分钟窗口；该窗口中至少 80% 的有效分钟需要落在稳定区间上方 3 bpm 以内。找不到稳定窗口的夜晚按 90 分钟右删失处理，避免把缺少后续观测解释成已经稳定。

## Pattern 识别口径

- 所有生理特征在参与者当前滚动窗口内单独标准化。
- 单项指标需要覆盖窗口内至少 50% 的有效 Sleep Days，并且至少有 6 晚，才进入 Pattern 距离。
- 标准化尺度使用稳健分位数并限制极端偏差，避免少量异常值主导聚类。
- 入睡时间、醒来时间和睡眠时长保持主要权重。心率和前 90 分钟结构提供补充分离信号。
- 生理信号会影响 Compactness、Separation 和 Temporal stability，不增加独立生命周期状态。
- 缺少某项生理信号的夜晚仍可依据其余睡眠形态参与 Pattern。

## 跨信号洞察

回放会在同一 Pattern 内联合检查心率稳定时间和前 90 分钟睡眠扰动，并与同类日历条件下的其他 Sleep Days 比较。洞察需要达到最小支持数、组间差异和 Confidence 要求。

加入Core、Boundary和Unassigned归属后，135个抽样窗口共有13个联合信号窗口快照达到发布要求，覆盖 p01、p04、p06、p07、p08 和 p10。同一参与者的相邻窗口可能重复包含同一类持续洞察，因此这里的13个结果不代表13条互不重复的长期规律。完整定位信息见 [PMData 联合信号洞察定位清单](CROSS_SIGNAL_INSIGHT_INDEX.md)。示例：

> On 4 of 7 inferred work nights in this Pattern, your heart rate settled later and the first 90 minutes contained more brief wake or sleep-stage transition events. This Pattern appeared more often before inferred rest days.

证据同时显示支持夜数、对照夜数、心率稳定延迟、早期扰动差异和 Confidence。日历条件使用正向高频表述，例如 `appeared more often before an inferred work day`。

## 数据边界

PMData 没有体位或翻身传感器流，也没有环境噪声时间序列。页面不会把睡眠分期变化写成翻身，也不会生成噪声关联。对应语句只会在未来数据源提供真实的体位和环境信号后出现。

## 结论

心率和前 90 分钟睡眠结构已经进入 Pattern 识别与独立洞察层。它们能够形成用户自己难以直接观察的跨信号关系，同时保持 Pattern Emergence、结论 Confidence 和 Context association 三类结果的边界。
