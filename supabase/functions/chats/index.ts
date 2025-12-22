import {
  createApp,
  getSupabaseClient,
  authMiddleware,
  profileMiddleware,
} from "../_shared/hono.ts";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { ChatService } from "./service.ts";
import { streamSSE } from "hono/streaming";

const app = createApp();

const chatParamsSchema = z.object({
  chatId: z.uuid(),
});

const createPrivateChatSchema = z.object({
  characterId: z.uuid(),
  name: z.string().min(1),
  avatar: z.string().optional(),
});

const updateChatSchema = z.object({
  name: z.string().min(1).optional(),
  avatar: z.string().optional(),
});

const sendMessageSchema = z.object({
  message: z.array(
    z.union([
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
      z.object({
        type: z.literal("image_url"),
        image_url: z.object({
          url: z.string(),
        }),
      }),
    ])
  ),
});

// GET /chats 获取聊天会话列表
app.get("/chats", authMiddleware, profileMiddleware, async (c) => {
  const supabase = c.get("supabase");
  const profile = c.get("profile");
  const service = new ChatService(supabase);

  const chats = await service.getUserChats(profile.id);

  return c.json({
    success: true,
    message: "成功获取聊天会话列表",
    data: {
      chats,
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /chats/private 创建私聊会话
app.post(
  "/chats/private",
  authMiddleware,
  profileMiddleware,
  zValidator("json", createPrivateChatSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const user = c.get("user");
    const service = new ChatService(supabase);

    const body = c.req.valid("json");
    const { characterId, name, avatar } = body;

    const result = await service.createPrivateChat(
      profile.id,
      user.id,
      characterId,
      name,
      avatar
    );

    return c.json(
      {
        success: true,
        message: result.isNew ? "聊天会话创建成功" : "聊天会话已存在",
        data: result.chat,
        timestamp: new Date().toISOString(),
      },
      result.isNew ? 201 : 200
    );
  }
);

// GET /chats/:chatId 获取聊天会话详情
app.get(
  "/chats/:chatId",
  zValidator("param", chatParamsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = getSupabaseClient(c.req.raw);
    const service = new ChatService(supabase);
    const { chatId } = c.req.valid("param");

    const chat = await service.getChatDetails(chatId);

    if (!chat)
      return c.json(
        { success: false, error: { message: "Chat not found" } },
        404
      );

    return c.json({
      success: true,
      message: "成功获取聊天会话详情",
      data: chat,
      timestamp: new Date().toISOString(),
    });
  }
);

// PATCH /chats/:chatId 更新会话
app.patch(
  "/chats/:chatId",
  authMiddleware,
  profileMiddleware,
  zValidator("param", chatParamsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  zValidator("json", updateChatSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const service = new ChatService(supabase);
    const { chatId } = c.req.valid("param");
    const body = c.req.valid("json");

    const chat = await service.updateChat(
      chatId,
      profile.id,
      body.name,
      body.avatar
    );

    return c.json({
      success: true,
      message: "聊天会话更新成功",
      data: chat,
      timestamp: new Date().toISOString(),
    });
  }
);

// DELETE /chats/:chatId 删除会话
app.delete(
  "/chats/:chatId",
  authMiddleware,
  profileMiddleware,
  zValidator("param", chatParamsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const service = new ChatService(supabase);
    const { chatId } = c.req.valid("param");

    await service.deleteChat(chatId, profile.id);

    return c.json({
      success: true,
      message: "聊天会话删除成功",
      data: { id: chatId },
      timestamp: new Date().toISOString(),
    });
  }
);

// GET /chats/:chatId/messages 获取聊天消息列表
app.get(
  "/chats/:chatId/messages",
  zValidator("param", chatParamsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  async (c) => {
    const supabase = getSupabaseClient(c.req.raw);
    const service = new ChatService(supabase);
    const { chatId } = c.req.valid("param");
    const limit = Number(c.req.query("limit") || "20");
    const before = c.req.query("before");

    const result = await service.getMessages(chatId, limit, before);

    return c.json({
      success: true,
      message: "成功获取消息列表",
      data: result,
      timestamp: new Date().toISOString(),
    });
  }
);

// POST /chats/:chatId/messages 发送消息
// app.post(
//   '/chats/:chatId/messages',
//   authMiddleware,
//   profileMiddleware,
//   zValidator('param', chatParamsSchema, (result, c) => {
//     if (!result.success) {
//       return c.json(
//         {
//           success: false,
//           error: {
//             message: 'Validation Error',
//             code: 'VALIDATION_ERROR',
//             details: result.error
//           },
//           timestamp: new Date().toISOString()
//         },
//         400
//       )
//     }
//   }),
//   zValidator('json', sendMessageSchema, (result, c) => {
//     if (!result.success) {
//       return c.json(
//         {
//           success: false,
//           error: {
//             message: 'Validation Error',
//             code: 'VALIDATION_ERROR',
//             details: result.error
//           },
//           timestamp: new Date().toISOString()
//         },
//         400
//       )
//     }
//   }),
//   async (c) => {
//     const supabase = c.get('supabase')
//     const profile = c.get('profile')
//     const service = new ChatService(supabase)
//     const { chatId } = c.req.valid('param')

//     const body = c.req.valid('json')
//     const { message } = body

//     const response = await service.sendMessage(chatId, profile.id, message)

//     return c.json({
//       success: true,
//       message: '消息发送成功',
//       data: {
//         response
//       },
//       timestamp: new Date().toISOString()
//     })
//   }
// )

// POST /chats/:chatId/messages/stream 流式响应
app.post(
  "/chats/:chatId/messages/stream",
  authMiddleware,
  profileMiddleware,
  zValidator("param", chatParamsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  zValidator("json", sendMessageSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            code: "VALIDATION_ERROR",
            details: result.error,
          },
          timestamp: new Date().toISOString(),
        },
        400
      );
    }
  }),
  (c) => {
    const supabase = c.get("supabase");
    const profile = c.get("profile");
    const service = new ChatService(supabase);
    const { chatId } = c.req.valid("param");

    const body = c.req.valid("json");
    const { message } = body;

    const streamGenerator = service.streamMessage(chatId, profile.id, message);

    return streamSSE(c, async (stream) => {
      for await (const chunk of streamGenerator) {
        await stream.writeSSE({
          data: chunk,
        });
      }
    });
  }
);

Deno.serve(app.fetch);
