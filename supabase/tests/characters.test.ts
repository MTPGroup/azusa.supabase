import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:8000";
const CHARACTERS_URL = `${BASE_URL}/functions/v1/characters`;

type Character = { id: string };

denoTest("Characters API 集成测试", async (t) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase",
    );
  }
  const token = session.access_token;
  if (!token) throw new Error("未获取到有效的 access_token");

  let createdId: string | null = null;

  await t.step("POST /characters - 创建角色", async () => {
    const response = await fetch(CHARACTERS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Test Character ${Date.now()}`,
        bio: "Integration test character",
        avatar: "https://example.com/avatar.png",
        isPublic: true,
      }),
    });

    if (response.status === 404) {
      throw new Error(
        `Function not found at ${CHARACTERS_URL}. Make sure 'supabase start' is running.`,
      );
    }

    assertEquals(response.status, 201);
    const result = await response.json();
    assertEquals(result.success, true);
    assertExists(result.data?.id);
    createdId = result.data.id;
  });

  await t.step("GET /characters - 列表应包含新角色", async () => {
    const response = await fetch(CHARACTERS_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);
    assertExists(result.data?.characters);
    const found = result.data.characters.find(
      (c: Character) => c.id === createdId,
    );
    assertExists(found);
  });

  await t.step("GET /characters/:id - 获取角色详情", async () => {
    if (!createdId) throw new Error("character 未创建");

    const response = await fetch(`${CHARACTERS_URL}/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);
    assertEquals(result.data?.id, createdId);
  });

  await t.step("PUT /characters/:id - 更新角色信息", async () => {
    if (!createdId) throw new Error("character 未创建");

    const newName = "Updated Character Name";
    const newBio = "Updated bio";
    const newAvatar = "https://example.com/new-avatar.png";

    const response = await fetch(`${CHARACTERS_URL}/${createdId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: newName,
        bio: newBio,
        avatar: newAvatar,
        isPublic: false,
      }),
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);
    assertEquals(result.data?.name, newName);
    assertEquals(result.data?.bio, newBio);
    assertEquals(result.data?.avatar, newAvatar);
    assertEquals(result.data?.isPublic, false);
  });

  await t.step("DELETE /characters/:id - 删除角色", async () => {
    if (!createdId) throw new Error("character 未创建");

    const response = await fetch(`${CHARACTERS_URL}/${createdId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);
  });

  await t.step("GET /characters/:id - 删除后应返回 404", async () => {
    if (!createdId) throw new Error("character 未创建");

    const response = await fetch(`${CHARACTERS_URL}/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 404);
  });
});

function denoTest(name: string, fn: (t: Deno.TestContext) => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}
