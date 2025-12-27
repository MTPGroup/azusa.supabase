import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:8000";
const FUNCTION_URL = `${BASE_URL}/functions/v1/settings`;

Deno.test("Settings API 集成测试", async (t) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase",
    );
  }
  const token = session.access_token;

  await t.step("GET /settings - 应该成功获取用户设置", async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      throw new Error(
        `Function not found at ${FUNCTION_URL}. Make sure 'supabase start' is running.`,
      );
    }

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data);
    assertExists(result.data.ownerId);
  });

  await t.step("PATCH /settings - 应该成功更新主题设置", async () => {
    const newTheme = "dark";
    const response = await fetch(FUNCTION_URL, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        theme: newTheme,
      }),
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertEquals(result.data.theme, newTheme);
  });

  await t.step("PATCH /settings - 应该成功更新聊天模型设置", async () => {
    const newChatModels = { default: "gpt-4" };
    const response = await fetch(FUNCTION_URL, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chatModels: newChatModels,
      }),
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    // 注意：这里比较对象需要深度比较，assertEquals 支持
    assertEquals(result.data.chatModels, newChatModels);
  });

  await t.step("PATCH /settings - 应该验证无效输入", async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        theme: 123, // 无效类型
      }),
    });

    assertEquals(response.status, 400);
    const result = await response.json();
    assertEquals(result.success, false);
    assertEquals(result.error.code, "VALIDATION_ERROR");
  });
});
