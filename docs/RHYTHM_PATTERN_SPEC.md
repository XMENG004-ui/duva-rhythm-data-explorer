# DUVA Rhythm、Pattern、Emergence、Resonance 与更新机制 v1.0

> 文档状态：当前 PMData 原型基线说明  
> 日期：2026-08-31  
> 适用范围：DUVA My health 中的 Rhythm、Pattern detail、Sleep records、Resonance detail、Rhythm history 与 Context insight  
> 实现基线：`DUVA_Rhythm_Data_Explorer` 当前代码、PMData 构建脚本和 2026-08-31 通过的自动化回归  
> 目的：统一产品定义、计算口径、显示规则、边界处理和后续工程实现方式

## 1. 核心结论

DUVA 使用以下对象组织个人睡眠规律：

```text
一个人的连续 Sleep Days
        ↓
最近最多 42 个日历日的滚动证据窗口
        ↓
1–4 个 Candidate shapes
        ↓
Core / Boundary / Unassigned 归属检查
        ↓
Emergence + Confidence 控制 Pattern 发布
        ↓
当前 Rhythm = 当前可见 Patterns + 各 Pattern 的 Context evidence
        ↓
每个新 Sleep Day 使用此前已形成的 Pattern 计算 Resonance
```

四个核心概念分别回答四个问题：

| 概念 | 回答的问题 |
|---|---|
| Rhythm | DUVA 目前怎样理解这个人的整体睡眠组织方式？ |
| Pattern | 哪一种睡眠形态在这个人的记录中反复出现？ |
| Emergence | 这种 Pattern 在近期数据中显现得有多清楚？ |
| Resonance | 具体这一晚与此前已经显现的 Pattern 有多契合？ |

Context 回答“这种 Pattern 更常在什么情况下出现”。Confidence 回答“DUVA 对当前估计有多大把握”。两项都拥有独立结果，Context 不增加 Emergence，也不进入 Resonance。

## 2. 对象定义

### 2.1 Sleep Day

Sleep Day 是算法分析和用户回看的基本时间单位。当前 PMData 原型在每个日期中选择一条完整、带 Fitbit 睡眠分期的主睡眠记录，并保留同日的 additional sleep、心率、运动、饮食和主观状态等可用数据。

主睡眠跨午夜时，时间会转换为连续的扩展时间。例如晚上 11:30 表示为 23.5，次日早上 7:00 表示为 31.0。这样可以直接比较跨午夜的入睡、醒来和持续时间。

### 2.2 Candidate Pattern

Candidate Pattern 是模型提出的潜在睡眠形态。它可以拥有内部 Emergence 分数，但在达到发布安全底线前不会出现在主要界面。

Candidate 的数量由数据结构决定。当前算法允许 1–4 个 Candidate，没有预设“每个人应该有几个 Pattern”。

### 2.3 Pattern

Pattern 是一组反复出现并且彼此相似的 Core Sleep Days。当前版本使用以下信号识别 Pattern：

- 主睡眠开始时间；
- 主睡眠结束时间；
- 主睡眠时长；
- 达到重复门槛后的 additional sleep；
- 睡眠期心率中位数；
- 睡眠期心率第 10 百分位；
- Fitbit 当日静息心率；
- 入睡后心率稳定时间；
- 前 90 分钟的短暂清醒与睡眠分期转换综合事件数。

Pattern 描述用户实际数据中的重复形态。Pattern 不表达理想作息、健康评级或行动目标。

### 2.4 Rhythm

Rhythm 是 DUVA 对一个人当前睡眠组织方式的整体理解。当前 Rhythm 快照包含：

- 当前滚动窗口内已经发布的 0–4 个 Pattern；
- 仍在隐藏学习的 Candidate 数量；
- 每个 Pattern 的 Emergence、Confidence、代表范围和 Core evidence；
- Boundary 与 Unassigned variation；
- Pattern 形成后单独学习的日历、运动、饮食、主观状态和跨信号关联。

一个人可以只有一个可见 Pattern。只要增加第二种形态无法通过分离度、结构增益和重采样稳定性检查，Rhythm 就保持一个 Pattern。系统不会为了让页面更丰富而拆出弱 Pattern。

### 2.5 Emergence

Emergence 是 0–100 的连续分数，表达一个 Candidate 在近期个人数据中显现得多清楚。它评价的是 Pattern 本身，不能用于评价单个夜晚。

Emergence 决定 Pattern 的用户可见状态：

| Emergence | 状态 | 前端处理 |
|---:|---|---|
| `<55` | Candidate | 留在隐藏学习层 |
| `55–69` | Taking shape | 可以显示并参与 Resonance，结论保持克制 |
| `≥70` | Clearly emerged | 作为清楚显现的 Rhythm Pattern |

Sleep Day 数量只作为证据进入 Effective support。前端不会根据天数再创建一套生命周期状态。

### 2.6 Confidence

Confidence 是 0–100 的独立分数，表达 DUVA 对当前 Pattern 估计的把握。当前 PMData 原型综合观察窗口长度、有效记录覆盖、Pattern 紧密度和重采样聚类稳定性。

相同 Emergence 可以对应不同 Confidence。例如两组睡眠形态看起来同样清楚，佩戴缺失更多的一组会获得较低 Confidence。

### 2.7 Resonance

Resonance 是单个 Sleep Day 与此前已发布 Pattern 的契合分数。它回答“这一晚与我已经形成的睡眠形态有多接近”。

Resonance 使用当前 Sleep Day 之前的数据建立参照。当前夜晚不会参与建立自己的 Pattern，未来数据也不会进入本次比较。

### 2.8 Context association

Context association 描述某项条件与 Pattern 共同出现的统计关系，例如：

- 更常出现在推测的工作日前夜；
- 更常出现在推测的休息日前夜；
- 更常出现在较晚运动后；
- 更常与记录的酒精、晚餐、较低饮水或较高压力共同出现。

Context association 具有自己的支持数、强度和 Confidence。它表达共同出现关系，不表达因果关系。

### 2.9 History snapshot

History snapshot 是某个过去证据窗口在当时独立计算出的 Rhythm 结果。历史 Pattern 保留该窗口内真实得到的名称、Emergence、Confidence、状态和 Core evidence。

## 3. 当前数据边界

### 3.1 直接参与 Pattern 识别的数据

| 信号 | 当前使用方式 | 相对作用 |
|---|---|---|
| 入睡时间 | 在个人窗口内比较 | 主要信号 |
| 醒来时间 | 在个人窗口内比较 | 主要信号 |
| 主睡眠时长 | 在个人窗口内比较 | 主要信号 |
| Additional sleep | 通过重复门槛后形成二元特征 | 条件性主要结构信号 |
| 睡眠期心率中位数 | 个人内稳健标准化 | 低权重补充信号 |
| 睡眠期低位心率 | 个人内稳健标准化 | 低权重补充信号 |
| 心率稳定时间 | 个人内稳健标准化 | 低权重补充信号 |
| 静息心率 | 个人内稳健标准化 | 低权重补充信号 |
| 前 90 分钟扰动 | 个人内稳健标准化 | 低权重补充信号 |
| 睡眠效率 | 转换为每晚证据质量 | 影响 Effective support |

四分期整夜轨迹和 Deep／Light／REM 比例会进入 Pattern 描述与 Resonance。当前 Pattern 聚类没有把整晚分期占比作为独立聚类维度。

### 3.2 只进入 Context 的数据

- 星期位置推测的工作日和休息日；
- Fitbit 运动记录；
- 饮食、饮水和酒精报告；
- 疲劳、情绪、压力、酸痛、睡眠质量和准备度等主观记录；
- 固定间隔的周期候选。

这些数据不会改变 Pattern Emergence。

### 3.3 PMData 当前缺少的数据

- 真实工作、休息、轮班、旅行和日程记录；
- 身体姿势与翻身时间序列；
- 环境噪声时间序列；
- HRV；
- 可覆盖全部参与者的营养素、热量和食物身份。

系统不会使用睡眠分期转换推测翻身，也不会生成环境噪声结论。PMData 中的工作日和休息日只能依据星期位置推测。

## 4. Pattern 识别流程

### 4.1 建立滚动证据窗口

每次计算使用同一个人截至所选日期最近最多 42 个日历日。42 天是窗口上限，不是首次显示 Pattern 的等待时间。

新用户数据少于 42 天时，系统使用已经存在的全部日历日。稳定记录会随着观察周数增长逐步提高 Recurrence、Temporal stability 和 Confidence。达到发布条件后即可显示 Pattern。

日期滑块每移动一次，当前窗口和全部结果都会重新计算。

### 4.2 筛选有效 Sleep Days

当前 PMData 原型只保留：

- `mainSleep = true`；
- Fitbit 记录类型为 `stages`；
- 存在可用分期时间序列；
- 同一日期有多条主睡眠时，选择睡眠分钟数最长的一条。

没有有效主睡眠的日期仍保留在 42 日窗口中，标记为无效日期。它会影响有效覆盖和 Confidence，不会直接进入聚类。

每个有效夜晚的证据质量来自 Fitbit 睡眠效率，并限制在 0.35–1.00 范围内。

### 4.3 提取和标准化个人内特征

入睡、醒来和时长使用固定的睡眠尺度转换为可比较距离。生理信号和前 90 分钟扰动先在当前个人窗口内寻找中位水平与稳健波动范围，再转换成相对个人近期水平的偏差。

每项生理或早期结构信号需要同时满足：

- 覆盖至少 50% 的有效 Sleep Days；
- 至少有 6 晚可用数据。

未达到覆盖要求的信号退出本窗口的聚类。极端个人内偏差会被截断，避免少量异常点主导 Candidate 划分。

当前聚类中的相对缩放如下：

| 特征 | 当前相对缩放或权重 |
|---|---:|
| 入睡时间 | 约 1.35 小时为一个标准距离单位 |
| 醒来时间 | 约 1.70 小时为一个标准距离单位 |
| 睡眠时长 | 约 1.20 小时为一个标准距离单位 |
| Additional sleep | 通过门槛后增加 0.80 的结构差异 |
| 睡眠期心率中位数 | 0.45 |
| 睡眠期低位心率 | 0.30 |
| 心率稳定时间 | 0.35 |
| 静息心率 | 0.35 |
| 前 90 分钟扰动 | 0.28 |

这些数值属于 PMData 第一版校准参数，需要在 DUVA 自有数据上重新验证。

### 4.4 Additional sleep 启用规则

Additional sleep 先通过窗口级门槛，随后通过 Pattern 定义门槛。

窗口级门槛决定它能否参与 Candidate 划分：

- 当前窗口至少出现 3 次；
- 覆盖至少 10% 的有效 Sleep Days；
- 跨至少 2 个观察周。

Pattern 定义门槛决定页面能否写成“这个 Pattern 包含重复的 additional sleep”：

- Pattern Core 中至少出现 3 次；
- 覆盖 Pattern Core 至少 20%；
- 跨至少 2 个观察周。

单晚 additional sleep 会保留为 observed variation。它不会进入 Pattern 名称、定义或 Emergence 的结构维度。

### 4.5 提出 1–4 个 Candidate shapes

当前原型使用多次初始化的 K-means。算法从 1 个 Candidate 开始，依次尝试增加到 2、3、4 个。

每次增加形态需要同时通过：

- 每个分组至少有 4 个有效 Sleep Days；
- 组内与组间结构达到对应的 silhouette 门槛；
- 新分组带来足够的误差下降；
- 抽取约 80% 夜晚重算时，归属关系保持稳定。

当前接受门槛为：

| Candidate 数量 | Silhouette | 新增结构改善 | 重采样稳定性 |
|---:|---:|---:|---:|
| 2 | ≥0.28 | ≥18% | ≥0.72 |
| 3 | ≥0.30 | ≥15% | ≥0.75 |
| 4 | ≥0.32 | ≥12% | ≥0.78 |

算法会选择通过检查的最大 Candidate 数量。额外 Candidate 仍需单独通过 Emergence 与 Confidence 发布安全底线。

### 4.6 进行稳健归属检查

初始聚类后，每个有效 Sleep Day 会被重新分类：

| 归属 | 处理 |
|---|---|
| Core | 完整定义 Pattern 形态、概率带、Emergence 与 Context evidence |
| Boundary | 以 0.35–0.65 的权重进入 Effective support，不定义图表、范围或 Context |
| Unassigned variation | 留在全部 Pattern 之外，不进入 Emergence、图表、定义或 Context |

Core 需要同时满足两项条件：它与最近 Candidate 的距离处于该组稳健范围内，并且最近 Candidate 明显优于第二候选。Boundary 允许更大的距离或更小的领先差距。其余夜晚进入 Unassigned variation。

这一步防止旅行、生病、设备异常和偶发作息把 Pattern 范围拉宽。多个 Unassigned 夜晚未来形成重复结构时，后续窗口可以将它们提出为新 Candidate。

### 4.7 生成代表范围、分期概率带和名称

页面中的常见入睡、醒来和时长范围使用 Core Sleep Days 的第 20–80 百分位。外侧观察不会控制代表范围。

Pattern 的 `Primary sleep · time and depth` 图遵循以下口径：

- 横轴表示 6 PM 到次日 6 PM 的连续时间；
- 顶部 Awake 轴上的彩色区段表示完整的入睡时间范围和醒来时间范围；
- 每个时间位置的纵向概率带使用 Core nights 的睡眠深度分布；
- 外缘表示约第 15–85 百分位；
- 局部样本密度越高，带内颜色越深；
- 曲线经过平滑处理，底层分位含义保持不变；
- 图中不显示单独的 50% 中线，也不显示紫色概率带的上下边缘描边。

名称按照当前窗口中各 Candidate 的典型入睡顺序和相对时长生成，例如：

- Earlier sleep；
- Middle-timed, shorter sleep；
- Middle-timed, longer sleep；
- Later sleep；
- Later, longer sleep。

名称服务于当前窗口的可读性。当前原型还没有跨窗口的持久 Pattern identity，因此相同名称不能单独证明两个历史快照属于同一个长期 identity。

## 5. Emergence 计算

### 5.1 六个维度

| 维度 | 权重 | 当前计算含义 |
|---|---:|---|
| Effective support | 20% | Core 的完整权重、Boundary 的降权、睡眠质量共同形成有效证据量，再使用饱和映射 |
| Recurrence | 20% | 该形态覆盖了多少观察周，同时根据已经观察的周数增加证据成熟度 |
| Compactness | 20% | Core nights 到代表中心的中位距离和第 80 百分位距离 |
| Separation | 20% | 当前 Pattern 中心与最近其他 Candidate 的距离，相对自身离散程度进行判断 |
| Temporal stability | 10% | 按时间排序后，前半段与后半段代表中心是否接近，并结合观察周数 |
| Recent continuity | 10% | 最近 14 天的归属量，相对于前段时间预计出现量是否继续保持 |

六项使用短板敏感的加权几何合并。Support 很高时，低 Compactness、低 Separation 或低 Recurrence 仍会明显限制总分。

### 5.2 Effective support 的证据口径

每晚先获得 `睡眠质量 × Pattern 归属权重`：

- Core 归属权重为 1；
- Boundary 归属权重为 0.35–0.65；
- Unassigned 权重为 0。

系统同时考虑加权总量和权重是否集中在少数夜晚，取得更保守的有效样本量。随后使用饱和映射，让 3 晚增加到 8 晚的贡献明显高于 20 晚增加到 21 晚。

### 5.3 单一 Candidate 的 Separation

一个窗口只有一个 Candidate 时，没有第二个真实中心可供比较。当前原型使用保守的参考间隔，并继续结合该组自身的离散程度计算 Separation。

单一 Pattern 仍需要 Compactness、Recurrence、Temporal stability 和 Recent continuity 共同支持。系统不会为了计算 Separation 而生成虚假的第二个 Pattern。

### 5.4 发布安全底线

Pattern 进入主界面需要同时满足：

- 至少 4 个 Core Sleep Days；
- 有效支持量 `N_eff ≥ 4`；
- `Emergence ≥ 55`；
- `Confidence ≥ 55`。

Candidate 数量、Core 数量和状态是三件不同的事。模型可以提出 3 个 Candidate，最终只发布 1 或 2 个可见 Pattern。

### 5.5 新用户怎样逐步形成 Pattern

新用户无需等待完整六周。算法使用当前已有的日历窗口，并通过以下方式逐步增加分数：

- 新的相似夜晚增加 Effective support；
- 相似形态跨越更多周后提高 Recurrence；
- 前后记录持续接近时提高 Temporal stability；
- 最近仍然出现时提高 Recent continuity；
- 数据覆盖和聚类稳定后提高 Confidence。

最早发布仍需 4 个 Core nights 和其他安全底线。具体达到 55 的时间由形态清晰度决定，不由固定使用天数决定。

## 6. Confidence 计算

当前 PMData 原型的 Pattern Confidence 由四部分形成：

| 部分 | 作用 |
|---|---|
| 观察时间成熟度 | 从较短窗口逐步接近六周，增加估计把握 |
| 有效日期覆盖 | 无有效主睡眠的日期越多，Confidence 越低 |
| Compactness | Pattern 内部越集中，估计越可靠 |
| Candidate 重采样稳定性 | 抽取数据重算后分组越一致，Confidence 越高 |

睡眠效率已经通过 Effective support 影响 Emergence。当前真实数据原型没有把每项传感器覆盖单独拆成 Confidence 子分数。

### 6.1 缺失数据边界

产品规则要求区分“近期 Pattern 没有出现”和“近期没有足够佩戴数据”：

- 有效近期数据充分且 Pattern 没有出现时，Recent continuity 可以下降；
- 近期覆盖不足时，主要降低 Confidence，并给 Recent continuity 使用中性处理；
- 低 Confidence 不能单独宣布 Pattern 消失。

当前 PMData 原型已经通过有效日期覆盖降低 Confidence。它还没有为 Recent continuity 接入缺失原因的中性替代，近期无有效记录时仍可能同时拉低 Recent continuity。这是生产实现前需要补齐的边界。

## 7. Resonance 计算

### 7.1 参照建立

计算某个 Sleep Day 的 Resonance 时：

1. 检查该晚是否具有完整主睡眠和分期轨迹；
2. 将参考窗口结束日期停在该晚之前一天；
3. 使用此前最多 42 个日历日重新形成当时可见 Pattern；
4. 将当前夜晚依次与每个可见 Pattern 比较；
5. 选择最高分，并检查与第二名的差距。

这套 hold-out 规则防止当前夜晚参与建立自己的标准。

### 7.2 六个匹配维度

| 维度 | 基础权重 | 当前比较方法 |
|---|---:|---|
| Timing | 28% | 分别比较入睡和醒来相对 Pattern Core 中位数与稳健范围的距离 |
| Duration | 12% | 比较主睡眠时长与 Pattern Core 的代表时长 |
| Sleep-depth landscape | 25% | 将整夜轨迹重采样为 36 个相对位置，比较分期深度水平和变化方向 |
| Stage composition | 12% | 比较 Deep、Light、REM 三项整体比例 |
| Physiology | 16% | 比较睡眠期中位心率、低位心率、静息心率和心率稳定时间 |
| First 90 minutes | 7% | 比较短暂清醒与分期转换综合事件数 |

Landscape 的比较中，深度水平差异占 78%，相邻位置的变化差异占 22%。它因此同时考虑“睡到了什么深度”和“整夜结构怎样变化”。

### 7.3 缺失信号

某项信号缺失时，该维度退出本次计算，剩余权重按比例重分配。缺少心率不会自动把睡眠结构匹配分数压低。

页面单独显示 `Signals available`，让用户知道本次分数基于多少信号。

### 7.4 可靠性收缩

基础匹配分数会结合：

- 本次可用信号覆盖；
- Pattern Confidence；
- Pattern Core nights 数量，达到 12 晚后不再继续增加该项可靠性。

可靠性较低时，极端分数向 50 轻度收缩。这样可以保留可用结构信息，同时控制弱参照产生过强结论。

Resonance 页面中的 Confidence 进一步综合 Pattern Confidence、匹配可靠性和当前夜晚的数据质量。

### 7.5 结果状态

| 条件 | 显示 |
|---|---|
| 最高分 82–100 | `Close match` |
| 最高分 70–81 | `Familiar shape` |
| 最高分 58–69 | `Some shared terrain` |
| 最高分 `<58` | `This night was different` |
| 前两名都 ≥58，分差 `<6` | `Between two patterns` |
| 此前没有可见 Pattern | `We need more nights of sleep data to form your first Pattern.` |
| 当前夜晚无完整主睡眠或分期 | 不生成 Resonance，说明需要完整记录 |

`This night was different` 仍显示最接近的 Pattern 作为解释参照。该夜晚不会被写成已归入这个 Pattern。

### 7.6 Resonance Sleep Landscape

- 横轴上方的薄荷色轮廓代表当前主睡眠；
- 横轴下方的暗薄荷色轮廓是当前主睡眠的镜像；
- 紫色概率带代表参照 Pattern；
- 倒影线进入 Pattern 概率带的线段显示为金色；
- 金色只改变倒影线，不填充整块重叠区域；
- 紫色带不显示上下边缘线。

金色线段用于说明哪些时间位置和深度与 Pattern 重合。最终 Resonance 仍由六个维度共同决定。

## 8. Context 分析

### 8.1 分析顺序

Context 在 Pattern 形成后计算：

```text
先用睡眠形态形成 Pattern
        ↓
取该 Pattern 的 Core Sleep Days
        ↓
与同窗口内其他有效 Sleep Days 比较 Context 暴露比例
        ↓
生成独立的 strength、confidence、support 和 evidence summary
```

Boundary 与 Unassigned nights 不进入 Pattern 侧 Context evidence。

### 8.2 日历 Context

PMData 没有真实日程。当前规则为：

- 周六、周日标记为推测的休息日；
- 周一至周五标记为推测的工作日；
- 页面始终使用 `inferred` 说明推测性质。

系统比较 Pattern nights 与其他 nights 中该条件的比例。若原始结果显示 Pattern 在休息日前较少出现，页面会转换成等价的正向表达：`Has appeared more often before an inferred work day.`，支持数和对照数同时转换。

页面优先说明 Pattern 更常出现的条件，避免使用绕行的“在另一种情况下较少出现”。

### 8.3 运动 Context

运动与入睡的匹配窗口为主睡眠开始前 18 小时：

- `later exercise`：结束于入睡前 6 小时内的运动累计至少 15 分钟；
- `higher exercise load`：入睡前 18 小时内运动累计至少 60 分钟。

运动日志缺失可能代表未记录、未检测或没有运动，因此 Confidence 需要保留这一数据边界。

### 8.4 饮食和主观状态 Context

主睡眠在午夜后开始时，饮食记录锚定到前一个日历日；其余情况锚定到入睡日期。当前检查：

- 是否记录晚餐或 evening meal；
- 是否记录酒精；
- 记录饮水是否少于 5 杯；
- 自报压力是否达到较高等级。

PMData 的饮食数据没有稳定的餐食时间、营养素和食物身份。p15 没有饮食报告，因此保留睡眠 Pattern 与运动分析，关闭饮食关联。

### 8.5 控制星期结构的混杂

运动、饮食和主观状态可能在周末更常出现。当前算法会在“推测休息日”和“推测工作日”两个层内分别比较 Pattern 与其他 nights，再合并可比较层的证据。

某个 Context 只出现在周末，但 Pattern 也只出现在周末时，分层后可能没有足够对照。系统会抑制这条无法与日历时序区分的关联。

### 8.6 Context association 发布条件

当前原型只发布“在该条件下更常出现”的关联，并要求：

- Pattern 方向支持至少 2 晚；
- 至少 3 个对照 Sleep Days；
- 关联方向为更常出现；
- strength 至少 0.15；
- association Confidence 至少 0.25。

Strength 来自 Pattern 与对照组的暴露比例差异，并使用小样本连续性修正。Confidence 综合 Pattern Context 覆盖、方向支持、对照量和 strength。

这些门槛用于探索性原型。正式发布需要增加跨窗口稳定性、多重比较控制和更严格的最低支持。

### 8.7 联合生理信号洞察

当前原型会在 Pattern Core nights 中联合检查：

- 心率是否更晚进入稳定区间；
- 前 90 分钟是否有更多短暂清醒或分期转换。

优先在推测工作日前夜内与其他推测工作日前夜比较，减少日历结构混杂。没有足够工作夜证据时，再使用全部可比 Sleep Days。

当前发布要求包括：

- 至少 10 个同时具有两项信号的可观察 Sleep Days；
- Pattern 侧至少 5 晚、对照侧至少 3 晚；
- 至少 3 晚同时达到“心率稳定较晚”和“早期扰动较多”；
- Pattern 侧联合信号比例达到 50%，全体 Sleep Day 分析时可放宽到 45%；
- Pattern 与对照的比例差至少 15 个百分点；
- Pattern 的心率稳定中位差至少 5 分钟；
- 前 90 分钟扰动中位差至少 1 次；
- 联合信号 Confidence 至少 0.28。

PMData 没有身体姿势和环境噪声数据，因此当前洞察只写心率和 Fitbit 分期扰动。未来真实设备提供位置和噪声流后，只有达到各自覆盖、差异和支持门槛时，页面才加入相应语句。

### 8.8 固定间隔和周期性规律

固定间隔属于 Pattern 形成后的时间 Context，不进入聚类距离，也不提高 Emergence。

当前 PMData 探索执行了两类检查：

- 睡眠特征检查 2–21 天周期；
- Pattern 复现检查 2–10 天周期，并使用互不重叠窗口复核。

分析会先移除星期几效应和缓慢长期趋势，再比较多个候选周期，并控制重复筛选产生的偶然命中。产品发布要求：

- 至少观察到 4 次完整循环；
- 在两个独立观察区间中复现；
- 通过多重比较控制；
- 能与星期、推测工作日和休息日效应区分。

PMData 中目前没有任何 Pattern 复现周期通过全部发布条件。p10 的夜间低位心率存在约 20 天的稳定候选，它属于睡眠特征周期线索，不能写成已确认的 Pattern 出现周期。

## 9. 更新机制

### 9.1 当前 PMData 原型已经实现的更新

当前原型采用确定性窗口重算：

1. 新 Sleep Day 到达或日期滑块变化；
2. 重新取最近最多 42 个日历日；
3. 重新判断可用特征；
4. 重新选择 1–4 个 Candidate；
5. 重新执行 Core／Boundary／Unassigned 分类；
6. 重新计算 Emergence、Confidence、代表范围和 Context；
7. 页面显示该快照中达到发布安全底线的 Pattern。

这套方式适合真实数据回放和窗口行为验证。它没有数据库层的长期 identity、版本、事件或人工修订记录。

### 9.2 当前夜晚的生效顺序

产品和算法共同遵循以下时序：

```text
此前已形成的 Rhythm snapshot
        ↓
计算当前 Sleep Day 的 Resonance
        ↓
当前 Sleep Day 加入学习窗口
        ↓
Candidate、Emergence、Confidence 和 Context 刷新
        ↓
新发布结果从下一次 Sleep Day 开始成为 Resonance 参照
```

这个顺序防止自我参照，也避免新 Pattern 在产生它的同一晚获得虚高 Resonance。

### 9.3 生产版本需要持久化的对象

正式工程实现应持久化：

| 对象 | 作用 |
|---|---|
| `rhythm_snapshot` | 保存某个生效区间内可用于 Resonance 的完整 Rhythm |
| `pattern_identity` | 保存跨窗口持续的长期身份 |
| `pattern_version` | 保存某个时间段内的具体形态、Emergence、Confidence 和证据窗口 |
| `pattern_period` | 保存一个 Pattern 从显现到休眠或归档的用户可理解时期 |
| `sleep_day_resonance` | 固定引用当时使用的 Rhythm snapshot、Pattern version 和算法版本 |
| `context_association_version` | 保存关联方向、证据、Confidence 和计算版本 |

### 9.4 Identity 与 version 的更新原则

相邻窗口中的新 Candidate 需要与当前 active Pattern 做连续性匹配，比较：

- Episode 角色和数量；
- 入睡、醒来和时长中心；
- Additional sleep 结构；
- 生理和前 90 分钟补充形态；
- 重叠 Sleep Days 的连续归属；
- 代表范围的移动幅度。

结构连续时保留 `pattern_id`。代表形态发生有意义变化时发布新的 `pattern_version`。新增 Candidate、合并和拆分需要保存父子关系，避免 History 被静默改写。

### 9.5 已通过 Mock 验证、尚未接入当前 PMData 原型的初始参数

| 更新事件 | 初始验证参数 |
|---|---|
| 保持同一 identity | identity continuity ≥0.52 |
| 发布新 version | Core signature 累计移动达到约 25 分钟 |
| Dormant | 有效近期数据下，Emergence 连续 2 次低于 55 |
| Archived | 连续 4 次低于门槛，同时 Emergence `<35` 且 Recent continuity `<0.20` |
| 缺失数据 | 保持 identity，降低 Confidence，不单独触发 Dormant 或 Archived |

这些参数已经通过确定性 Mock 场景验证，仍属于可调初值。当前 PMData 前端没有持久化 Dormant、Archived、merge、split 或 version timeline。

Dormant、Archived、merge 和 split 属于后台身份与历史管理状态。当前 Pattern 卡片继续只使用 Candidate、Taking shape 和 Clearly emerged 三个 Emergence 状态，避免在前端增加平行的日常状态体系。

### 9.6 用户可见更新

日常小幅变化保持安静，例如代表范围轻微移动、支持数增加和 Emergence 小幅变化。以下变化适合进入 `Rhythm updates`：

- 新 Pattern 达到 Taking shape；
- 原有 Pattern 从 Taking shape 进入 Clearly emerged；
- DUVA 可以稳定区分两个此前混合的 Pattern；
- 一个 Pattern 的代表形态发生明显演化；
- Pattern 进入 Dormant、恢复活跃、合并、拆分或归档；
- 新 Context association 达到稳定发布条件。

更新内容需要说明发生了什么、依据哪些 Sleep Days、何时生效以及 Confidence 边界。

## 10. History 处理

### 10.1 当前原型的 History 规则

History 以当前日期滑块选择的窗口结束日为参照，向前读取最多 3 个互不重叠的 42 日窗口：

```text
当前窗口：        D-41  … D
历史窗口 1：      D-83  … D-42
历史窗口 2：     D-125  … D-84
历史窗口 3：     D-167  … D-126
```

每个历史窗口都重新运行同一套 Candidate、归属、Emergence、Confidence 和发布计算。History 只显示该快照当时真正达到发布条件的 Pattern。

历史卡片保留：

- 当时生成的 Pattern 名称；
- 当时的 Emergence；
- 当时的 Confidence；
- 当时的 Taking shape 或 Clearly emerged 状态；
- 当时的 Core、Boundary 和代表范围。

History 不会把所有历史 Pattern 强制显示为 Clearly emerged，也不会使用固定参与者日期锚点。日期滑块变化后，History 的参照窗口和内容同步变化。

### 10.2 当前 History 的限制

当前原型把每个历史窗口视为独立快照。它还没有完成：

- 跨快照的稳定 `pattern_id` 匹配；
- 同一 Pattern period 的代表 version 选择；
- 合并、拆分、Dormant 和 Archived 的事件时间线；
- 用户自定义名称的跨版本延续；
- 历史 Resonance 记录的数据库持久化。
- 历史窗口 Context association 的持久化和展示。

因此，两个历史窗口中都出现 `Earlier sleep` 时，页面说明它们拥有相似的描述性形态。正式产品还需使用 identity continuity 判断它们是否属于同一长期 Pattern。

### 10.3 正式产品的历史追溯规则

正式产品应同时保留两种视角：

- 当时视角：旧 Sleep Day 固定引用当时的 Rhythm snapshot、Pattern version、Resonance 分数和解释；
- 当前视角：最新模型可以补充当前归属，例如“DUVA 现在把这晚识别为 Later, longer sleep”。

最新模型不能覆盖旧分数。算法升级、Pattern 拆分或重新归属后，用户仍能知道 DUVA 当时依据什么作出解释。

## 11. 边界情况处理

| 情况 | 当前处理 | 产品含义 |
|---|---|---|
| 新用户少于 42 天 | 使用已有窗口；通过 4 Core、N_eff、Emergence 和 Confidence 后即可发布 | 无需等待六周 |
| 少于 4 个有效 Core nights | Candidate 隐藏 | 数据不足以形成可见 Pattern |
| Emergence 达标但 Confidence `<55` | 隐藏 | 形态看起来清楚，估计把握仍不足 |
| Confidence 高但 Emergence `<55` | 隐藏 | 数据质量良好，重复形态仍不清楚 |
| 只有一个 Candidate | 保留一个 Pattern，并使用保守 Separation 参考 | 一种稳定形态可以构成有效 Rhythm |
| 出现 3–4 个 Candidate | 每个 Candidate 单独接受发布检查 | 更多形态只在数据支持时显示 |
| 所有夜晚都被初始 K-means 分组 | 归属检查将弱匹配夜晚转为 Boundary 或 Unassigned | 有效夜晚无需全部属于 Pattern |
| 旅行或生病集中出现几晚 | 低 Recurrence 或低近期稳定性限制 Emergence | 短期事件通常保持 Candidate 或 variation |
| 单晚 additional sleep | 作为 variation，不能定义 Pattern | 避免偶发事件进入核心描述 |
| 缺少某项生理数据 | 该项退出聚类或 Resonance，其他信号继续使用 | 缺失不等同于不匹配 |
| 最近没有佩戴 | Confidence 下降；生产版需要中性 Recent continuity | 不能据此判断 Pattern 消失 |
| 当前夜晚与所有 Pattern 都弱匹配 | `This night was different`，显示最近 Pattern 作为比较 | 该晚保持 Pattern 外观察 |
| 当前夜晚同时接近两个 Pattern | 两者都 ≥58 且分差 `<6` 时显示 `Between two patterns` | 避免强行选择 |
| 当前夜晚前没有可见 Pattern | 显示学习状态，不给 Resonance 数字 | 防止伪精确 |
| 当前夜晚缺少完整主睡眠或分期 | Resonance unavailable | 明确数据条件 |
| 推测工作日与真实日程冲突 | 保留 `inferred` 标签 | PMData 不能识别轮班、假期和个人休息安排 |
| p12 | 保持 Pattern 证据不足 | 只有极少有效分期夜晚 |
| p15 | 保留 Pattern 和运动 Context，关闭饮食 Context | 饮食报告不可用 |
| 周期候选只在局部窗口出现 | 不发布 | 需要独立区间复现与多重比较控制 |

## 12. 当前实现状态

| 能力 | 当前 PMData 原型 | 正式产品仍需补齐 |
|---|---|---|
| 最多 42 日滚动窗口 | 已实现 | 服务端增量计算与快照持久化 |
| 1–4 Candidate 自动选择 | 已实现 | 更广泛人群校准；评估混合分布模型 |
| Core／Boundary／Unassigned | 已实现 | 长期归属稳定性和人工修订机制 |
| 六维 Emergence | 已实现 | DUVA 数据分布校准；缺失原因感知 |
| 独立 Confidence | 已实现基础版 | 传感器级覆盖拆分与概率校准 |
| 55／70 状态 | 已实现 | 状态边界回放和防抖 |
| 心率与前 90 分钟进入 Pattern | 已实现 | HRV、体位、环境信号接入 |
| Resonance 六维匹配 | 已实现 | 算法版本持久化与长期校准 |
| Context association | 已实现探索版 | 多重比较、跨窗口稳定发布和真实日程 |
| 固定间隔周期探索 | 已完成离线验证 | 产品级持续检测与发布事件 |
| 随日期变化的 History | 已实现 | Pattern identity、period、version timeline |
| Dormant／Archived | Mock 已验证 | 接入 PMData／正式服务和用户可见事件 |
| Merge／split | 产品规则已定义 | identity 图谱、迁移和回溯实现 |

## 13. 当前验证结果

### 13.1 自动化回归

2026-08-31 在当前 PMData 原型上重新运行 12 项算法测试，结果为 12/12 通过。覆盖内容包括：

- Pattern 状态只由 Emergence 阈值决定；
- 单次 additional sleep 保持 variation；
- Core／Boundary／Unassigned 完整覆盖有效 Sleep Days；
- 心率和前 90 分钟结构进入 Pattern 识别；
- 多 Pattern 窗口能够出现；
- 日历关联使用“更常出现”的正向表达；
- 联合心率与早期扰动洞察能够发布；
- History 跟随所选窗口结束日期；
- 当前 Sleep Day 不进入自己的 Resonance 参照；
- Resonance 能处理缺失生理数据；
- mixed、different 和 learning 状态能够区分。

### 13.2 PMData 滚动窗口回放

135 个抽样窗口的可见 Pattern 数量为：

| 可见 Pattern 数 | 窗口数 | 占比 |
|---:|---:|---:|
| 0 | 24 | 17.8% |
| 1 | 47 | 34.8% |
| 2 | 45 | 33.3% |
| 3 | 17 | 12.6% |
| 4 | 2 | 1.5% |

多数窗口显示 1–2 个 Pattern，少数窗口显示 3–4 个。该结果支持当前模型保留较严格分离和稳定性门槛。

## 14. 上线前需要继续校准的项目

1. 用 DUVA 自有数据重新校准特征缩放、Candidate 接受门槛、Emergence 映射和 55／70 边界。
2. 在缺失注入测试中验证“未佩戴”和“Pattern 未出现”的区分。
3. 校准 Confidence 与实际错误率，确保 55% 具有可解释的可靠性含义。
4. 验证 Fitbit 分期迁移到 DUVA 分期后的 Landscape 与前 90 分钟扰动口径。
5. 接入 HRV、体位、翻身、噪声和环境数据后，为每项新信号设置独立覆盖门槛和缺失策略。
6. 对 Context association 增加多重比较、跨窗口稳定性和最短持续时间要求。
7. 实现 Pattern identity、version、period、merge、split、Dormant、Archived 和恢复规则。
8. 固定保存历史 Resonance 的算法版本和参照快照。
9. 使用真实日程替换星期推测，并保留来源与用户纠正入口。
10. 评估 K-means 对连续缓慢漂移、非球形分布和多 Episode 结构的限制。

## 15. 产品表达原则

- Rhythm 先展示当前最有价值的个人规律，再提供计算依据。
- Pattern 名称保持描述性，避免使用好、坏、健康、异常等评价词。
- Emergence 是 Pattern 的显现程度，Resonance 是单晚契合度，两个数字不能互换。
- Confidence 控制结论力度和发布安全，不能替代 Emergence。
- Context 使用相关性表达，并显示支持数、对照数、来源和推测边界。
- 弱证据、普通常识和用户一眼可见的事实不占据主要洞察位置。
- 数据缺失时直接说明可用范围，避免生成补全式结论。
- History 保留当时证据和当时解释，后续模型学习以补充方式呈现。

## 16. 对应实现与验证文件

- Pattern 与 Context 计算：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/src/mockData.js`
- Resonance 计算：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/src/resonance.js`
- PMData 特征提取：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/scripts/build_pmdata.py`
- 算法回归测试：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/tests/pattern-context.test.mjs`
- Pattern 数量验证：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/PATTERN_COUNT_VALIDATION.md`
- Context 验证：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/PMDATA_CONTEXT_VALIDATION.md`
- 生理信号验证：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/PMDATA_PHYSIOLOGY_VALIDATION.md`
- 周期性验证：`03_Design/Prototypes/DUVA_Rhythm_Data_Explorer/PMDATA_PERIODICITY_VALIDATION.md`
- Mock 更新验证：`04_Data/Experiments/duva_pattern_validation/2026-08-26_DUVA-Pattern识别与更新算法验证_v0.2.md`
