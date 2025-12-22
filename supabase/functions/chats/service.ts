import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../_shared/database.types.ts";
import { z } from "zod";
import { tool, AIMessage, HumanMessage, createAgent } from "langchain";
import { MessageContent } from "./types.ts";
import { ChatOpenAI } from "@langchain/openai";

function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema) return z.any();
  if (schema.type === "string")
    return z.string().describe(schema.description || "");
  if (schema.type === "number" || schema.type === "integer")
    return z.number().describe(schema.description || "");
  if (schema.type === "boolean")
    return z.boolean().describe(schema.description || "");
  if (schema.type === "array") {
    return z
      .array(jsonSchemaToZod(schema.items))
      .describe(schema.description || "");
  }
  if (schema.type === "object") {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const key in schema.properties) {
      shape[key] = jsonSchemaToZod(schema.properties[key]);
      if (!schema.required?.includes(key)) {
        shape[key] = shape[key].optional();
      }
    }
    return z.object(shape).describe(schema.description || "");
  }
  return z.any();
}

export class ChatService {
  constructor(private supabase: SupabaseClient<Database>) {}

  async runPluginInSandbox(pluginCode: string, args: unknown) {
    // 使用权限为 none 的 Worker 作为沙箱执行插件代码
    const workerCode = `
      self.onmessage = async (event) => {
        const { code, args } = event.data;
        try {
          const fn = new Function('args', code);
          const result = await fn(args);
          self.postMessage({ ok: true, result });
        } catch (err) {
          self.postMessage({ ok: false, error: err?.message || String(err) });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    const worker = new Worker(URL.createObjectURL(blob), {
      type: "module",
      // 禁用权限，防止插件访问外部资源
      deno: {
        permissions: "none",
      },
    } as WorkerOptions & { deno?: { permissions: "none" | "inherit" } });

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Plugin execution timed out"));
      }, 5000);

      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        if (event.data?.ok) {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data?.error || "Plugin execution failed"));
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(err);
      };

      worker.postMessage({ code: pluginCode, args });
    });
  }

  async getUserChats(profileId: string) {
    // 仅获取用户自己加入的会话（member_type = 'user'）
    const { data: memberships, error: membershipError } = await this.supabase
      .from("chat_members")
      .select("chat_id")
      .eq("member_type", "user")
      .eq("profile_id", profileId);

    if (membershipError) throw membershipError;
    if (!memberships || memberships.length === 0) return [];

    const chatIds = memberships.map((m) => m.chat_id);

    const { data: chats, error: chatError } = await this.supabase
      .from("chats")
      .select(
        `
        *,
        owner:profiles!chats_owner_id_fkey(*),
        members:chat_members (
          member_type,
          character:characters(*),
          profile:profiles(*)
        )
      `
      )
      .in("id", chatIds);

    if (chatError) throw chatError;

    return (chats || []).map((chat: any) => {
      const aiMember = chat?.members?.find(
        (m: any) => m.member_type === "character"
      )?.character;

      return {
        id: chat.id,
        name: aiMember ? aiMember.name : chat.name,
        title: chat.name,
        isGroup: chat.is_group,
        avatar: aiMember ? aiMember.avatar : chat.avatar,
        creatorId: chat.owner?.uid,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        characterId: aiMember?.id,
      };
    });
  }

  async createPrivateChat(
    profileId: string,
    userId: string,
    characterId: string,
    name: string,
    avatar?: string
  ) {
    // 查找现有的私聊（is_group=false）且包含该用户与指定角色
    const { data: userChats } = await this.supabase
      .from("chat_members")
      .select("chat_id")
      .eq("member_type", "user")
      .eq("profile_id", profileId);

    if (userChats && userChats.length > 0) {
      const chatIds = userChats.map((uc) => uc.chat_id);
      const { data: existingMember } = await this.supabase
        .from("chat_members")
        .select("chat_id")
        .in("chat_id", chatIds)
        .eq("member_type", "character")
        .eq("character_id", characterId)
        .single();

      if (existingMember) {
        const { data: existingChat } = await this.supabase
          .from("chats")
          .select("*")
          .eq("id", existingMember.chat_id)
          .eq("is_group", false)
          .single();

        if (existingChat) {
          return {
            chat: {
              id: existingChat.id,
              isGroup: existingChat.is_group,
              name: existingChat.name,
              title: existingChat.name,
              avatar: existingChat.avatar,
              createdAt: existingChat.created_at,
              updatedAt: existingChat.updated_at,
              creatorId: userId,
            },
            isNew: false,
          };
        }
      }
    }

    // 创建新私聊
    const { data: chat, error: chatError } = await this.supabase
      .from("chats")
      .insert({
        owner_id: profileId,
        name,
        is_group: false,
        avatar,
      })
      .select()
      .single();

    if (chatError) throw chatError;

    const { error: memberError } = await this.supabase
      .from("chat_members")
      .insert([
        {
          chat_id: chat.id,
          member_type: "user",
          profile_id: profileId,
          role: "owner",
        },
        {
          chat_id: chat.id,
          member_type: "character",
          character_id: characterId,
          role: "member",
        },
      ]);

    if (memberError) throw memberError;

    return {
      chat: {
        id: chat.id,
        isGroup: chat.is_group,
        name: chat.name,
        title: chat.name,
        avatar: chat.avatar,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        creatorId: userId,
      },
      isNew: true,
    };
  }

  async getChatDetails(chatId: string) {
    const { data: chat, error } = await this.supabase
      .from("chats")
      .select("*, owner:profiles!chats_owner_id_fkey(*)")
      .eq("id", chatId)
      .single();

    if (error || !chat) return null;

    return {
      id: chat.id,
      name: chat.name,
      title: chat.name,
      isGroup: chat.is_group,
      avatar: chat.avatar,
      creatorId: chat.owner?.uid,
      createdAt: chat.created_at,
      updatedAt: chat.updated_at,
      owner: chat.owner
        ? {
            id: chat.owner.uid,
            username: chat.owner.username,
            avatar: chat.owner.avatar,
          }
        : null,
    };
  }

  async updateChat(
    chatId: string,
    ownerProfileId: string,
    name?: string,
    avatar?: string
  ) {
    const payload: Record<string, unknown> = {};
    if (name) payload.name = name;
    if (avatar !== undefined) payload.avatar = avatar;

    const { data: chat, error } = await this.supabase
      .from("chats")
      .update(payload)
      .eq("id", chatId)
      .eq("owner_id", ownerProfileId)
      .select("*")
      .single();

    if (error) throw error;
    return chat;
  }

  async deleteChat(chatId: string, ownerProfileId: string) {
    const { error } = await this.supabase
      .from("chats")
      .delete()
      .eq("id", chatId)
      .eq("owner_id", ownerProfileId);

    if (error) throw error;
    return true;
  }

  async getMessages(chatId: string, limit: number = 20, before?: string) {
    let query = this.supabase
      .from("messages")
      .select(
        `
      *,
      sender_profile:profiles(*),
      sender_character:characters(*)
    `
      )
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data: messages, error } = await query;

    if (error) throw error;

    return {
      messages: messages
        .map((msg) => ({
          id: msg.id,
          chatId: msg.chat_id,
          role: msg.sender_type === "user" ? "user" : "character",
          content: msg.content,
          createdAt: msg.created_at,
          sender: msg.sender_profile
            ? {
                name: msg.sender_profile.username,
                avatar: msg.sender_profile.avatar,
              }
            : msg.sender_character
            ? {
                name: msg.sender_character.name,
                avatar: msg.sender_character.avatar,
              }
            : null,
        }))
        .reverse(),
      next:
        messages.length === limit
          ? messages[messages.length - 1]?.created_at
          : null,
    };
  }

  async getSubscribedKnowledgeBaseIds(characterId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("knowledge_subscriptions")
      .select("knowledge_base_id")
      .eq("character_id", characterId);

    if (error) throw error;
    return data?.map((row: any) => row.knowledge_base_id).filter(Boolean) || [];
  }

  async getSubscribedPlugins(userId: string) {
    const { data } = await this.supabase
      .from("plugin_subscriptions")
      .select("plugin:plugins(*)")
      .eq("user_id", userId)
      .eq("is_active", true);

    return data?.map((item: any) => item.plugin).filter((p: any) => !!p) || [];
  }

  private createRAGTool(kbIds: string[]) {
    return tool(
      async ({ query }: { query: string }) => {
        try {
          if (kbIds.length === 0) return "No linked knowledge bases.";
          const { data, error } = await this.supabase
            .from("knowledge_documents")
            .select("content")
            .in("knowledge_base_id", kbIds)
            .ilike("content", `%${query}%`)
            .limit(5);

          if (error) throw error;
          if (!data || data.length === 0)
            return "No relevant information found.";
          return data.map((d: any) => d.content).join("\n\n");
        } catch (e: any) {
          return `Error searching knowledge base: ${e.message}`;
        }
      },
      {
        name: "search_knowledge_base",
        description:
          "Search for information in the knowledge base. Use this when the user asks questions about specific documents or domain knowledge.",
        schema: z.object({
          query: z.string().describe("The search query"),
        }),
      }
    );
  }

  private createPluginTool(plugin: any) {
    return tool(
      async (args: any) => {
        try {
          return await this.runPluginInSandbox(plugin.code, args);
        } catch (e: any) {
          return `Error executing plugin ${plugin.name}: ${e.message}`;
        }
      },
      {
        name: plugin.name,
        description: plugin.description,
        schema: jsonSchemaToZod(plugin.schema) as z.ZodObject<any>,
      }
    );
  }

  async *streamMessage(
    chatId: string,
    profileId: string,
    message: MessageContent[]
  ) {
    // 保存用户消息
    await this.saveUserMessage(chatId, profileId, message);

    // 获取聊天中的AI成员
    const { data: chatMember } = await this.supabase
      .from("chat_members")
      .select("character:characters(*)")
      .eq("chat_id", chatId)
      .eq("member_type", "character")
      .single();

    if (!chatMember || !chatMember.character) {
      yield "No AI in this chat.";
      return;
    }

    const ai = chatMember.character;

    // 准备工具
    const tools = [];

    // RAG Tool
    const kbIds = await this.getSubscribedKnowledgeBaseIds(ai.id);
    if (kbIds.length > 0) {
      tools.push(this.createRAGTool(kbIds));
    }

    // Plugin Tools
    const plugins = await this.getSubscribedPlugins(profileId);
    for (const plugin of plugins) {
      tools.push(this.createPluginTool(plugin));
    }

    // 构建上下文和历史记录
    const { data: history } = await this.supabase
      .from("messages")
      .select("sender_type, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(20);

    const chatHistory: unknown[] = [];
    if (history) {
      chatHistory.push(
        ...history
          .reverse()
          .map((msg) => {
            const content = msg.content as any;
            return msg.sender_type === "user"
              ? new HumanMessage(content)
              : new AIMessage(content);
          })
          .filter((m) => m.content)
      );
    }

    // 创建LLM和Agent
    const model = new ChatOpenAI({
      model: "qwen-plus",
      streaming: true,
      temperature: 0.7,
      apiKey: Deno.env.get("DASHSCOPE_API_KEY") || "",
      configuration: {
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
    });

    const systemPromptContent = `
    你是 ${ai.name}, ${ai.bio}
    ${ai.origin_prompt || ""}

    你有以下工具可以使用:
    - ${kbIds.length > 0 ? "- RAG Tool: 用于从你的知识库中检索信息。\n" : ""}
    ${plugins.map((p) => `- ${p.name}: ${p.description}`).join("\n")}

    当用户提问时, 如果问题涉及到你的知识库中的信息, 请使用 RAG 工具来检索相关内容.
    如果用户请求执行特定任务, 请使用相应的插件工具.
    `;
    const agent = createAgent({
      // @ts-ignore: model parameter type mismatch between ChatOpenAI and expected type
      model,
      tools,
      systemPrompt: systemPromptContent,
    });

    // 流式执行 Agent
    let fullResponse = "";

    try {
      for await (const [chunk, _metadata] of await agent.stream(
        { messages: chatHistory },
        { streamMode: "messages" }
      )) {
        if (chunk.content && typeof chunk.content === "string") {
          fullResponse += chunk.content;
          yield chunk.content;
        }
      }
    } catch (e: any) {
      console.error("Agent Stream Error:", e);
      yield `\n[Error: ${e.message}]`;
    } finally {
      // 保存AI消息
      if (fullResponse) {
        await this.saveAIMessage(chatId, ai.id, fullResponse);
        // 更新最后一条消息摘要
        const { error: updateError } = await this.supabase
          .from("chats")
          .update({ last_message: fullResponse.substring(0, 50) })
          .eq("id", chatId);

        if (updateError) {
          console.error("Error updating chat last_message:", updateError);
        }
      }
    }
  }

  async saveUserMessage(
    chatId: string,
    profileId: string,
    message: MessageContent[]
  ) {
    const { error } = await this.supabase.from("messages").insert({
      chat_id: chatId,
      sender_type: "user",
      sender_profile_id: profileId,
      content: message as any,
    });

    if (error) {
      console.error("Error saving user message:", error);
      throw error;
    }
  }

  async saveAIMessage(chatId: string, characterId: string, message: string) {
    const { error } = await this.supabase.from("messages").insert({
      chat_id: chatId,
      sender_type: "character",
      sender_character_id: characterId,
      content: [{ type: "text", text: message }],
    });

    if (error) {
      console.error("Error saving AI message:", error);
      throw error;
    }
  }

  async getAIMember(chatId: string) {
    const { data: chatMember } = await this.supabase
      .from("chat_members")
      .select("character_id")
      .eq("chat_id", chatId)
      .eq("member_type", "character")
      .single();
    return chatMember;
  }
}
