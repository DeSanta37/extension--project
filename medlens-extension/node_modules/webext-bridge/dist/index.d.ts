import { E as Endpoint } from './types-248b79c4';
export { B as BridgeMessage, b as DataTypeKey, D as Destination, E as Endpoint, G as GetDataType, c as GetReturnType, H as HybridUnsubscriber, I as InternalMessage, O as OnMessageCallback, a as ProtocolMap, P as ProtocolWithReturn, R as RuntimeContext, S as StreamInfo } from './types-248b79c4';
import 'type-fest';

declare const isInternalEndpoint: ({ context: ctx }: Endpoint) => boolean;

declare const parseEndpoint: (endpoint: string) => Endpoint;

export { isInternalEndpoint, parseEndpoint };
