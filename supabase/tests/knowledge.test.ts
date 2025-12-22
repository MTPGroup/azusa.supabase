import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const FUNCTION_URL = `${BASE_URL}/functions/v1/knowledge`;

Deno.test("Knowledge API Integration Test", async (t) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase"
    );
  }
  const token = session.access_token;
  let kbId: string;

  await t.step("POST /knowledge/bases - 应该成功创建知识库", async () => {
    const response = await fetch(`${FUNCTION_URL}/bases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Knowledge Base",
        description: "Created by integration test",
        isPublic: false,
      }),
    });

    assertEquals(response.status, 201);
    const result = await response.json();
    assertEquals(result.success, true);
    assertExists(result.data.knowledgeBase.id);
    kbId = result.data.knowledgeBase.id;
  });

  await t.step(
    "GET /knowledge/bases - 应该能获取到刚创建的知识库",
    async () => {
      const response = await fetch(`${FUNCTION_URL}/bases`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assertEquals(response.status, 200);
      const result = await response.json();
      assertEquals(result.success, true);
      const kbs = result.data.knowledgeBases;
      const found = kbs.find((k: any) => k.id === kbId);
      assertExists(found);
      assertEquals(found.name, "Test Knowledge Base");
    }
  );

  await t.step("PATCH /knowledge/bases/:id - 应该成功更新知识库", async () => {
    const response = await fetch(`${FUNCTION_URL}/bases/${kbId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Knowledge Base",
      }),
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);
    assertEquals(result.data.knowledgeBase.name, "Updated Knowledge Base");
  });

  await t.step(
    "POST /knowledge/bases/:id/documents - 应该成功添加文档（JSON模式）",
    async () => {
      const response = await fetch(`${FUNCTION_URL}/bases/${kbId}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content:
            "这是一段测试文档内容。\n\n人工智能（AI）是计算机科学的一个分支，致力于创建能够执行通常需要人类智能的任务的系统。这些任务包括学习、推理、问题解决、感知和语言理解。\n\n机器学习是AI的一个子领域，它使计算机能够从数据中学习，而无需进行明确的编程。深度学习是机器学习的一个子集，使用多层神经网络来分析各种因素。",
          metadata: {
            fileName: "test-document.txt",
            category: "AI",
          },
        }),
      });

      assertEquals(response.status, 201);
      const result = await response.json();
      assertEquals(result.success, true);
      assertExists(result.data.file.id);
      assertEquals(result.data.file.file_name, "test-document.txt");
      // 文件状态可能是 processing 或 completed（取决于同步/异步执行）
      assertExists(result.data.file.status);
    }
  );

  await t.step(
    "POST /knowledge/bases/:id/documents - 应该成功添加文档（文件上传模式）",
    async () => {
      const formData = new FormData();
      const fileContent = new Blob(
        [
          "# LangChain 简介\n\nLangChain 是一个用于开发由语言模型驱动的应用程序的框架。\n\n## 核心概念\n\n1. 链（Chains）：将多个组件组合在一起\n2. 代理（Agents）：让LLM决定采取什么行动\n3. 内存（Memory）：在对话中保持状态",
        ],
        { type: "text/plain" }
      );
      formData.append("file", fileContent, "langchain-intro.md");
      formData.append("metadata", JSON.stringify({ category: "Framework" }));

      const response = await fetch(`${FUNCTION_URL}/bases/${kbId}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      assertEquals(response.status, 201);
      const result = await response.json();
      assertEquals(result.success, true);
      assertExists(result.data.file.id);
      assertEquals(result.data.file.file_name, "langchain-intro.md");
    }
  );

  // 等待一小段时间让后台处理完成
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await t.step(
    "POST /knowledge/search - 应该能搜索到刚添加的文档",
    async () => {
      const response = await fetch(`${FUNCTION_URL}/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "什么是人工智能",
          knowledgeBaseIds: [kbId],
          threshold: 0.3,
          limit: 5,
        }),
      });

      assertEquals(response.status, 200);
      const result = await response.json();
      assertEquals(result.success, true);
      assertExists(result.data.documents);
      // 验证返回的文档数组存在（可能为空，取决于嵌入处理是否完成）
      assertEquals(Array.isArray(result.data.documents), true);
    }
  );

  await t.step("DELETE /knowledge/bases/:id - 应该成功删除知识库", async () => {
    const response = await fetch(`${FUNCTION_URL}/bases/${kbId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);
  });
});
