import { handleRpcRequest, type RpcRequest } from './engineRpc';

self.onmessage = (e: MessageEvent<RpcRequest>) =>
    self.postMessage(handleRpcRequest(e.data));
