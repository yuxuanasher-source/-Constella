import { describe, expect, it } from "vitest";

import {
  aggregateReviewKnowledge,
  buildReviewAssist,
  parseLiveReview,
} from "./live-review-knowledge";

const REVIEW_A = `## 直播复盘模板

### 一、基础信息

| 项目 | 内容 |
|---|---|
| 产品 / 区服 | 王者荣耀 / 国服 |
| 平台 | 抖音 |
| 本场目标 | 冲付费 |

### 三、做对了什么（可复制）

- 内容/话术：开场憋单留人率高
- 节奏/憋单/福利节点：整点发福利
- 投放/选品/时段：

### 四、问题与归因（这一段是复盘的核心）

| 问题现象 | 直接原因 | 根本原因 | 是偶发还是结构性 |
|---|---|---|---|
| 例：付费转化低 | 福利节点太靠后 | 脚本没卡注册-付费衔接 | 结构性 |
| 付费转化低 | 福利节点太靠后 | 脚本没卡注册-付费衔接 | 结构性 |

### 五、行动项（下场必须改的）

| 行动 | 负责人 | 截止时间 | 验证指标 |
|---|---|---|---|
| 脚本前置付费节点 | 小王 | 下场 | 付费转化率 |
`;

const REVIEW_B = `## 直播复盘模板

### 三、做对了什么（可复制）

- 内容/话术：开场憋单留人率高

### 四、问题与归因

| 问题现象 | 直接原因 | 根本原因 | 是偶发还是结构性 |
|---|---|---|---|
| 注册到付费掉档 | 引导话术弱 | 脚本没卡注册-付费衔接 | 结构性 |

### 五、行动项

| 行动 | 负责人 | 截止时间 | 验证指标 |
|---|---|---|---|
| 脚本前置付费节点 | 小李 | 下场 | 付费转化率 |
`;

describe("parseLiveReview", () => {
  it("extracts goal, wins, problems and actions, skipping example and empty rows", () => {
    const parsed = parseLiveReview(REVIEW_A);
    expect(parsed.goal).toBe("冲付费");
    expect(parsed.wins).toEqual(["开场憋单留人率高", "整点发福利"]);
    // The 例：... example row must be ignored.
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].rootCause).toBe("脚本没卡注册-付费衔接");
    expect(parsed.problems[0].nature).toBe("结构性");
    expect(parsed.problems[0].dimension).toBe("承接");
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0].action).toBe("脚本前置付费节点");
    expect(parsed.actions[0].metric).toBe("付费转化率");
  });
});

describe("aggregateReviewKnowledge", () => {
  it("counts recurring root causes, repeatable wins and common actions across reviews", () => {
    const knowledge = aggregateReviewKnowledge([
      { contentMd: REVIEW_A },
      { contentMd: REVIEW_B },
    ]);

    expect(knowledge.sampleSize).toBe(2);

    const topProblem = knowledge.recurringProblems[0];
    expect(topProblem.rootCause).toBe("脚本没卡注册-付费衔接");
    expect(topProblem.count).toBe(2);
    expect(topProblem.structuralCount).toBe(2);
    expect(topProblem.dimension).toBe("承接");

    const topWin = knowledge.repeatableWins[0];
    expect(topWin.text).toBe("开场憋单留人率高");
    expect(topWin.count).toBe(2);

    const topAction = knowledge.commonActions[0];
    expect(topAction.action).toBe("脚本前置付费节点");
    expect(topAction.count).toBe(2);

    expect(knowledge.dimensionStats.map((s) => s.dimension)).toContain("承接");
  });

  it("returns an empty knowledge set when there are no documents", () => {
    const knowledge = aggregateReviewKnowledge([]);
    expect(knowledge.sampleSize).toBe(0);
    expect(knowledge.recurringProblems).toEqual([]);
  });
});

describe("buildReviewAssist", () => {
  it("turns knowledge into watch-outs, reusable wins and a markdown assist block", () => {
    const knowledge = aggregateReviewKnowledge([
      { contentMd: REVIEW_A },
      { contentMd: REVIEW_B },
    ]);
    const assist = buildReviewAssist(knowledge, {
      product: "王者荣耀",
      platform: "抖音",
      goal: "冲付费",
    });

    expect(assist.sampleSize).toBe(2);
    expect(assist.watchOuts.join("\n")).toContain("脚本没卡注册-付费衔接");
    expect(assist.reusableWins.join("\n")).toContain("开场憋单留人率高");
    expect(assist.assistMarkdown).toContain("AI 复盘助手");
    expect(assist.assistMarkdown).toContain("基于组织知识库 2 份历史复盘");
    expect(assist.suggestions.some((s) => s.includes("冲付费"))).toBe(true);
  });

  it("degrades gracefully with no history", () => {
    const assist = buildReviewAssist(aggregateReviewKnowledge([]));
    expect(assist.sampleSize).toBe(0);
    expect(assist.assistMarkdown).toContain("知识库暂无历史复盘");
  });
});
