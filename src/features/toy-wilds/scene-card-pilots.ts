import type { GameSceneCard, GameSceneReview } from "./inventory-types.ts";

// Only these two stable scenes received the dated pilot review. No heuristic
// grades, member-grade inheritance, or first-load image generation occurs here.
// Source evidence and exact live dependency versions are archived separately in
// docs/reviews/scene-card-pilot-2026-09-09; catalog matches are metadata checks,
// never claims that external adapters or historical evaluations were rerun.
interface Pilot {
  sceneId: string;
  sceneName: string;
  sceneDescription: string;
  memberVersions: { id: string; recordedContentHash: string | null; sourceRevision: string | null }[];
  review: GameSceneReview;
}
const PILOTS: Pilot[] = [
  {
    "sceneId": "scene-36c2451fa91aad0e",
    "sceneName": "商业项目推演",
    "sceneDescription": "",
    "memberVersions": [
      {
        "id": "3dd686bd-b3b3-4830-9613-9d28e009b241",
        "recordedContentHash": "5c3c14e749c5e2c20f95d9a7a5e87a9363e5de4ef1ba733988879d437394768f",
        "sourceRevision": null
      },
      {
        "id": "3ee50be1-c6ff-4b3c-831b-b3db21070bd9",
        "recordedContentHash": "2393efae02af5f7f82d837f75f76560d0f759f28586fc6226d498c04f162fd35",
        "sourceRevision": null
      },
      {
        "id": "da2a78c0-ad2f-4d03-a25e-1e318cb14cb3",
        "recordedContentHash": "db2d8c4283dd383c9851c5399b52b05a0777218f31923fc2f7e1fe318af8cb6f",
        "sourceRevision": null
      },
      {
        "id": "ed2efaec-f1c1-4549-a047-a764736dd4e1",
        "recordedContentHash": "d4b0ad0e125eaee10bd0412f5c36fb7b17a283b5bf7f39c22d8c4afcc75747b2",
        "sourceRevision": null
      }
    ],
    "review": {
      "reviewId": "scene-business-review-20260909-v1",
      "reviewedAt": "2026-09-09",
      "currentGrade": "R",
      "ssrStatus": "not_established",
      "visualGrade": "R",
      "gradeLabel": "灵品 · 方法已审",
      "freshness": "matched",
      "title": "试路罗盘",
      "value": "把商业想法变成可检查的假设，先试最危险的一步。",
      "useWhen": "判断一个项目值不值得继续，或决定先验证什么时。",
      "ability": "检视需求、机会和赚钱逻辑，找出高风险假设，设计低成本验证路径。",
      "boundary": "推演不替代真实客户与市场验证；一个家族入口尚未接通。",
      "basis": "可读取的三份方法有明确输入、分支、产物和回退条件，支持灵品。尚无整个场景串联后的实跑记录，不能直接升为天品。",
      "scope": "需求取证、机会拆解、风险筛除与验证设计；没有声称项目已盈利、市场需求已证实或所有工具已跑通。",
      "evidenceSummary": "依据 2026-09-09 的正文审查和构造情境桌面核对。构造情境没有调用 Skill，不是商业结果；四个成员中一个家族入口读取失败。",
      "nextStep": "先接通缺失入口，再用一个真实项目试完整条推演链，留下判断、验证动作和实际观察。",
      "breakthrough": null,
      "art": {
        "url": "/scene-card-pilots/business-spirit.png",
        "alt": "试路罗盘：象牙与珊瑚色机械罗盘展开放置于秋日营地，多条路径通向小桥、阻断和观察点。"
      }
    }
  },
  {
    "sceneId": "scene-5dceda2d4cfc9a10",
    "sceneName": "知识库与笔记治理",
    "sceneDescription": "",
    "memberVersions": [
      {
        "id": "07e1973e-eea3-4682-b696-75b0928be2db",
        "recordedContentHash": "eadb91a00200c6e4d3382d51da00ed3b8806909edace527e9b01771e40f5e75b",
        "sourceRevision": null
      },
      {
        "id": "280c9e1e-c15d-48ca-b90b-6283be3749b7",
        "recordedContentHash": "f265afed82f61ce5ebbb2072b1eab0a3b0ad9c971418b301f2424afe95e34f4c",
        "sourceRevision": null
      },
      {
        "id": "2c1c1cca-f07b-49e4-8332-407e46e1a00b",
        "recordedContentHash": "5903d846c10f941804c9103552d7d137f067df4a8714d63b36236374fb018dc3",
        "sourceRevision": null
      },
      {
        "id": "3170f092-6ad3-4565-82f1-d1c6a47629ef",
        "recordedContentHash": "832bb4ffdf15af9585d7977550db5b4077e7a7930311ba6c6dd353faaefc2811",
        "sourceRevision": null
      },
      {
        "id": "49822923-e519-4e70-8262-bf9dbcd196b6",
        "recordedContentHash": "167403c8d0339ffdb53235ebf46bc8bbe6990a6c4fa37dd0b10230389b8ecaa4",
        "sourceRevision": null
      },
      {
        "id": "4e8fe63b-52cc-4978-ae23-7e1580c9a01c",
        "recordedContentHash": "3a76d8d205b8ea14831b42263a160d34661cefd58eb013c7412bb38a857f824f",
        "sourceRevision": null
      },
      {
        "id": "4fa54d97-11e5-4d15-a778-0a1e5bb42513",
        "recordedContentHash": "83421dd8e20a4a5052146b341add99a96ba6697b8b7ac15353a357902d988c5a",
        "sourceRevision": null
      },
      {
        "id": "6a916c61-fa1e-4f77-81bf-31e3c6c702f8",
        "recordedContentHash": "0b05e4ef42a7342979b6f60207240fcb99787f67e1780a72554170d913f6b9d2",
        "sourceRevision": null
      },
      {
        "id": "6aec1885-4491-4148-9927-e0813927a61d",
        "recordedContentHash": "5174a18462e0b77698a0b37e3e2e940af3179c1b4f85fb1584f75f198a608af5",
        "sourceRevision": null
      },
      {
        "id": "6d03abb5-c7cc-4d20-b503-87c3c048002e",
        "recordedContentHash": "680553a2116265aaea05149824b392e955c9f7083e79e593d98ec0770acd4ab6",
        "sourceRevision": null
      },
      {
        "id": "6fc55a5f-11e5-4d06-b0c9-5851cc082070",
        "recordedContentHash": "981567a09da87337d65bf89bce5a0423bedc9d3a6c333c015db365e1c6987214",
        "sourceRevision": null
      },
      {
        "id": "7973c503-2dc7-4301-bd0d-aa2381aacd90",
        "recordedContentHash": "9a34c1da3a85cc66819ccb77f1fc2b52d430de49a7221bcf3aa2a72f4e10958e",
        "sourceRevision": null
      },
      {
        "id": "8e331dc7-3066-4aa8-a8ba-411f1aa951ea",
        "recordedContentHash": "49704e5ce3c28880cb863f05c76a19da85ea3d3e7302c05a8c6f08ac059456bd",
        "sourceRevision": null
      },
      {
        "id": "9912eea2-b43b-45f5-b256-dbebbbd81f6c",
        "recordedContentHash": "1fedb215e11d2c012059183c1c0768dba1383b5ad4bb4d6ea92e4a597da80c20",
        "sourceRevision": null
      },
      {
        "id": "adcd6795-6446-467d-9853-a5eef4757a64",
        "recordedContentHash": "1467d0e09fb7ff21cef8573140e2393adf80415f99f55c0a69b4ea0711880bf1",
        "sourceRevision": null
      },
      {
        "id": "c4e979f9-17f3-4df8-950d-0603104524a4",
        "recordedContentHash": "c9469e49def3c2490e98214a05394fcc60d5dc92bf5c3b7a8ba93088ce83161e",
        "sourceRevision": null
      },
      {
        "id": "d45653c3-61b4-47e3-b252-31dcf17fc1d5",
        "recordedContentHash": "4c5d603590d9cae23351ddfdc371329f855487409cc586edf0397988589f7dca",
        "sourceRevision": null
      },
      {
        "id": "d6987a29-69ff-4e40-aecd-e326fb7e9a7f",
        "recordedContentHash": "3aaf571312899f2bf2e6ea1c2332f771c34df8ac2941740710f13d9179ac8ffd",
        "sourceRevision": null
      },
      {
        "id": "d8b2607e-f04f-4eaf-9a0e-3ebd4f3735f3",
        "recordedContentHash": "2e83b291746abc4c1a53a1d43efc9c813908cf76c5debb40b33b55aae69a7596",
        "sourceRevision": null
      },
      {
        "id": "e1b11df0-7b25-4a4a-93ba-b891090daee3",
        "recordedContentHash": "a3bbbda467ebf6596fed9481ccf527093bfe196f9a98fc2cae9d5dfabc01a362",
        "sourceRevision": null
      },
      {
        "id": "e85bae36-6130-481f-aa15-2584a70a6e64",
        "recordedContentHash": "b97b86c53d6758e4d91d9309996b3abf1d94b0b0ee7b735174f8652a51053185",
        "sourceRevision": null
      },
      {
        "id": "f9ec4591-efae-4ae0-8636-52558cd3c2f4",
        "recordedContentHash": "8f7ef26eae6ce30b6e67509f259868d0af45a5752345461e073dcbb0f470f452",
        "sourceRevision": null
      }
    ],
    "review": {
      "reviewId": "scene-knowledge-review-20260909-v1",
      "reviewedAt": "2026-09-09",
      "currentGrade": "SR",
      "ssrStatus": "supported",
      "visualGrade": "SSR",
      "gradeLabel": "圣品 · 审核支持",
      "freshness": "matched",
      "title": "溯源灵镜",
      "value": "辨清知识从何而来，让新发现与旧经验相互校准。",
      "useWhen": "收录资料、蒸馏知识，或遇到说法彼此冲突时。",
      "ability": "追溯同源，保留反证；该深查时重开原文，证据足够时及时停下。",
      "boundary": "需接通知识库原文和规则；知识碰撞仍在试验，不会自动变成正式结论。",
      "basis": "当前方法达到天品；“条件判断与硬性边界分开承担”已有前后对照和作用案例，本次审核支持一次圣品突破。",
      "scope": "此场景中收录、审计、蒸馏、查询、全景与关系导航的共同治理方法；不代表其他笔记工具，也不代表持有者的个人能力。",
      "evidenceSummary": "依据 2026-09-09 的材料审查，以及此前四个冻结情境、两次独立复测和 110/110 运行检查记录。本次没有重跑历史评测，后续演进的全部内容也未重新验证。",
      "nextStep": null,
      "breakthrough": {
        "before": "把所有依赖问题都变成必填清单，简单任务也被迫反复审查。",
        "after": "让 AI 判断何时需要追问；来源、版本和发布权限由明确规则守住。",
        "example": "四篇同源报道只算一组证据；独立反证保留；完整的一手材料不再附加无用审查。",
        "boundary": "突破只归属这条知识治理方法。碰撞结果仍需审核；永久奖章尚未入库。"
      },
      "art": {
        "url": "/scene-card-pilots/knowledge-sacred.png",
        "alt": "溯源灵镜：三重象牙开环围绕青色水晶，内在水灵化作溪流连接秋日浮岛与拱门领域。"
      }
    }
  }
];

export function getScenePilotReview(scene: Pick<GameSceneCard, "id" | "name" | "description" | "members">): GameSceneReview | null {
  const pilot = PILOTS.find(record => record.sceneId === scene.id);
  if (!pilot) return null;
  const expected = new Map(pilot.memberVersions.map(member => [member.id, member]));
  const unchanged = scene.name === pilot.sceneName && scene.description === pilot.sceneDescription
    && scene.members.length === expected.size
    && new Set(scene.members.map(member => member.id)).size === expected.size
    && scene.members.every(member => {
      const source = expected.get(member.id);
      return source && source.recordedContentHash === member.recordedContentHash
        && source.sourceRevision === member.sourceRevision;
    });
  // Historical evidence/art persists; changed material must not masquerade as
  // newly reviewed content. No personal or permanent badge is created here.
  const review = structuredClone(pilot.review);
  if (!unchanged) {
    review.freshness = "changed";
    review.gradeLabel = review.visualGrade === "SSR" ? "圣品 · 历史试绘" : "灵品 · 历史试评";
  }
  return review;
}
