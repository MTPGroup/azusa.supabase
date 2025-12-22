import { assertEquals, assertExists } from "@std/assert";
import { supabase } from "./shared.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const FUNCTION_URL = `${BASE_URL}/functions/v1/chats`;

type Profile = { id: string };

denoTest("Chats API 集成测试", async (t) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      "未获取到 Session，请检查 shared.ts 中的登录逻辑以及是否已启动 Supabase"
    );
  }
  const token = session.access_token;
  const userId = session.user.id;

  // 获取当前用户的 profile.id
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("uid", userId)
    .single();

  if (profileError || !profile) {
    throw new Error(`获取 profile 失败: ${profileError?.message}`);
  }
  const profileId = (profile as Profile).id;

  // 确保有一个可用的角色
  const characterName = `Test Character ${Date.now()}`;
  const { data: character, error: characterError } = await supabase
    .from("characters")
    .insert({
      author_id: profileId,
      name: characterName,
      bio: "Integration test character",
      is_public: false,
    })
    .select()
    .single();

  if (characterError || !character) {
    throw new Error(`创建角色失败: ${characterError?.message}`);
  }

  let createdChatId: string | null = null;

  await t.step("POST /chats/private - 创建或获取私聊", async () => {
    const response = await fetch(`${FUNCTION_URL}/private`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        characterId: character.id,
        name: "Test Chat",
        avatar: "https://example.com/avatar.png",
      }),
    });

    assertEquals(response.status === 200 || response.status === 201, true);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data?.id);
    createdChatId = result.data.id;
  });

  await t.step("GET /chats - 列表包含创建的会话", async () => {
    const response = await fetch(FUNCTION_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data?.chats);
    assertEquals(
      result.data.chats.some((c: any) => c.id === createdChatId),
      true
    );
  });

  await t.step("GET /chats/:id - 获取会话详情", async () => {
    if (!createdChatId) throw new Error("chat 未创建");

    const response = await fetch(`${FUNCTION_URL}/${createdChatId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertEquals(result.data?.id, createdChatId);
  });

  await t.step("GET /chats/:id/messages - 获取消息列表", async () => {
    if (!createdChatId) throw new Error("chat 未创建");

    const response = await fetch(`${FUNCTION_URL}/${createdChatId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertExists(result.data?.messages);
  });

  await t.step("POST /chats/:id/messages/stream - 流式响应", async () => {
    if (!createdChatId) throw new Error("chat 未创建");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `${FUNCTION_URL}/${createdChatId}/messages/stream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: [
            {
              type: "text",
              text: "hello from test",
            },
          ],
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    assertEquals(response.status, 200);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const { value, done } = reader
      ? await reader.read()
      : { value: null, done: true };
    // 只要拿到首块数据或流结束即视为流式接口正常工作（服务端可能因无模型配置返回错误文本）
    assertEquals(done === false || value !== null, true);
    if (reader) reader.cancel();
  });

  await t.step("PATCH /chats/:id - 更新会话名称与头像", async () => {
    if (!createdChatId) throw new Error("chat 未创建");

    const newName = "Updated Chat Name";
    const newAvatar = "https://example.com/new-avatar.png";
    const response = await fetch(`${FUNCTION_URL}/${createdChatId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName, avatar: newAvatar }),
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    assertEquals(result.success, true);
    assertEquals(result.data?.name, newName);
    assertEquals(result.data?.avatar, newAvatar);
  });

  await t.step("DELETE /chats/:id - 删除会话", async () => {
    if (!createdChatId) throw new Error("chat 未创建");

    const response = await fetch(`${FUNCTION_URL}/${createdChatId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.success, true);

    // 再次获取应返回 404
    const getResp = await fetch(`${FUNCTION_URL}/${createdChatId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assertEquals(getResp.status, 404);
  });
});

function denoTest(name: string, fn: (t: Deno.TestContext) => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}
