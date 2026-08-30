# PMData 上下文关联初步验证

生成时间：2026-08-26T11:08:40.815Z

## 口径

- 以参与者为单位，使用最多 42 个日历日的滚动窗口，每 14 天抽取一次快照，并补充每人的最后一个有效睡眠日。
- Pattern 状态只由 Emergence 决定。发布底线使用有效支持量、Emergence 和 Confidence。
- Core Sleep Days 定义 Pattern 形态并进入 Context 对照；Boundary Sleep Days 只降权参与 Emergence；Unassigned variation 留在所有 Pattern 之外。
- Context association 在 Pattern 形成后计算，比较同一窗口中 Pattern 内外的上下文暴露比例。
- PMData 缺少真实日程。当前把周六、周日标记为推定休息日，并在同类日期内复核运动、饮食和主观状态关联。
- 日历时序、运动、饮食和主观状态不进入 Emergence。

## 初步结果

- 共抽取 135 个滚动窗口，得到 196 个可见 Pattern 快照。
- 其中 24 个窗口没有可见 Pattern，47 个有 1 个，45 个有 2 个，17 个有 3 个，2 个有 4 个。
- 183 个快照至少出现一条达到初步发布口径的关联。
- 关联覆盖 15 名参与者。
- 联合生理信号洞察 13 条；日历关联观察 160 条，运动关联观察 122 条，饮食关联观察 51 条，主观状态关联观察 27 条。
- 重叠窗口累计 4656 个有效Sleep Day观察，其中 3961 个为Core、453 个为Boundary、242 个为Unassigned。121 个窗口含有Boundary，102 个窗口含有Unassigned variation。

## 较强的探索性信号

| 参与者 | 窗口结束 | Pattern | 关联 | 支持 | 强度 | Confidence |
|---|---|---|---|---:|---:|---:|
| p06 | 2020-02-07 | Earlier sleep | Has appeared more often before an inferred work day | 25 | 98 | 93 |
| p02 | 2020-02-11 | Earlier sleep | Has appeared more often before an inferred work day | 23 | 98 | 93 |
| p06 | 2020-02-07 | Later, longer sleep | Has appeared more often before an inferred rest day | 11 | 99 | 92 |
| p06 | 2020-02-21 | Later-middle, shorter sleep | Has appeared more often before an inferred work day | 20 | 96 | 95 |
| p15 | 2020-02-15 | Earlier sleep | Has appeared more often before an inferred work day | 19 | 95 | 95 |
| p02 | 2020-02-25 | Earlier sleep | Has appeared more often before an inferred work day | 25 | 99 | 91 |
| p04 | 2019-12-18 | Middle-timed, shorter sleep | Has appeared more often before an inferred work day | 19 | 95 | 94 |
| p06 | 2020-03-06 | Later-middle, shorter sleep | Has appeared more often before an inferred work day | 16 | 94 | 93 |
| p02 | 2020-02-25 | Later, longer sleep | Has appeared more often before an inferred rest day | 9 | 99 | 88 |
| p11 | 2019-12-27 | Earlier sleep | Has appeared more often before an inferred work day | 16 | 93 | 93 |
| p15 | 2020-02-29 | Earlier sleep | Has appeared more often before an inferred work day | 16 | 93 | 93 |
| p03 | 2020-02-20 | Earlier sleep | Has appeared more often before an inferred work day | 16 | 95 | 91 |

## 边界

- Exploratory association screening; no causal interpretation.
- PMData has no schedule. Saturday and Sunday are treated as inferred rest days and labelled as an inference.
- Lifestyle associations are adjusted within comparable inferred-rest-day strata; sparse strata can suppress a signal that cannot be separated from calendar timing.
- Food reports identify meal occurrence, hydration and alcohol, without meal time, nutrients or food identity.
- Repeated overlapping windows and multiple context checks require later false-discovery and stability controls.
- Exercise absence in Fitbit exercise logs is treated as no recorded exercise; wear and detection gaps can reduce Confidence.
- PMData has no body-position/IMU or environmental-noise stream. Cross-signal insights omit those clauses instead of inferring them from sleep stages.
- p12 的有效分期睡眠不足，保持证据不足状态。p15 保留睡眠 Pattern 与运动关联，关闭饮食关联。
