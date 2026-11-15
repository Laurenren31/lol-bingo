// Vercel Function：照官方文件的寫法，default export 一個掛好 Socket.IO 的 http.Server。
// https://vercel.com/docs/functions/websockets
// 前端連線路徑：/api/socket-io/socket.io（transports 只用 websocket）
import { createGameServer } from '../server/io';
import { createRuntimeFromEnv } from '../server/runtime';

const { store, adapter } = createRuntimeFromEnv();
const { httpServer } = createGameServer({ store, adapter });

export default httpServer;
