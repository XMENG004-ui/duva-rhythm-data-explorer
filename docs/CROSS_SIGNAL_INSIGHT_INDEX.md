# PMData 联合信号洞察定位清单

## 怎么在页面中找到

1. 在左侧选择参与者。
2. 把顶部日期滑块移动到表格中的窗口结束日期。
3. 在 Rhythm overview 中找到对应 Pattern 名称。
4. 打开 Pattern detail，查看 `When this Pattern appears`。

表格中的链接会直接选中参与者和窗口结束日期。页面仍需点击对应的 Pattern 卡片进入详情。

## 13个达到发布条件的窗口快照

| # | 参与者 | 观察窗口 | Pattern | Emergence / Confidence | Core / Boundary | 联合信号证据 | 页面 |
|---:|---|---|---|---:|---:|---|---|
| 1 | p01 | 2019-12-14–2020-01-24 | Later, longer sleep | 59 / 81 | 13 / 5 | 6个推测工作日前夜中有3夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p01&end=2020-01-24) |
| 2 | p04 | 2019-12-19–2020-01-29 | Middle-timed, longer sleep | 56 / 81 | 12 / 1 | 7个推测工作日前夜中有4夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p04&end=2020-01-29) |
| 3 | p06 | 2019-11-02–2019-12-13 | Earlier sleep | 61 / 78 | 33 / 4 | 33个Core Sleep Days中有18夜出现联合信号；该Pattern更常出现在推测工作日前。 | [打开](http://localhost:4173/?participant=p06&end=2019-12-13) |
| 4 | p06 | 2020-01-25–2020-03-06 | Later sleep | 64 / 82 | 5 / 1 | 5个Core Sleep Days中有3夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p06&end=2020-03-06) |
| 5 | p07 | 2019-11-07–2019-12-18 | Earlier sleep | 75 / 77 | 29 / 4 | 25个推测工作日前夜中有13夜出现联合信号；该Pattern更常出现在推测工作日前。 | [打开](http://localhost:4173/?participant=p07&end=2019-12-18) |
| 6 | p07 | 2020-02-13–2020-03-25 | Earlier sleep | 64 / 79 | 34 / 3 | 26个推测工作日前夜中有13夜出现联合信号；该Pattern更常出现在推测工作日前。 | [打开](http://localhost:4173/?participant=p07&end=2020-03-25) |
| 7 | p08 | 2019-12-10–2020-01-20 | Earlier sleep | 70 / 78 | 22 / 1 | 17个推测工作日前夜中有10夜出现联合信号；该Pattern更常出现在推测工作日前。 | [打开](http://localhost:4173/?participant=p08&end=2020-01-20) |
| 8 | p10 | 2019-11-22–2020-01-02 | Later sleep | 66 / 77 | 11 / 2 | 11个Core Sleep Days中有6夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p10&end=2020-01-02) |
| 9 | p10 | 2019-12-20–2020-01-30 | Later sleep | 68 / 76 | 10 / 0 | 10个Core Sleep Days中有5夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p10&end=2020-01-30) |
| 10 | p10 | 2020-01-17–2020-02-27 | Later, longer sleep | 62 / 76 | 11 / 2 | 11个Core Sleep Days中有5夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p10&end=2020-02-27) |
| 11 | p10 | 2020-01-17–2020-02-27 | Middle-timed, shorter sleep | 57 / 78 | 5 / 0 | 5个推测工作日前夜中有3夜出现联合信号；该Pattern更常出现在推测工作日前。 | [打开](http://localhost:4173/?participant=p10&end=2020-02-27) |
| 12 | p10 | 2020-01-18–2020-02-28 | Middle-timed, shorter sleep | 66 / 78 | 6 / 2 | 6个推测工作日前夜中有3夜出现联合信号；该Pattern更常出现在推测工作日前。 | [打开](http://localhost:4173/?participant=p10&end=2020-02-28) |
| 13 | p10 | 2020-01-18–2020-02-28 | Later, longer sleep | 62 / 76 | 10 / 2 | 10个Core Sleep Days中有5夜出现联合信号；该Pattern更常出现在推测休息日前。 | [打开](http://localhost:4173/?participant=p10&end=2020-02-28) |

## 计数说明

- 13个结果是抽样回放中的窗口快照，覆盖6名参与者。
- p07的Earlier sleep和p10的两个Pattern在相邻窗口中持续达到条件。
- 同一个窗口可以同时有多个Pattern达到联合信号发布要求，例如p10在2020-02-27和2020-02-28结束的窗口。
- 当前统计逐窗口计数。正式产品可以把相邻窗口中身份、代表范围和证据方向保持接近的结果合并成一条持续洞察事件。
- `Core / Boundary`列中的Core夜晚进入Pattern图表和Context证据；Boundary夜晚只降权参与Emergence。
- PMData没有真实工作日程。工作日与休息日来自星期位置推测，页面和文档均保留 `inferred` 标识。
