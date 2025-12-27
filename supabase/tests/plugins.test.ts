import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:8000";
const FUNCTION_URL = `${BASE_URL}/functions/v1/plugins`;

Deno.test("Plugins API 集成测试", async (t) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase",
    );
  }
  const token = session.access_token;

  let createdPluginId: string | null = null;

  await t.step("GET /plugins - 应该成功获取插件列表", async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
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
    assertExists(result.data.plugins);
  });

  await t.step("POST /plugins - 应该成功创建插件", async () => {
    const pluginName = `Test Plugin ${Date.now()}`;
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: pluginName,
        description: "Integration test plugin",
        version: "1.0.0",
        schema: { type: "object", properties: {} },
        code: "export default {};",
      }),
    });

    assertEquals(response.status, 201);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data.plugin);
    assertEquals(result.data.plugin.name, pluginName);
    createdPluginId = result.data.plugin.id;
  });

  await t.step("GET /plugins/:id - 应该成功获取插件详情", async () => {
    if (!createdPluginId) throw new Error("插件未创建");

    const response = await fetch(`${FUNCTION_URL}/${createdPluginId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data.plugin);
    assertEquals(result.data.plugin.id, createdPluginId);
  });

  await t.step("POST /plugins/:id/subscribe - 应该成功订阅插件", async () => {
    if (!createdPluginId) throw new Error("插件未创建");

    const response = await fetch(
      `${FUNCTION_URL}/${createdPluginId}/subscribe`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
  });

  await t.step("DELETE /plugins/:id/subscribe - 应该成功取消订阅", async () => {
    if (!createdPluginId) throw new Error("插件未创建");

    const response = await fetch(
      `${FUNCTION_URL}/${createdPluginId}/subscribe`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
  });
});
