import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const CONTACTS_URL = `${BASE_URL}/functions/v1/contacts`;
const CHARACTERS_URL = `${BASE_URL}/functions/v1/characters`;

Deno.test("Contacts API 集成测试", async (t) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase"
    );
  }
  const token = session.access_token;
  if (!token) throw new Error("未获取到有效的 access_token");

  // 创建一个角色用于后续联系人操作
  const createCharResp = await fetch(CHARACTERS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Test Character ${Date.now()}`,
      bio: "Integration test character",
      isPublic: true,
    }),
  });
  assertEquals(createCharResp.status, 201);
  const createCharResult = await createCharResp.json();
  const characterId =
    createCharResult.data.id ||
    createCharResult.data?.char?.id ||
    createCharResult.data?.character?.id ||
    createCharResult.data?.id;
  if (!characterId) throw new Error("未能获取创建的角色 ID");

  const nickname = `Nick_${Date.now()}`;
  try {
    await t.step("GET /contacts - 应返回当前用户联系人列表", async () => {
      const response = await fetch(CONTACTS_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 404) {
        throw new Error(
          `Function not found at ${CONTACTS_URL}. Make sure 'supabase start' is running.`
        );
      }

      assertEquals(response.status, 200);
      const result = await response.json();
      assertEquals(result.success, true);
      assertExists(result.data.contacts);
    });

    await t.step("POST /contacts/:characterId - 应成功添加联系人", async () => {
      const response = await fetch(`${CONTACTS_URL}/${characterId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assertEquals(response.status, 201);
      const result = await response.json();
      assertEquals(result.success, true);
      assertEquals(result.data.contactId, characterId);
    });

    await t.step(
      "PUT /contacts/:characterId - 应成功更新联系人昵称",
      async () => {
        const response = await fetch(`${CONTACTS_URL}/${characterId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nickname }),
        });

        assertEquals(response.status, 200);
        const result = await response.json();
        assertEquals(result.success, true);
      }
    );

    await t.step("GET /contacts - 应包含更新后的昵称", async () => {
      const response = await fetch(CONTACTS_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assertEquals(response.status, 200);
      const result = await response.json();
      assertEquals(result.success, true);
      const found = result.data.contacts.find((c: any) => c.id === characterId);
      assertExists(found);
      assertEquals(found.nickname, nickname);
    });

    await t.step(
      "DELETE /contacts/:characterId - 应成功删除联系人",
      async () => {
        const response = await fetch(`${CONTACTS_URL}/${characterId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        assertEquals(response.status, 200);
        const result = await response.json();
        assertEquals(result.success, true);
      }
    );

    await t.step("GET /contacts - 删除后不应包含该联系人", async () => {
      const response = await fetch(CONTACTS_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assertEquals(response.status, 200);
      const result = await response.json();
      const found = result.data.contacts.find((c: any) => c.id === characterId);
      assertEquals(found, undefined);
    });
  } finally {
    // 测试结束后删除创建的角色，避免残留数据
    const cleanupResp = await fetch(`${CHARACTERS_URL}/${characterId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (cleanupResp.status !== 200 && cleanupResp.status !== 404) {
      console.warn("清理测试角色失败", cleanupResp.status);
    }

    // 确保响应流被消费，避免资源泄漏
    await cleanupResp.text();
  }
});
