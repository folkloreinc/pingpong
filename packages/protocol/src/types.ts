import type { components } from './generated/openapi.ts';

type Schemas = components['schemas'];

export type ProjectId = Schemas['ProjectId'];
export type PublicKey = Schemas['PublicKey'];
export type ChannelName = Schemas['ChannelName'];
export type EventName = Schemas['EventName'];
export type SocketId = Schemas['SocketId'];
export type Origin = Schemas['Origin'];
export type PublishRequest = Schemas['PublishRequest'];
export type PublishBatchRequest = Schemas['PublishBatchRequest'];
export type Channel = Schemas['Channel'];
export type Origins = Schemas['Origins'];
export type Health = Schemas['Health'];
export type RequestSignature = Schemas['RequestSignature'];
export type ChannelSignature = Schemas['ChannelSignature'];
export type SocketAuth = Schemas['SocketAuth'];
export type SocketConnectError = Schemas['SocketConnectError'];
export type SocketConnected = Schemas['SocketConnected'];
export type SocketSubscribeRequest = Schemas['SocketSubscribeRequest'];
export type SocketSubscribeError = Schemas['SocketSubscribeError'];
export type SocketSubscribeResult = Schemas['SocketSubscribeResult'];
export type SocketUnsubscribeRequest = Schemas['SocketUnsubscribeRequest'];
export type SocketMessage = Schemas['SocketMessage'];
export type SocketSubscriptionCount = Schemas['SocketSubscriptionCount'];
export type Problem = Schemas['Problem'];
