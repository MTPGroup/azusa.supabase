import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

// 确保在运行测试前，Supabase 本地服务已启动
const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:8000";
const FUNCTION_URL = `${BASE_URL}/functions/v1/profiles`;

Deno.test("Profiles API 集成测试", async (t) => {
  // 获取认证 Token (shared.ts 已经执行了登录)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase",
    );
  }
  const token = session.access_token;

  await t.step("GET /profiles - 应该成功获取当前用户资料", async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // 如果返回 404，可能是函数未部署或未启动
    if (response.status === 404) {
      throw new Error(
        `Function not found at ${FUNCTION_URL}. Make sure 'supabase start' is running.`,
      );
    }

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data);
    assertExists(result.data.id);
    assertExists(result.data.username);
  });

  await t.step("PUT /profiles - 应该成功更新用户名", async () => {
    const newUsername = `TestUser_${Date.now()}`;

    const response = await fetch(FUNCTION_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: newUsername,
      }),
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertEquals(result.data.username, newUsername);
  });

  await t.step("POST /profiles/avatar - 应该成功上传头像并返回 URL", async () => {
    const form = new FormData();
    const file = new File(
      [new TextEncoder().encode("avatar-bytes")],
      `avatar-${Date.now()}.png`,
      { type: "image/png" },
    );
    form.append("file", file);

    const response = await fetch(`${FUNCTION_URL}/avatar`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const bodyText = await response.text();
    if (response.status !== 200) {
      throw new Error(`avatar upload failed status=${response.status}, body=${bodyText}`);
    }
    const result = JSON.parse(bodyText);

    assertEquals(result.success, true);
    assertExists(result.data);
    assertExists(result.data.avatarUrl);
    assertEquals(result.data.profile.avatar, result.data.avatarUrl);
  });

  await t.step("PUT /profiles - 应该验证输入数据 (空用户名)", async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "", // 空用户名应该失败
      }),
    });

    assertEquals(response.status, 400);
    const result = await response.json();

    assertEquals(result.success, false);
    assertEquals(result.error.code, "VALIDATION_ERROR");
  });
});
